#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{Ipv4Addr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    ops::{Deref, DerefMut},
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent};

const AUTH_CREDENTIAL_SERVICE: &str = "ug.co.schoolbridge.desktop";
const AUTH_CREDENTIAL_ACCOUNT: &str = "session";

#[cfg(windows)]
fn auth_credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(AUTH_CREDENTIAL_SERVICE, AUTH_CREDENTIAL_ACCOUNT)
        .map_err(|error| format!("Could not access Windows Credential Manager: {error}"))
}

#[cfg(windows)]
#[tauri::command]
fn store_auth_token(token: String) -> Result<(), String> {
    if token.is_empty() || token.len() > 16_384 {
        return Err("The login token is invalid.".into());
    }
    auth_credential_entry()?.set_password(&token)
        .map_err(|error| format!("Could not protect the SchoolBridge login token: {error}"))
}

#[cfg(windows)]
#[tauri::command]
fn load_auth_token() -> Result<Option<String>, String> {
    match auth_credential_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read the protected SchoolBridge login token: {error}")),
    }
}

#[cfg(windows)]
#[tauri::command]
fn clear_auth_token() -> Result<(), String> {
    match auth_credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove the protected SchoolBridge login token: {error}")),
    }
}

// Non-Windows development builds fail closed instead of persisting credentials
// in an unprotected fallback store.
#[cfg(not(windows))]
#[tauri::command]
fn store_auth_token(_token: String) -> Result<(), String> {
    Err("Protected desktop credential storage is only available on Windows.".into())
}
#[cfg(not(windows))]
#[tauri::command]
fn load_auth_token() -> Result<Option<String>, String> {
    Err("Protected desktop credential storage is only available on Windows.".into())
}
#[cfg(not(windows))]
#[tauri::command]
fn clear_auth_token() -> Result<(), String> {
    Err("Protected desktop credential storage is only available on Windows.".into())
}

const DEFAULT_BACKEND_PORT: u16 = 8080;
const BACKEND_START_TIMEOUT: Duration = Duration::from_secs(90);

// Serialise all startup/recovery attempts inside this desktop process. The port
// check alone is not sufficient: two concurrent callers could both pass it
// before either child has bound the loopback listener.
static BACKEND_START_LOCK: Mutex<()> = Mutex::new(());
const HEALTH_FAILURE_LIMIT: u8 = 3;

fn health_check_failed(consecutive_failures: &mut u8) -> bool {
    *consecutive_failures = consecutive_failures.saturating_add(1);
    *consecutive_failures >= HEALTH_FAILURE_LIMIT
}

fn health_check_succeeded(consecutive_failures: &mut u8) {
    *consecutive_failures = 0;
}

fn mark_restart_attempted(restart_attempted: &mut bool) -> bool {
    if *restart_attempted {
        false
    } else {
        *restart_attempted = true;
        true
    }
}

#[cfg(windows)]
struct JobGuard(windows_sys::Win32::Foundation::HANDLE);

// The handle is an owned kernel handle. Moving ownership between threads is safe;
// access and closure remain serialized by BackendProcess's Mutex.
#[cfg(windows)]
unsafe impl Send for JobGuard {}

