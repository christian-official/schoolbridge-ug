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

fn valid_ed25519_public_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 44 || bytes[43] != b'=' { return false; }
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if !bytes[..43].iter().all(|byte| alphabet.contains(byte)) { return false; }
    alphabet.iter().position(|byte| *byte == bytes[42]).map(|index| index % 4 == 0).unwrap_or(false)
}

fn packaged_license_public_key(resource_root: &Path) -> Result<String, String> {
    let key_path = resource_root.join("owner-activation-public-key.txt");
    let key = fs::read_to_string(&key_path)
        .map_err(|_| format!("The packaged owner activation public key is missing: {}", key_path.display()))?
        .trim().to_string();
    if !valid_ed25519_public_key(&key) {
        return Err("The packaged owner activation public key is invalid; expected Base64 Ed25519 public key (32 bytes).".into());
    }
    Ok(key)
}

fn ensure_license_public_key(env_file: &Path, public_key: &str) -> Result<(), String> {
    let contents = fs::read_to_string(env_file)
        .map_err(|error| format!("Could not read SchoolBridge configuration: {error}"))?;
    let matching: Vec<&str> = contents.lines().filter(|line|
        line.split_once('=').map(|(key, _)| key.trim() == "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY").unwrap_or(false)
    ).collect();
    if matching.len() > 1 { return Err("SchoolBridge configuration contains duplicate owner activation public-key settings.".into()); }
    if let Some(line) = matching.first() {
        let configured = line.split_once('=').map(|(_, value)| value.trim().trim_matches('"').trim_matches('\'')).unwrap_or("");
        if !configured.is_empty() && configured != public_key {
            return Err("The configured owner activation public key does not match this SchoolBridge package. Existing owner identity settings were not changed.".into());
        }
        if configured == public_key { return Ok(()); }
    }
    let mut updated = String::new();
    let mut replaced = false;
    for line in contents.lines() {
        if line.split_once('=').map(|(key, _)| key.trim() == "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY").unwrap_or(false) {
            updated.push_str(&format!("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY={public_key}"));
            replaced = true;
        } else { updated.push_str(line); }
        updated.push('\n');
    }
    if !replaced { updated.push_str(&format!("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY={public_key}\n")); }
    fs::write(env_file, updated).map_err(|error| format!("Could not configure the owner activation public key: {error}"))
}

fn desktop_config_file(python: &Path, resource_root: &Path) -> Result<PathBuf, String> {
    let public_key = packaged_license_public_key(resource_root)?;
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "Windows did not provide LOCALAPPDATA; cannot select a persistent SchoolBridge configuration directory.".to_string())?;
    let config_dir = local_app_data.join("SchoolBridge").join("config");
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Could not create the SchoolBridge configuration directory: {error}"))?;
    let env_file = config_dir.join(".env");

    if !env_file.exists() {
        // Ask the bundled CPython runtime for cryptographically secure entropy.
        // The generated application secret is written once to the per-user
        // configuration directory and is never stored in the install folder.
        let output = Command::new(python)
            .args(["-c", "import secrets; print(secrets.token_urlsafe(48))"])
            .output()
            .map_err(|error| format!("Could not generate the initial SchoolBridge application secret: {error}"))?;
        if !output.status.success() {
            return Err("The bundled Python runtime could not generate the initial SchoolBridge application secret.".into());
        }
        let secret = String::from_utf8(output.stdout)
            .map_err(|_| "The generated SchoolBridge application secret was not valid UTF-8.".to_string())?
            .trim()
            .to_string();
        if secret.len() < 48 || secret.chars().any(|character| character.is_control() || character == '=') {
            return Err("The bundled Python runtime returned an invalid application secret.".into());
        }

        let contents = format!(
            "SCHOOLBRIDGE_SECRET_KEY={secret}\nSCHOOLBRIDGE_LICENSE_PUBLIC_KEY={public_key}\nSCHOOLBRIDGE_PORT={DEFAULT_BACKEND_PORT}\nSCHOOLBRIDGE_LAN_ENABLED=false\nSCHOOLBRIDGE_LAN_PORT=8443\n"
        );
        match OpenOptions::new().write(true).create_new(true).open(&env_file) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(contents.as_bytes()) {
                    drop(file);
                    let _ = fs::remove_file(&env_file);
                    return Err(format!("Could not save the initial SchoolBridge configuration: {error}"));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
            Err(error) => return Err(format!("Could not create the initial SchoolBridge configuration: {error}")),
        }
    }

    ensure_license_public_key(&env_file, &public_key)?;
    Ok(env_file)
}

