mod atlas;
mod jobs;
mod sidecar;
mod temp_files;

use atlas::{
    atlas_db_load_snapshot, atlas_db_open, atlas_finding_update, atlas_import_apply,
    atlas_import_inbox_ensure, atlas_import_inbox_list, atlas_import_inbox_open,
    atlas_import_read_file, atlas_ping_cancel, atlas_ping_finalize_session,
    atlas_ping_list_sessions, atlas_ping_load_session, atlas_ping_many, atlas_ping_one,
    atlas_ping_save, atlas_pref_get, atlas_pref_get_all, atlas_pref_set, AtlasDbState,
    AtlasPingState,
};
use jobs::{job_cancel, job_start, sidecar_health, JobRegistry};
use serde_json::{json, Value};
use sidecar::{check_sidecar_health, SidecarState};
use std::sync::Arc;
use tauri::Manager;
use temp_files::{remove_temp_file, write_temp_geojson};

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
            "largeDatasetProcessing": large,
            "localSqlite": {
                "available": true
            },
            "icmpPing": {
                "available": true
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
        .manage(SidecarState::default())
        .manage(Arc::new(JobRegistry::default()))
        .manage(Arc::new(AtlasDbState::default()))
        .manage(Arc::new(AtlasPingState::default()))
        .setup(|app| {
            // Warm the sidecar health cache during startup (non-fatal).
            let state = app.state::<SidecarState>();
            let _ = check_sidecar_health(&state);

            // Keep page scale at 1×. Trackpad pinch is handled in JS as map zoom
            // (zoomHotkeysEnabled lets WebView2 deliver ctrl+wheel; JS preventDefaults).
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_zoom(1.0);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_handshake,
            reveal_in_explorer,
            write_temp_geojson,
            remove_temp_file,
            job_start,
            job_cancel,
            sidecar_health,
            atlas_db_open,
            atlas_db_load_snapshot,
            atlas_import_apply,
            atlas_import_inbox_ensure,
            atlas_import_inbox_list,
            atlas_import_inbox_open,
            atlas_import_read_file,
            atlas_ping_save,
            atlas_ping_list_sessions,
            atlas_ping_load_session,
            atlas_ping_finalize_session,
            atlas_pref_get,
            atlas_pref_get_all,
            atlas_pref_set,
            atlas_finding_update,
            atlas_ping_one,
            atlas_ping_many,
            atlas_ping_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running GIS Toolbox desktop shell");
}