#[cfg(windows)]
impl JobGuard {
    fn attach(process_id: u32) -> Result<Self, String> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{
                JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
                    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
                Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
            },
        };

        // The kill-on-close job guarantees the backend cannot outlive the desktop
        // process, including when the desktop process exits unexpectedly.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("Could not create the SchoolBridge backend process job.".into());
            }

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured == 0 {
                CloseHandle(job);
                return Err("Could not configure backend process lifetime protection.".into());
            }

            let process = OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0,
                process_id,
            );
            if process.is_null() {
                CloseHandle(job);
                return Err("Could not open the SchoolBridge backend process.".into());
            }

            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                CloseHandle(job);
                return Err("Could not attach the backend to its lifetime-protection job.".into());
            }

            Ok(Self(job))
        }
    }

    fn attach_additional(&self, process_id: u32) -> Result<(), String> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{
                JobObjects::AssignProcessToJobObject,
                Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
            },
        };
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, process_id);
            if process.is_null() {
                return Err("Could not open the SchoolBridge LAN backend process.".into());
            }
            let assigned = AssignProcessToJobObject(self.0, process);
            CloseHandle(process);
            if assigned == 0 {
                return Err("Could not attach the LAN backend to its lifetime-protection job.".into());
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for JobGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

struct ManagedBackend {
    children: Vec<Child>,
    // Keep the optional LAN endpoint under supervision after startup too.
    lan: Option<LanConfig>,
    // Closing this handle terminates every backend listener in the job.
    #[cfg(windows)]
    _job: JobGuard,
}

impl ManagedBackend {
    fn stop(mut self) {
        // Stop every owned listener and reap each process before desktop exit.
        for child in &mut self.children {
            let _ = child.kill();
        }
        for child in &mut self.children {
            let _ = child.wait();
        }
    }

    fn failure_reason(&mut self) -> Option<String> {
        for (index, child) in self.children.iter_mut().enumerate() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let service = if index == 0 { "loopback backend" } else { "HTTPS LAN listener" };
                    return Some(format!("The SchoolBridge {service} stopped unexpectedly ({status})."));
                }
                Ok(None) => {}
                Err(error) => return Some(format!("Could not monitor a SchoolBridge backend process: {error}")),
            }
        }
        if let Some(config) = &self.lan {
            if !lan_listener_is_reachable(config) {
                return Some(format!(
                    "The SchoolBridge HTTPS LAN listener at {}:{} stopped accepting connections.",
                    config.bind_ip, config.port
                ));
            }
        }
        None
    }
}

fn lan_listener_is_reachable(config: &LanConfig) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from((config.bind_ip, config.port)),
        Duration::from_millis(500),
    ).is_ok()
}

// Own children while startup is in progress too. Any early error path therefore
// kills and reaps processes on every platform, not only through the Windows job.
struct ChildGuard(Vec<Child>);

impl Deref for ChildGuard {
    type Target = Vec<Child>;
    fn deref(&self) -> &Self::Target { &self.0 }
}

impl DerefMut for ChildGuard {
    fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0 }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        for child in &mut self.0 {
            let _ = child.kill();
        }
        for child in &mut self.0 {
            let _ = child.wait();
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct LanConfig {
    bind_ip: Ipv4Addr,
    port: u16,
    cert_file: PathBuf,
    key_file: PathBuf,
}

fn configured_lan(env_file: &Path, installation_dir: &Path) -> Result<Option<LanConfig>, String> {
    let contents = fs::read_to_string(env_file)
        .map_err(|_| "SchoolBridge configuration (.env) is missing or unreadable.".to_string())?;
    let values: std::collections::HashMap<String, String> = contents.lines().filter_map(|line| {
        let (key, value) = line.split_once('=')?;
        Some((key.trim().to_string(), value.trim().trim_matches('"').trim_matches('\'').to_string()))
    }).collect();

    let enabled = values.get("SCHOOLBRIDGE_LAN_ENABLED").map(String::as_str).unwrap_or("false");
    match enabled.to_ascii_lowercase().as_str() {
        "false" | "0" | "no" | "off" => return Ok(None),
        "true" | "1" | "yes" | "on" => {}
        _ => return Err("SCHOOLBRIDGE_LAN_ENABLED must be true or false.".into()),
    }

    let bind_raw = values.get("SCHOOLBRIDGE_LAN_BIND_IP")
        .ok_or("LAN access requires SCHOOLBRIDGE_LAN_BIND_IP to be set to this computer's private Wi-Fi IPv4 address.")?;
    let bind_ip = bind_raw.parse::<Ipv4Addr>()
        .map_err(|_| "SCHOOLBRIDGE_LAN_BIND_IP must be a private IPv4 address.".to_string())?;
    if !bind_ip.is_private() || bind_ip.is_loopback() || bind_ip.is_unspecified() {
        return Err("LAN access may bind only to a private, non-loopback IPv4 address.".into());
    }

    let port = values.get("SCHOOLBRIDGE_LAN_PORT").map(String::as_str).unwrap_or("8443")
        .parse::<u16>().map_err(|_| "SCHOOLBRIDGE_LAN_PORT must be a valid TCP port.".to_string())?;
    if port < 1024 || port == DEFAULT_BACKEND_PORT {
        return Err("SCHOOLBRIDGE_LAN_PORT must be an unprivileged port different from the desktop loopback port.".into());
    }

    let cert_file = values.get("SCHOOLBRIDGE_LAN_CERT_FILE")
        .map(PathBuf::from).ok_or("LAN access requires an HTTPS certificate file.")?;
    let key_file = values.get("SCHOOLBRIDGE_LAN_KEY_FILE")
        .map(PathBuf::from).ok_or("LAN access requires an HTTPS private key file.")?;
    if !cert_file.is_absolute() || !cert_file.is_file() {
        return Err("The LAN HTTPS certificate path must be an existing absolute file path.".into());
    }
    if !key_file.is_absolute() || !key_file.is_file() || cert_file == key_file {
        return Err("The LAN HTTPS private key path must be a separate existing absolute file path.".into());
    }
    let install_root = installation_dir.canonicalize()
        .map_err(|_| "Could not resolve the SchoolBridge installation directory.".to_string())?;
    let cert_resolved = cert_file.canonicalize()
        .map_err(|_| "Could not resolve the LAN HTTPS certificate path.".to_string())?;
    let key_resolved = key_file.canonicalize()
        .map_err(|_| "Could not resolve the LAN HTTPS private key path.".to_string())?;
    if cert_resolved.starts_with(&install_root) || key_resolved.starts_with(&install_root) {
        return Err("LAN certificate and private key must be stored outside the SchoolBridge installation/USB directory.".into());
    }

    Ok(Some(LanConfig { bind_ip, port, cert_file: cert_resolved, key_file: key_resolved }))
}

#[derive(Default)]
struct BackendProcess {
    backend: Mutex<Option<ManagedBackend>>,
    stopping: AtomicBool,
}

impl BackendProcess {
    fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        let backend = self.backend.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
        if let Some(backend) = backend {
            backend.stop();
        }
    }
}