fn resolve_resource_root(resource_dir: &Path) -> Result<PathBuf, String> {
    let has_packaged_runtime = |root: &Path| {
        root.join("runtime").join("python.exe").is_file()
            && root.join("backend").join("app").join("main.py").is_file()
            && root.join("backend").join("app").join("static").join("index.html").is_file()
    };

    if has_packaged_runtime(resource_dir) {
        return Ok(resource_dir.to_path_buf());
    }

    // Preserve the side-by-side development/prototype layout while preferring
    // Tauri's managed resource directory for an installed application.
    if let Ok(root) = installation_root() {
        if has_packaged_runtime(&root) {
            return Ok(root);
        }
    }

    Err(format!(
        "The packaged SchoolBridge backend or Python runtime is missing from {}. Reinstall the complete SchoolBridge package.",
        resource_dir.display()
    ))
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

fn wait_for_readiness<F>(
    timeout: Duration,
    poll_interval: Duration,
    timeout_message: &str,
    mut is_ready: F,
) -> Result<(), String>
where
    F: FnMut() -> Result<bool, String>,
{
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() >= deadline {
            return Err(timeout_message.to_string());
        }
        if is_ready()? {
            return Ok(());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        thread::sleep(poll_interval.min(remaining));
    }
}

fn start_backend(resource_dir: &Path) -> Result<ManagedBackend, String> {
    let _startup_guard = BACKEND_START_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = resolve_resource_root(resource_dir)?;
    let python = root.join("runtime").join("python.exe");
    let backend_dir = root.join("backend");
    let env_file = desktop_config_file(&python, &root)?;
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
        .env("SCHOOLBRIDGE_CONFIG_FILE", &env_file)
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
    let primary_timeout = format!(
        "SchoolBridge loopback backend did not become healthy within 90 seconds. Check {}.",
        log_path.display()
    );
    wait_for_readiness(
        BACKEND_START_TIMEOUT,
        Duration::from_millis(500),
        &primary_timeout,
        || {
            if let Some(status) = children[0].try_wait()
                .map_err(|error| format!("Could not monitor the SchoolBridge backend: {error}"))? {
                return Err(format!(
                    "SchoolBridge backend exited during startup ({status}). Check {}.",
                    log_path.display()
                ));
            }
            Ok(backend_is_healthy(port))
        },
    )?;

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
            .env("SCHOOLBRIDGE_CONFIG_FILE", &env_file)
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

    let startup_timeout = format!(
        "SchoolBridge backend did not become healthy within 90 seconds. Check {}.",
        log_path.display()
    );
    wait_for_readiness(
        BACKEND_START_TIMEOUT,
        Duration::from_millis(500),
        &startup_timeout,
        || {
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
            Ok(backend_is_healthy(port) && lan_ready)
        },
    )?;

    Ok(ManagedBackend {
        children: std::mem::take(&mut children.0),
        lan: lan.clone(),
        #[cfg(windows)]
        _job: job,
    })
}

fn supervise_backend(app_handle: tauri::AppHandle, resource_dir: PathBuf) {
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
            match start_backend(&resource_dir) {
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
            let resource_dir = app.path().resource_dir()
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, format!("Could not locate packaged SchoolBridge resources: {error}")))?;
            let backend = start_backend(&resource_dir)
                .map_err(|message| std::io::Error::new(std::io::ErrorKind::Other, message))?;
            let state = app.state::<BackendProcess>();
            *state.backend.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(backend);
            supervise_backend(app.handle().clone(), resource_dir);
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
    #[test]
    fn accepts_only_canonical_32_byte_ed25519_public_keys() {
        assert!(super::valid_ed25519_public_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
        assert!(!super::valid_ed25519_public_key(""));
        assert!(!super::valid_ed25519_public_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
        assert!(!super::valid_ed25519_public_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"));
        assert!(!super::valid_ed25519_public_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    }

    #[test]
    fn fills_missing_owner_public_key_but_rejects_owner_identity_change() {
        let dir = std::env::temp_dir().join(format!("schoolbridge-owner-key-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let env_file = dir.join(".env");
        std::fs::write(&env_file, "SCHOOLBRIDGE_SECRET_KEY=secret\\nSCHOOLBRIDGE_LICENSE_PUBLIC_KEY=\\n").unwrap();
        let key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        super::ensure_license_public_key(&env_file, key).unwrap();
        let contents = std::fs::read_to_string(&env_file).unwrap();
        assert!(contents.contains(&format!("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY={key}")));
        super::ensure_license_public_key(&env_file, key).unwrap();
        assert!(super::ensure_license_public_key(&env_file, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }


    use super::{is_healthy_response, resolve_resource_root, Ipv4Addr};

    #[test]
    fn packaged_resources_resolve_only_when_runtime_backend_and_frontend_exist() {
        let root = std::env::temp_dir().join(format!(
            "schoolbridge-tauri-resource-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("runtime")).expect("create runtime directory");
        std::fs::create_dir_all(root.join("backend/app/static")).expect("create backend directory");
        std::fs::write(root.join("runtime/python.exe"), b"test runtime").expect("write runtime marker");
        std::fs::write(root.join("backend/app/main.py"), b"# backend").expect("write backend marker");
        std::fs::write(root.join("backend/app/static/index.html"), b"<!doctype html>").expect("write frontend marker");

        let resolved = resolve_resource_root(&root).expect("complete packaged resources should resolve");
        assert_eq!(resolved, root);

        std::fs::remove_dir_all(&root).expect("remove temporary resources");
    }

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
        // Retain a process handle before shutdown; reopening by PID after exit
        // is unreliable because Windows may already have discarded PID lookup.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        assert!(!process.is_null(), "could not open child process before shutdown");
        super::ManagedBackend {
            children: vec![child],
            lan: None,
            _job: job,
        }.stop();

        unsafe {
            let mut exit_code = 0_u32;
            let inspected = GetExitCodeProcess(process, &mut exit_code);
            CloseHandle(process);
            assert_ne!(inspected, 0, "could not read child process exit status");
            assert_ne!(exit_code, 259, "backend child remained active after desktop shutdown");
        }
    }

    #[test]
    fn startup_readiness_timeout_is_deterministic_and_reports_failure() {
        use std::time::Duration;

        let mut checks = 0_u32;
        let error = super::wait_for_readiness(
            Duration::from_millis(25),
            Duration::from_millis(5),
            "backend startup timed out",
            || {
                checks += 1;
                Ok(false)
            },
        ).expect_err("an unavailable backend must time out");

        assert_eq!(error, "backend startup timed out");
        assert!(checks > 0, "readiness must be checked before timing out");
    }

    #[test]
    fn startup_readiness_returns_immediately_when_backend_is_ready() {
        let mut checks = 0_u32;
        super::wait_for_readiness(
            std::time::Duration::from_secs(1),
            std::time::Duration::from_millis(5),
            "backend startup timed out",
            || {
                checks += 1;
                Ok(true)
            },
        ).expect("ready backend should pass startup");
        assert_eq!(checks, 1);
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

    #[cfg(windows)]
    #[test]
    fn managed_backend_shutdown_terminates_and_reaps_backend_and_lan_children() {
        use std::process::{Command, Stdio};
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        };

        let spawn_listener = || {
            Command::new("cmd.exe")
                .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("start lifecycle test listener")
        };

        let backend = spawn_listener();
        let backend_pid = backend.id();
        let job = super::JobGuard::attach(backend_pid).expect("attach backend child to job");
        let lan = spawn_listener();
        let lan_pid = lan.id();
        job.attach_additional(lan_pid).expect("attach LAN child to same job");

        // Keep handles open across shutdown. Windows may discard the process
        // object from PID lookup once the child has exited, even though a handle
        // opened while it was alive remains valid for exit-code inspection.
        let process_handles = [backend_pid, lan_pid].map(|pid| unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
        });
        for (pid, process) in [backend_pid, lan_pid].into_iter().zip(process_handles.iter()) {
            assert!(!process.is_null(), "could not open child process {pid} before shutdown");
        }

        super::ManagedBackend {
            children: vec![backend, lan],
            lan: None,
            _job: job,
        }.stop();

        for (pid, process) in [backend_pid, lan_pid].into_iter().zip(process_handles) {
            unsafe {
                let mut exit_code = 0_u32;
                let inspected = GetExitCodeProcess(process, &mut exit_code);
                CloseHandle(process);
                assert_ne!(inspected, 0, "could not read child {pid} exit status");
                assert_ne!(exit_code, 259, "child {pid} remained active after desktop shutdown");
            }
        }
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
