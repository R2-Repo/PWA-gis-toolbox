mod jobs;
mod sidecar;

use jobs::{job_cancel, job_start, sidecar_health, JobRegistry};
use serde_json::{json, Value};
use sidecar::{check_sidecar_health, SidecarState};
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
fn platform_handshake(state: tauri::State<'_, SidecarState>) -> Value {
    let health = check_sidecar_health(&state);
    let mut python = json!({
        "available": health.available
    });
    if let Some(version) = &health.version {
        python["version"] = json!(version);
    }
    if let Some(reason) = &health.reason {
        python["reason"] = json!(reason);
    }

    let large = if health.available {
        json!({ "available": true })
    } else {
        json!({
            "available": false,
            "reason": "Requires Python sidecar"
        })
    };

    json!({
        "runtime": "windows",
        "os": "windows",
        "shellVersion": env!("CARGO_PKG_VERSION"),
        "capabilities": {
            "nativeFiles": {
                "available": true
            },
            "pythonCompute": python,
            "gpuCompute": {
                "available": false,
                "reason": "GPU backend not configured yet"
            },
            "localGdal": {
                "available": false,
                "reason": "GDAL not packaged yet"
            },
            "localPdal": {
                "available": false,
                "reason": "PDAL not packaged yet"
            },
            "largeDatasetProcessing": large
        }
    })
}

/// Reveal a file or folder in Windows File Explorer.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|err| format!("Failed to open Explorer: {err}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Reveal in Explorer is only available on Windows".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState::default())
        .manage(Arc::new(JobRegistry::default()))
        .setup(|app| {
            // Warm the sidecar health cache during startup (non-fatal).
            let state = app.state::<SidecarState>();
            let _ = check_sidecar_health(&state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_handshake,
            reveal_in_explorer,
            job_start,
            job_cancel,
            sidecar_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running GIS Toolbox desktop shell");
}