fn installation_root() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the SchoolBridge desktop executable: {error}"))?;
    executable
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not determine the SchoolBridge installation directory.".into())
}

fn desktop_data_directory() -> Result<PathBuf, String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "Windows did not provide LOCALAPPDATA; cannot select a persistent SchoolBridge data directory.".to_string())?;
    let data_dir = local_app_data.join("SchoolBridge").join("data");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not create the SchoolBridge data directory: {error}"))?;
    Ok(data_dir)
}

fn sqlite_database_url(database_path: &Path) -> String {
    // SQLAlchemy accepts forward slashes in absolute Windows SQLite paths.
    let path = database_path.to_string_lossy().replace('\\', "/");
    format!("sqlite:///{}", path)
}

fn configured_port(env_file: &Path) -> Result<u16, String> {
    let contents = fs::read_to_string(env_file)
        .map_err(|_| "SchoolBridge configuration (.env) is missing or unreadable.".to_string())?;
    let mut port = DEFAULT_BACKEND_PORT;

    for line in contents.lines() {
        let Some((key, raw_value)) = line.split_once('=') else { continue };
        if key.trim() != "SCHOOLBRIDGE_PORT" {
            continue;
        }
        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        port = value.parse::<u16>()
            .map_err(|_| "SCHOOLBRIDGE_PORT must be a valid TCP port.".to_string())?;
    }

    if port != DEFAULT_BACKEND_PORT {
        return Err(format!(
            "The desktop frontend connects to the local backend on port {DEFAULT_BACKEND_PORT}; set SCHOOLBRIDGE_PORT={DEFAULT_BACKEND_PORT} in .env."
        ));
    }
    Ok(port)
}

fn backend_is_healthy(port: u16) -> bool {
    let address = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &address.parse().expect("loopback socket address is valid"),
        Duration::from_millis(500),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    is_healthy_response(&response)
}

fn is_healthy_response(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let successful_status = headers.lines().next()
        .map(|line| line.split_whitespace().nth(1) == Some("200"))
        .unwrap_or(false);
    successful_status
        && body.contains("\"status\"")
        && body.contains("\"ok\"")
        && body.contains("\"SchoolBridge\"")
}

