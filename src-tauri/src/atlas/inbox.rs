//! Atlas import inbox — dedicated folder (not GIS map import).
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

const INBOX_DIR_NAME: &str = "atlas-import";
const MAX_READ_BYTES: u64 = 80 * 1024 * 1024; // 80 MB

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))
}

fn default_inbox_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join(INBOX_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("create atlas-import folder: {e}"))?;
    // Drop a short README once so the folder is self-explanatory in Explorer
    let readme = dir.join("README.txt");
    if !readme.exists() {
        let _ = fs::write(
            &readme,
            "ITS Network Atlas — import inbox\r\n\r\n\
Place your source exports here, then use Network Atlas → Import data → Scan folder.\r\n\r\n\
Expected files:\r\n\
  - FiberSwitchLocation YYYY-MM-DD.xlsx\r\n\
  - ATMS Master Device List (.csv)\r\n\r\n\
Importing replaces the current Atlas network database with the new files.\r\n\
This folder is separate from GIS Toolbox map/layer import.\r\n",
        );
    }
    Ok(dir)
}

fn is_allowed_import_ext(path: &Path) -> bool {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("xlsx" | "xls" | "csv" | "txt") => true,
        _ => false,
    }
}

fn validate_readable_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".into());
    }
    let s = path.to_string_lossy();
    if s.contains("..") {
        return Err("Path must not contain ..".into());
    }
    if !is_allowed_import_ext(path) {
        return Err("Only .xlsx, .xls, .csv, .txt files can be read for Atlas import".into());
    }
    if !path.is_file() {
        return Err("File not found".into());
    }
    let meta = fs::metadata(path).map_err(|e| format!("stat: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err(format!("File exceeds {} MB limit", MAX_READ_BYTES / (1024 * 1024)));
    }
    Ok(())
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxFile {
    name: String,
    path: String,
    ext: String,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn atlas_import_inbox_ensure(app: AppHandle) -> Result<Value, String> {
    let path = default_inbox_path(&app)?;
    Ok(json!({
        "path": path.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn atlas_import_inbox_open(app: AppHandle) -> Result<(), String> {
    let path = default_inbox_path(&app)?;
    let path_str = path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .map_err(|err| format!("Failed to open Explorer: {err}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path_str;
        Err("Open import folder is only available on Windows".into())
    }
}

#[tauri::command]
pub fn atlas_import_inbox_list(app: AppHandle) -> Result<Value, String> {
    let dir = default_inbox_path(&app)?;
    let mut files = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read inbox: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_allowed_import_ext(&path) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name.eq_ignore_ascii_case("readme.txt") {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        files.push(InboxFile {
            name,
            path: path.to_string_lossy().to_string(),
            ext,
            size,
            modified_ms: mtime_ms(&path),
        });
    }
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(json!({
        "path": dir.to_string_lossy(),
        "files": files,
    }))
}

#[tauri::command]
pub fn atlas_import_read_file(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    validate_readable_path(&path)?;
    let bytes = fs::read(&path).map_err(|e| format!("read file: {e}"))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    Ok(json!({
        "name": name,
        "path": path.to_string_lossy(),
        "ext": ext,
        "base64": B64.encode(bytes),
    }))
}
