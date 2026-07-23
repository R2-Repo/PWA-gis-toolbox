use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const SIDECAR_MODULE: &str = "gis_sidecar";

#[derive(Debug, Clone)]
pub struct SidecarHealth {
    pub available: bool,
    pub version: Option<String>,
    pub reason: Option<String>,
    pub operations: Vec<String>,
    pub duckdb: bool,
    pub local_gdal: bool,
}

impl Default for SidecarHealth {
    fn default() -> Self {
        Self {
            available: false,
            version: None,
            reason: Some("Python sidecar not checked yet".into()),
            operations: vec![],
            duckdb: false,
            local_gdal: false,
        }
    }
}

pub struct SidecarState {
    pub health: Mutex<SidecarHealth>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            health: Mutex::new(SidecarHealth::default()),
        }
    }
}

fn repo_python_path() -> Option<PathBuf> {
    // Dev layout: <repo>/src-tauri/../desktop/sidecar/python
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir
        .join("..")
        .join("desktop")
        .join("sidecar")
        .join("python");
    if candidate.join("gis_sidecar").is_dir() {
        Some(candidate)
    } else {
        None
    }
}

fn resource_sidecar_bin() -> Option<PathBuf> {
    // Packaged binary name (Windows): gis-sidecar.exe next to the app or in resources.
    let candidates = [
        PathBuf::from("gis-sidecar.exe"),
        PathBuf::from("binaries").join("gis-sidecar.exe"),
        PathBuf::from("resources").join("gis-sidecar.exe"),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn python_commands() -> Vec<&'static str> {
    #[cfg(windows)]
    {
        vec!["python", "py", "python3"]
    }
    #[cfg(not(windows))]
    {
        vec!["python3", "python"]
    }
}

pub fn spawn_sidecar_process() -> Result<(Child, String), String> {
    if let Some(bin) = resource_sidecar_bin() {
        let child = Command::new(&bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| format!("Failed to spawn bundled sidecar {}: {err}", bin.display()))?;
        return Ok((child, format!("bundled:{}", bin.display())));
    }

    let python_root = repo_python_path()
        .ok_or_else(|| "Python sidecar sources not found at desktop/sidecar/python".to_string())?;

    let mut last_err = String::from("No Python interpreter found");
    for cmd in python_commands() {
        let mut command = Command::new(cmd);
        command
            .arg("-m")
            .arg(SIDECAR_MODULE)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PYTHONPATH", &python_root)
            .env("PYTHONUTF8", "1")
            .current_dir(&python_root);

        match command.spawn() {
            Ok(child) => return Ok((child, format!("{cmd} -m {SIDECAR_MODULE}"))),
            Err(err) => last_err = format!("{cmd}: {err}"),
        }
    }

    Err(format!(
        "Unable to start Python sidecar ({last_err}). Install Python 3 or package gis-sidecar.exe."
    ))
}

pub fn run_sidecar_request(operation: &str, input: Value, request_id: &str) -> Result<Vec<Value>, String> {
    let (mut child, _launcher) = spawn_sidecar_process()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Sidecar stdout unavailable".to_string())?;

    let request = json!({
        "id": request_id,
        "op": operation,
        "input": input
    });
    writeln!(stdin, "{request}").map_err(|err| format!("Failed writing sidecar request: {err}"))?;
    drop(stdin);

    let reader = BufReader::new(stdout);
    let mut messages = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed reading sidecar output: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(trimmed)
            .map_err(|err| format!("Invalid sidecar JSON line: {err}; line={trimmed}"))?;
        messages.push(value);
    }

    let status = child
        .wait()
        .map_err(|err| format!("Failed waiting for sidecar: {err}"))?;
    if !status.success() {
        // Prefer structured error message from protocol when present.
        let has_result_error = messages.iter().any(|msg| {
            msg.get("type").and_then(|t| t.as_str()) == Some("result")
                && msg.get("ok").and_then(|ok| ok.as_bool()) == Some(false)
        });
        if !has_result_error {
            return Err(format!(
                "Sidecar exited with status {} and no structured error",
                status.code().unwrap_or(-1)
            ));
        }
    }

    Ok(messages)
}

pub fn check_sidecar_health(state: &SidecarState) -> SidecarHealth {
    let result = run_sidecar_request("health", json!({}), "health-check");
    let health = match result {
        Ok(messages) => {
            let output = messages.iter().rev().find_map(|msg| {
                if msg.get("type").and_then(|t| t.as_str()) == Some("result")
                    && msg.get("ok").and_then(|ok| ok.as_bool()) == Some(true)
                {
                    msg.get("output").cloned()
                } else {
                    None
                }
            });
            match output {
                Some(Value::Object(map)) => {
                    let engines = map.get("engines").and_then(|v| v.as_object());
                    let duckdb = map
                        .get("duckdb")
                        .and_then(|v| v.as_bool())
                        .or_else(|| {
                            engines
                                .and_then(|e| e.get("duckdb"))
                                .and_then(|d| d.get("available"))
                                .and_then(|v| v.as_bool())
                        })
                        .unwrap_or(false);
                    let local_gdal = map
                        .get("localGdal")
                        .and_then(|v| v.as_bool())
                        .or_else(|| {
                            engines
                                .and_then(|e| e.get("pyogrio"))
                                .and_then(|d| d.get("available"))
                                .and_then(|v| v.as_bool())
                        })
                        .unwrap_or(false);
                    SidecarHealth {
                        available: true,
                        version: map
                            .get("version")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        reason: None,
                        operations: map
                            .get("operations")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        duckdb,
                        local_gdal,
                    }
                }
                _ => SidecarHealth {
                    available: false,
                    version: None,
                    reason: Some("Sidecar health response missing output".into()),
                    operations: vec![],
                    duckdb: false,
                    local_gdal: false,
                },
            }
        }
        Err(err) => SidecarHealth {
            available: false,
            version: None,
            reason: Some(err),
            operations: vec![],
            duckdb: false,
            local_gdal: false,
        },
    };

    if let Ok(mut guard) = state.health.lock() {
        *guard = health.clone();
    }
    health
}

pub fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}