fn start_backend() -> Result<ManagedBackend, String> {
    let _startup_guard = BACKEND_START_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = installation_root()?;
    let python = root.join("runtime").join("python.exe");
    let backend_dir = root.join("backend");
    let env_file = root.join(".env");
    let static_dir = backend_dir.join("app").join("static");
    let data_dir = desktop_data_directory()?;
    let database_path = data_dir.join("schoolbridge.sqlite3");
    let database_url = sqlite_database_url(&database_path);

    for (path, description) in [
        (&python, "bundled Python runtime"),
        (&backend_dir, "backend application directory"),
        (&env_file, "SchoolBridge configuration"),
        (&static_dir, "installed frontend assets"),
    ] {
        if !path.exists() {
            return Err(format!(
                "SchoolBridge {description} is missing: {}",
                path.display()
            ));
        }
    }

    let port = configured_port(&env_file)?;
    let lan = configured_lan(&env_file, &root)?;
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
        return Err(format!(
            "Port {port} is already in use. SchoolBridge will not attach to an unowned service."
        ));
    }

    let log_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("SchoolBridge")
        .join("logs");
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Could not create the backend log directory: {error}"))?;
    let log_path = log_dir.join("backend.log");
    let log = OpenOptions::new().create(true).append(true).open(&log_path)
        .map_err(|error| format!("Could not open the backend log: {error}"))?;
    let error_log = log.try_clone()
        .map_err(|error| format!("Could not prepare backend error logging: {error}"))?;

    let mut child = Command::new(&python)
        .args([
            "-m", "uvicorn", "app.main:app",
            "--app-dir", backend_dir.to_string_lossy().as_ref(),
            "--host", "127.0.0.1",
            "--port", &port.to_string(),
        ])
        .current_dir(&root)
        .env("PYTHONPATH", &backend_dir)
        .env("SCHOOLBRIDGE_STATIC_DIR", &static_dir)
        .env("SCHOOLBRIDGE_DATA_DIR", &data_dir)
        // Force the desktop database into per-user local storage, never the USB
        // installation directory or the process working directory.
        .env("SCHOOLBRIDGE_DATABASE_URL", &database_url)
        // Restrict cross-origin access to the packaged Tauri WebView and the
        // loopback Vite origin used by desktop development.
        .env("SCHOOLBRIDGE_CORS_ORIGINS", "http://tauri.localhost,http://localhost:5173,http://127.0.0.1:5173")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(error_log))
        .spawn()
        .map_err(|error| format!("Could not start the bundled SchoolBridge backend: {error}"))?;

    #[cfg(windows)]
    let job = match JobGuard::attach(child.id()) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    let mut children = ChildGuard(vec![child]);

    // The HTTPS LAN listener runs the same application against the same SQLite
    // database. Wait until the loopback backend has completed startup (including
    // migrations and restore handling) before starting a second process, so the
    // two processes cannot race through database initialisation.
    let primary_deadline = Instant::now() + BACKEND_START_TIMEOUT;
    let mut primary_ready = false;
    while Instant::now() < primary_deadline {
        if let Some(status) = children[0].try_wait()
            .map_err(|error| format!("Could not monitor the SchoolBridge backend: {error}"))? {
            return Err(format!(
                "SchoolBridge backend exited during startup ({status}). Check {}.",
                log_path.display()
            ));
        }
        if backend_is_healthy(port) {
            primary_ready = true;
            break;
        }
        thread::sleep(Duration::from_millis(500));
    }
    if !primary_ready {
        let _ = children[0].kill();
        let _ = children[0].wait();
        return Err(format!(
            "SchoolBridge loopback backend did not become healthy within 90 seconds. Check {}.",
            log_path.display()
        ));
    }

    if let Some(config) = lan.clone() {
        let lan_log_path = log_dir.join("lan-backend.log");
        let lan_log = OpenOptions::new().create(true).append(true).open(&lan_log_path)
            .map_err(|error| format!("Could not open the LAN backend log: {error}"))?;
        let lan_error_log = lan_log.try_clone()
            .map_err(|error| format!("Could not prepare LAN backend error logging: {error}"))?;
        let bind_ip = config.bind_ip.to_string();
        let port_text = config.port.to_string();
        let cert_file = config.cert_file.to_string_lossy().into_owned();
        let key_file = config.key_file.to_string_lossy().into_owned();
        let mut lan_child = Command::new(&python)
            .args([
                "-m", "uvicorn", "app.main:app",
                "--app-dir", backend_dir.to_string_lossy().as_ref(),
                "--host", &bind_ip,
                "--port", &port_text,
                "--ssl-certfile", &cert_file,
                "--ssl-keyfile", &key_file,
            ])
            .current_dir(&root)
            .env("PYTHONPATH", &backend_dir)
            .env("SCHOOLBRIDGE_STATIC_DIR", &static_dir)
            .env("SCHOOLBRIDGE_DATA_DIR", &data_dir)
            .env("SCHOOLBRIDGE_DATABASE_URL", &database_url)
            .env("SCHOOLBRIDGE_CORS_ORIGINS", format!("https://{bind_ip}:{port_text}"))
            .env("SCHOOLBRIDGE_ALLOWED_HOSTS", bind_ip.clone())
            .stdout(Stdio::from(lan_log))
            .stderr(Stdio::from(lan_error_log))
            .spawn()
            .map_err(|error| format!("Could not start the HTTPS LAN listener: {error}"))?;

        #[cfg(windows)]
        if let Err(error) = job.attach_additional(lan_child.id()) {
            let _ = lan_child.kill();
            let _ = lan_child.wait();
            return Err(error);
        }
        children.push(lan_child);
    }

    let deadline = Instant::now() + BACKEND_START_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = children[0].try_wait()
            .map_err(|error| format!("Could not monitor the SchoolBridge backend: {error}"))? {
            return Err(format!(
                "SchoolBridge backend exited during startup ({status}). Check {}.",
                log_path.display()
            ));
        }
        let lan_ready = if let Some(config) = &lan {
            if children.len() > 1 {
                if let Some(status) = children[1].try_wait()
                    .map_err(|error| format!("Could not monitor the HTTPS LAN listener: {error}"))? {
                    return Err(format!(
                        "The HTTPS LAN listener exited during startup ({status}). Check {}.",
                        log_dir.join("lan-backend.log").display()
                    ));
                }
                lan_listener_is_reachable(config)
            } else {
                false
            }
        } else {
            true
        };
        if backend_is_healthy(port) && lan_ready {
            return Ok(ManagedBackend {
                children: std::mem::take(&mut children.0),
                lan: lan.clone(),
                #[cfg(windows)]
                _job: job,
            });
        }
        thread::sleep(Duration::from_millis(500));
    }

    for child in &mut children.0 {
        let _ = child.kill();
    }
    for child in &mut children.0 {
        let _ = child.wait();
    }
    Err(format!(
        "SchoolBridge backend did not become healthy within 90 seconds. Check {}.",
        log_path.display()
    ))
}

