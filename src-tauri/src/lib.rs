use serde_json::{json, Value};

#[tauri::command]
fn platform_handshake() -> Value {
    json!({
        "runtime": "windows",
        "os": "windows",
        "shellVersion": env!("CARGO_PKG_VERSION"),
        "capabilities": {
            "nativeFiles": {
                "available": true
            },
            "pythonCompute": {
                "available": false,
                "reason": "Python sidecar not packaged yet"
            },
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
            "largeDatasetProcessing": {
                "available": false,
                "reason": "Large-dataset processing not packaged yet"
            }
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
        .invoke_handler(tauri::generate_handler![
            platform_handshake,
            reveal_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("error while running GIS Toolbox desktop shell");
}
