//! Scoped byte-range reads for PMTiles (and similar) under the Local GIS Library root.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use super::GisCatalogState;

const MAX_RANGE_BYTES: u64 = 8 * 1024 * 1024; // 8 MB per IPC range

pub(crate) fn library_root(app: &AppHandle, state: &GisCatalogState) -> Result<PathBuf, String> {
    if let Some(root) = state.library_root.lock().clone() {
        return Ok(root);
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("gis-library");
    Ok(dir)
}

pub(crate) fn canonicalize_under_library(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".into());
    }
    let s = path.to_string_lossy();
    if s.contains("..") {
        return Err("Path must not contain ..".into());
    }
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("canonicalize library root: {e}"))?;
    let path_canon = path
        .canonicalize()
        .map_err(|e| format!("canonicalize path: {e}"))?;
    if !path_canon.starts_with(&root_canon) {
        return Err("Path is outside the Local GIS Library folder".into());
    }
    if !path_canon.is_file() {
        return Err("File not found".into());
    }
    let ext = path_canon
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // PMTiles tiles + COG overview PNGs / COG GeoTIFFs under the library root
    if !matches!(
        ext.as_str(),
        "pmtiles" | "pbf" | "mvt" | "png" | "tif" | "tiff"
    ) {
        return Err(
            "Range reads are limited to tile packages (.pmtiles) and library rasters (.png/.tif)"
                .into(),
        );
    }
    Ok(path_canon)
}

/// Read a byte range from a library file. Returns base64 payload for IPC efficiency.
#[tauri::command]
pub fn gis_library_read_range(
    app: AppHandle,
    state: State<'_, Arc<GisCatalogState>>,
    path: String,
    offset: u64,
    length: u64,
) -> Result<Value, String> {
    if length == 0 {
        return Ok(json!({ "base64": "", "bytesRead": 0 }));
    }
    if length > MAX_RANGE_BYTES {
        return Err(format!(
            "Range length exceeds {} MB limit",
            MAX_RANGE_BYTES / (1024 * 1024)
        ));
    }
    let root = library_root(&app, &state)?;
    // Ensure root exists (catalog open may not have run yet)
    std::fs::create_dir_all(&root).map_err(|e| format!("create library root: {e}"))?;
    let file_path = canonicalize_under_library(&root, Path::new(&path))?;

    let mut file = File::open(&file_path).map_err(|e| format!("open file: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek: {e}"))?;
    let mut buf = vec![0u8; length as usize];
    let n = file.read(&mut buf).map_err(|e| format!("read: {e}"))?;
    buf.truncate(n);
    Ok(json!({
        "base64": B64.encode(&buf),
        "bytesRead": n,
        "offset": offset,
    }))
}