fn supervise_backend(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut consecutive_health_failures = 0_u8;
        let mut restart_attempted = false;

        loop {
            thread::sleep(Duration::from_secs(2));
            let state = app_handle.state::<BackendProcess>();
            if state.stopping.load(Ordering::Acquire) {
                break;
            }

            let failure = {
                let mut backend = state.backend.lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                match backend.as_mut() {
                    Some(backend) => {
                        if let Some(reason) = backend.failure_reason() {
                            Some(reason)
                        } else if backend_is_healthy(DEFAULT_BACKEND_PORT) {
                            health_check_succeeded(&mut consecutive_health_failures);
                            None
                        } else if health_check_failed(&mut consecutive_health_failures) {
                            Some("The SchoolBridge backend stopped responding to health checks.".into())
                        } else {
                            None
                        }
                    }
                    None => Some("The SchoolBridge backend process group is unavailable.".into()),
                }
            };

            let Some(reason) = failure else { continue };

            // Remove and stop the complete process group before attempting a
            // restart. This prevents duplicate listeners and SQLite writers.
            let old_backend = state.backend.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()).take();
            if let Some(backend) = old_backend {
                backend.stop();
            }

            if state.stopping.load(Ordering::Acquire) {
                break;
            }

            if !mark_restart_attempted(&mut restart_attempted) {
                show_startup_error(&format!(
                    "{reason}\n\nSchoolBridge tried one automatic recovery, but the backend failed again. Close and reopen the desktop app. Diagnostic logs are under %LOCALAPPDATA%\\SchoolBridge\\logs."
                ));
                break;
            }

            restart_attempted = true;
            match start_backend() {
                Ok(restarted) => {
                    let mut backend = state.backend.lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if state.stopping.load(Ordering::Acquire) {
                        drop(backend);
                        restarted.stop();
                        break;
                    }
                    *backend = Some(restarted);
                    // A successful restart starts a fresh health-monitoring
                    // window; stale failures from the previous process must
                    // not make the first transient probe fail the new backend.
                    health_check_succeeded(&mut consecutive_health_failures);
                }
                Err(error) => {
                    show_startup_error(&format!(
                        "{reason}\n\nSchoolBridge could not recover automatically: {error}\n\nCheck the logs under %LOCALAPPDATA%\\SchoolBridge\\logs, correct the reported problem, then reopen the app."
                    ));
                    break;
                }
            }
        }
    });
}

