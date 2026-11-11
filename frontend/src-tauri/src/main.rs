#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent};

const DEFAULT_BACKEND_PORT: u16 = 8080;
const BACKEND_START_TIMEOUT: Duration = Duration::from_secs(90);

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
    child: Child,
    // Closing this handle terminates any remaining processes in the job.
    #[cfg(windows)]
    _job: JobGuard,
}

impl ManagedBackend {
    fn stop(mut self) {
        // Request termination of the owned server, then wait so its process handle
        // and resources are reaped before the desktop application exits.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct BackendProcess(Mutex<Option<ManagedBackend>>);

impl BackendProcess {
    fn stop(&self) {
        let backend = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
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
    format!("sqlite:///{}", database_path.to_string_lossy().replace('\\', "/"))
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

    let deadline = Instant::now() + BACKEND_START_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()
            .map_err(|error| format!("Could not monitor the SchoolBridge backend: {error}"))? {
            return Err(format!(
                "SchoolBridge backend exited during startup ({status}). Check {}.",
                log_path.display()
            ));
        }
        if backend_is_healthy(port) {
            return Ok(ManagedBackend {
                child,
                #[cfg(windows)]
                _job: job,
            });
        }
        thread::sleep(Duration::from_millis(500));
    }

    let _ = child.kill();
    let _ = child.wait();
    Err(format!(
        "SchoolBridge backend did not become healthy within 90 seconds. Check {}.",
        log_path.display()
    ))
}

fn main() {
    let app = tauri::Builder::default()
        .manage(BackendProcess::default())
        .setup(|app| {
            let backend = start_backend()
                .map_err(|message| std::io::Error::new(std::io::ErrorKind::Other, message))?;
            let state = app.state::<BackendProcess>();
            *state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(backend);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to initialise SchoolBridge desktop application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            app_handle.state::<BackendProcess>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_healthy_response;

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
