//! Portable `.gispack` — zip of one Local GIS Library item (not Atlas).

use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::{
    db_path, ensure_library_dirs, get_item_by_id, gis_catalog_ingest_path, library_root_path,
    migrate, GisCatalogIngestRequest, GisCatalogState,
};

const PACK_FORMAT: &str = "gis-toolbox-library-item";
const PACK_VERSION: i64 = 1;

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid catalog item id".into());
    }
    Ok(())
}

fn copy_named_file(src: &Path, zip: &mut ZipWriter<File>, name: &str) -> Result<(), String> {
    if !src.is_file() {
        return Ok(());
    }
    let mut f = File::open(src).map_err(|e| format!("open {}: {e}", src.display()))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| format!("read {}: {e}", src.display()))?;
    zip.start_file(
        name,
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
    )
    .map_err(|e| format!("zip start {name}: {e}"))?;
    zip.write_all(&buf)
        .map_err(|e| format!("zip write {name}: {e}"))?;
    Ok(())
}

/// Export a catalog item + managed files to a `.gispack` zip at `outputPath`.
#[tauri::command]
pub fn gis_catalog_export_pack(
    app: AppHandle,
    state: State<'_, Arc<GisCatalogState>>,
    id: String,
    output_path: String,
) -> Result<Value, String> {
    validate_id(&id)?;
    if output_path.trim().is_empty() || output_path.contains("..") {
        return Err("Invalid output path".into());
    }
    let out = PathBuf::from(&output_path);
    if !out.is_absolute() {
        return Err("outputPath must be absolute".into());
    }
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create output dir: {e}"))?;
    }

    let item = get_item_by_id(&state, &id)?.ok_or_else(|| "Catalog item not found".to_string())?;
    let root = state
        .library_root
        .lock()
        .clone()
        .unwrap_or(library_root_path(&app)?);

    let file = File::create(&out).map_err(|e| format!("create pack: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let exported_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let manifest = json!({
        "packType": PACK_FORMAT,
        "formatVersion": PACK_VERSION,
        "exportedAt": exported_at,
        "item": item,
    });
    zip.start_file("manifest.json", opts)
        .map_err(|e| format!("zip manifest: {e}"))?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|e| format!("write manifest: {e}"))?;

    zip.start_file("README.txt", opts)
        .map_err(|e| format!("zip readme: {e}"))?;
    zip.write_all(
        b"GIS Toolbox Local GIS Library pack (.gispack)\r\n\
Not for Network Atlas data.\r\n\
Import via Local GIS Library > Import pack.\r\n",
    )
    .map_err(|e| format!("write readme: {e}"))?;

    if let Some(preview) = item.get("previewPath").and_then(|v| v.as_str()) {
        copy_named_file(Path::new(preview), &mut zip, "data/preview.geojson")?;
    }
    if let Some(managed) = item.get("managedOriginalPath").and_then(|v| v.as_str()) {
        let p = Path::new(managed);
        if p.is_file() {
            let name = p
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("original.bin");
            copy_named_file(p, &mut zip, &format!("data/original/{name}"))?;
        }
    }
    if let Some(working) = item.get("workingPath").and_then(|v| v.as_str()) {
        let p = Path::new(working);
        if p.is_file() {
            let name = p
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("working.bin");
            copy_named_file(p, &mut zip, &format!("data/working/{name}"))?;
        }
    }
    let tile_dir = root.join("tiles").join(&id);
    if tile_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&tile_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let name = p
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("layer.pmtiles");
                    copy_named_file(&p, &mut zip, &format!("data/tiles/{name}"))?;
                }
            }
        }
    } else if let Some(tile) = item.get("tilePath").and_then(|v| v.as_str()) {
        let p = Path::new(tile);
        if p.is_file() {
            let name = p
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("layer.pmtiles");
            copy_named_file(p, &mut zip, &format!("data/tiles/{name}"))?;
        }
    }

    zip.finish().map_err(|e| format!("finish zip: {e}"))?;
    let bytes = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "ok": true,
        "outputPath": out.to_string_lossy(),
        "byteSize": bytes,
        "itemId": id,
    }))
}