#[cfg(windows)]
fn show_startup_error(message: &str) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    let body: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let title: Vec<u16> = std::ffi::OsStr::new("SchoolBridge could not start")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_startup_error(message: &str) {
    eprintln!("{message}");
}

fn main() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![store_auth_token, load_auth_token, clear_auth_token])
        .manage(BackendProcess::default())
        .setup(|app| {
            let backend = start_backend()
                .map_err(|message| std::io::Error::new(std::io::ErrorKind::Other, message))?;
            let state = app.state::<BackendProcess>();
            *state.backend.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(backend);
            supervise_backend(app.handle().clone());
            Ok(())
        });

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(error) => {
            show_startup_error(&format!(
                "SchoolBridge could not initialise its desktop services.\n\n{error}\n\nCheck the SchoolBridge logs under %LOCALAPPDATA%\\SchoolBridge\\logs and correct the reported problem before restarting."
            ));
            return;
        }
    };

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            app_handle.state::<BackendProcess>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{is_healthy_response, Ipv4Addr};

    #[cfg(windows)]
    #[test]
    fn managed_backend_detects_a_real_child_process_exit() {
        use std::{process::Command, thread, time::{Duration, Instant}};

        let child = Command::new("cmd.exe")
            .args(["/C", "exit /b 17"])
            .spawn()
            .expect("start lifecycle test child");
        let job = super::JobGuard::attach(child.id()).expect("attach child to job");
        let mut backend = super::ManagedBackend {
            children: vec![child],
            lan: None,
            _job: job,
        };

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(reason) = backend.failure_reason() {
                assert!(reason.contains("stopped unexpectedly"), "{reason}");
                break;
            }
            assert!(Instant::now() < deadline, "child process did not exit in time");
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(windows)]
    #[test]
    fn managed_backend_shutdown_terminates_and_reaps_a_real_child() {
        use std::process::{Command, Stdio};
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        };

        let child = Command::new("cmd.exe")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start long-running lifecycle test child");
        let pid = child.id();
        let job = super::JobGuard::attach(pid).expect("attach child to job");
        super::ManagedBackend {
            children: vec![child],
            lan: None,
            _job: job,
        }.stop();

        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            assert!(!process.is_null(), "could not inspect stopped child process");
            let mut exit_code = 0_u32;
            let inspected = GetExitCodeProcess(process, &mut exit_code);
            CloseHandle(process);
            assert_ne!(inspected, 0, "could not read child process exit status");
            assert_ne!(exit_code, 259, "backend child remained active after desktop shutdown");
        }
    }

    #[test]
    fn concurrent_backend_start_attempts_are_serialised() {
        use std::sync::{atomic::{AtomicUsize, Ordering}, Arc, Barrier};
        use std::{thread, time::Duration};

        let barrier = Arc::new(Barrier::new(3));
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();

        for _ in 0..2 {
            let barrier = Arc::clone(&barrier);
            let active = Arc::clone(&active);
            let maximum = Arc::clone(&maximum);
            workers.push(thread::spawn(move || {
                barrier.wait();
                let _guard = super::BACKEND_START_LOCK
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum.fetch_max(current, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(40));
                active.fetch_sub(1, Ordering::SeqCst);
            }));
        }

        barrier.wait();
        for worker in workers {
            worker.join().expect("startup worker should finish");
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 1,
            "backend startup attempts must never overlap");
    }

    #[test]
    fn backend_health_failures_require_three_consecutive_checks() {
        let mut failures = 0;
        assert!(!super::health_check_failed(&mut failures));
        assert!(!super::health_check_failed(&mut failures));
        assert_eq!(failures, 2);
        assert!(super::health_check_failed(&mut failures));
        super::health_check_succeeded(&mut failures);
        assert_eq!(failures, 0);
        assert!(!super::health_check_failed(&mut failures));
    }

    #[test]
    fn backend_recovery_is_limited_to_one_restart_attempt() {
        let mut attempted = false;
        assert!(super::mark_restart_attempted(&mut attempted));
        assert!(attempted);
        assert!(!super::mark_restart_attempted(&mut attempted));
    }

    #[test]
    fn lan_listener_health_check_detects_tcp_reachability() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = super::LanConfig {
            bind_ip: Ipv4Addr::LOCALHOST,
            port,
            cert_file: std::path::PathBuf::new(),
            key_file: std::path::PathBuf::new(),
        };
        assert!(super::lan_listener_is_reachable(&config));
        drop(listener);
        assert!(!super::lan_listener_is_reachable(&config));
    }

    #[test]
    fn lan_listener_is_disabled_by_default() {
        let dir = std::env::temp_dir().join(format!("schoolbridge-lan-disabled-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let env_file = dir.join(".env");
        std::fs::write(&env_file, "SCHOOLBRIDGE_PORT=8080\n").unwrap();
        assert_eq!(super::configured_lan(&env_file, &dir).unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lan_listener_accepts_private_ip_only_with_existing_https_files() {
        let dir = std::env::temp_dir().join(format!("schoolbridge-lan-valid-{}", std::process::id()));
        let install = dir.join("install");
        let cert_dir = dir.join("certs");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::create_dir_all(&cert_dir).unwrap();
        let cert = cert_dir.join("lan-cert.pem");
        let key = cert_dir.join("lan-key.pem");
        let env_file = install.join(".env");
        std::fs::write(&cert, "certificate placeholder").unwrap();
        std::fs::write(&key, "private key placeholder").unwrap();
        std::fs::write(&env_file, format!(
            "SCHOOLBRIDGE_LAN_ENABLED=true\nSCHOOLBRIDGE_LAN_BIND_IP=192.168.1.20\nSCHOOLBRIDGE_LAN_PORT=8443\nSCHOOLBRIDGE_LAN_CERT_FILE={}\nSCHOOLBRIDGE_LAN_KEY_FILE={}\n",
            cert.display(), key.display()
        )).unwrap();
        let config = super::configured_lan(&env_file, &install).unwrap().unwrap();
        assert_eq!(config.bind_ip, "192.168.1.20".parse::<Ipv4Addr>().unwrap());
        assert_eq!(config.port, 8443);
        assert_eq!(config.cert_file, cert.canonicalize().unwrap());
        assert_eq!(config.key_file, key.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lan_listener_rejects_public_and_loopback_addresses() {
        let dir = std::env::temp_dir().join(format!("schoolbridge-lan-invalid-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let env_file = dir.join(".env");
        std::fs::write(&env_file, "SCHOOLBRIDGE_LAN_ENABLED=true\nSCHOOLBRIDGE_LAN_BIND_IP=8.8.8.8\n").unwrap();
        assert!(super::configured_lan(&env_file, &dir).unwrap_err().contains("private"));
        std::fs::write(&env_file, "SCHOOLBRIDGE_LAN_ENABLED=true\nSCHOOLBRIDGE_LAN_BIND_IP=127.0.0.1\n").unwrap();
        assert!(super::configured_lan(&env_file, &dir).unwrap_err().contains("private"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn creates_an_absolute_local_app_data_sqlite_url() {
        let path = std::path::Path::new(r"C:\Users\School User\AppData\Local\SchoolBridge\data\schoolbridge.sqlite3");
        assert_eq!(
            super::sqlite_database_url(path),
            "sqlite:///C:/Users/School User/AppData/Local/SchoolBridge/data/schoolbridge.sqlite3"
        );
    }

    #[test]
    fn accepts_only_a_successful_schoolbridge_health_response() {
        assert!(is_healthy_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\",\"application\":\"SchoolBridge\"}"
        ));
    }

    #[test]
    fn rejects_non_success_status_even_with_healthy_body() {
        assert!(!is_healthy_response(
            "HTTP/1.1 503 Service Unavailable\r\n\r\n{\"status\":\"ok\",\"application\":\"SchoolBridge\"}"
        ));
    }

    #[test]
    fn rejects_an_unrelated_service_response() {
        assert!(!is_healthy_response(
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"ok\",\"application\":\"Other\"}"
        ));
    }
}
