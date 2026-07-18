use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TEMP_BYTES: usize = 32 * 1024 * 1024;
const TEMP_DIR_NAME: &str = "gis-toolbox";

fn temp_root() -> PathBuf {
    std::env::temp_dir().join(TEMP_DIR_NAME)
}

fn is_under_temp_root(path: &Path) -> bool {
    let Ok(root) = temp_root().canonicalize() else {
        return false;
    };
    let Ok(canonical) = path.canonicalize() else {
        // File may not exist yet / already deleted — fall back to prefix check.
        return path.starts_with(temp_root());
    };
    canonical.starts_with(&root)
}

/// Write GeoJSON text to a temp file under the OS temp dir (scoped to gis-toolbox/).
#[tauri::command]
pub fn write_temp_geojson(contents: String) -> Result<String, String> {
    if contents.len() > MAX_TEMP_BYTES {
        return Err(format!(
            "Temporary GeoJSON exceeds {} MB IPC limit",
            MAX_TEMP_BYTES / (1024 * 1024)
        ));
    }

    let root = temp_root();
    fs::create_dir_all(&root).map_err(|err| format!("Failed to create temp dir: {err}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = root.join(format!("layer-{stamp}.geojson"));
    fs::write(&path, contents.as_bytes())
        .map_err(|err| format!("Failed to write temp GeoJSON: {err}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Delete a temp file previously created by write_temp_geojson.
#[tauri::command]
pub fn remove_temp_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !is_under_temp_root(&path) {
        return Err("Refusing to delete a path outside the GIS Toolbox temp directory".into());
    }
    if path.exists() {
        fs::remove_file(&path).map_err(|err| format!("Failed to remove temp file: {err}"))?;
    }
    Ok(())
}