/// Import a `.gispack` into the Local GIS Library as a new item.
#[tauri::command]
pub fn gis_catalog_import_pack(
    app: AppHandle,
    state: State<'_, Arc<GisCatalogState>>,
    path: String,
) -> Result<Value, String> {
    if path.trim().is_empty() || path.contains("..") {
        return Err("Invalid pack path".into());
    }
    let pack_path = PathBuf::from(&path);
    if !pack_path.is_file() {
        return Err("Pack file not found".into());
    }

    let root = {
        let locked = state.library_root.lock().clone();
        match locked {
            Some(r) => r,
            None => {
                let r = library_root_path(&app)?;
                ensure_library_dirs(&r)?;
                let db = db_path(&r);
                let conn = rusqlite::Connection::open(&db)
                    .map_err(|e| format!("open catalog: {e}"))?;
                migrate(&conn)?;
                *state.conn.lock() = Some(conn);
                *state.library_root.lock() = Some(r.clone());
                r
            }
        }
    };

    let file = File::open(&pack_path).map_err(|e| format!("open pack: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("read zip: {e}"))?;

    let mut manifest_text = String::new();
    {
        let mut mf = archive
            .by_name("manifest.json")
            .map_err(|_| "Pack missing manifest.json".to_string())?;
        mf.read_to_string(&mut manifest_text)
            .map_err(|e| format!("read manifest: {e}"))?;
    }
    let manifest: Value =
        serde_json::from_str(&manifest_text).map_err(|e| format!("parse manifest: {e}"))?;
    if manifest.get("packType").and_then(|v| v.as_str()) != Some(PACK_FORMAT) {
        return Err("Not a GIS Toolbox library pack".into());
    }
    let item = manifest
        .get("item")
        .cloned()
        .ok_or_else(|| "Pack manifest missing item".to_string())?;

    let staging = root.join("temp").join(format!("import-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|e| format!("create staging: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry: {e}"))?;
        let name = entry.name().to_string();
        if name == "manifest.json" || name == "README.txt" || name.ends_with('/') {
            continue;
        }
        if name.contains("..") {
            continue;
        }
        let dest = staging.join(&name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        let mut out = File::create(&dest).map_err(|e| format!("create {name}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("extract {name}: {e}"))?;
    }

    let original_dir = staging.join("data").join("original");
    let working_dir = staging.join("data").join("working");
    let preview = staging.join("data").join("preview.geojson");

    let mut source: Option<PathBuf> = None;
    if original_dir.is_dir() {
        if let Ok(mut entries) = fs::read_dir(&original_dir) {
            if let Some(Ok(e)) = entries.next() {
                source = Some(e.path());
            }
        }
    }
    if source.is_none() && working_dir.is_dir() {
        if let Ok(mut entries) = fs::read_dir(&working_dir) {
            if let Some(Ok(e)) = entries.next() {
                source = Some(e.path());
            }
        }
    }
    if source.is_none() && preview.is_file() {
        source = Some(preview.clone());
    }
    let source = source.ok_or_else(|| "Pack has no importable data files".to_string())?;

    let preview_geojson = if preview.is_file() {
        fs::read_to_string(&preview).ok()
    } else {
        None
    };

    let display_name = item
        .get("displayName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Imported pack".into());

    let payload = GisCatalogIngestRequest {
        source_path: source.to_string_lossy().to_string(),
        display_name: Some(display_name),
        format: item
            .get("format")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        feature_count: item.get("featureCount").and_then(|v| v.as_i64()),
        sampled_feature_count: item.get("sampledFeatureCount").and_then(|v| v.as_i64()),
        geometry_types: item.get("geometryTypes").cloned(),
        property_keys: item.get("propertyKeys").cloned(),
        bbox: item.get("bbox").cloned(),
        crs_hint: item
            .get("crsHint")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        byte_size: None,
        preview_only: Some(preview_geojson.is_some()),
        preview_geojson,
        mode: Some("copy".into()),
        description: Some(format!(
            "Imported from .gispack ({})",
            pack_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("pack")
        )),
        parent_ids: None,
        derived_op: Some("gispack_import".into()),
        restorable: Some(true),
    };

    let result = gis_catalog_ingest_path(app, state.clone(), payload)?;
    let _ = fs::remove_dir_all(&staging);

    Ok(json!({
        "ok": true,
        "item": result.get("item").cloned(),
        "sourcePack": pack_path.to_string_lossy(),
    }))
}
