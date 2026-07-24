//! Local GIS Library catalog — sibling to Atlas / UDOT Fiber (metadata + managed folders).
//! Does not store Network Atlas inventory or ping data.

mod file_range;

pub use file_range::gis_library_read_range;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const LIBRARY_DIR: &str = "gis-library";
const MAX_PREVIEW_CHARS: usize = 2_500_000;
const MAX_COPY_BYTES: u64 = 500 * 1024 * 1024; // 500 MB copy budget for MVP

pub struct GisCatalogState {
    conn: Mutex<Option<Connection>>,
    library_root: Mutex<Option<PathBuf>>,
}

impl Default for GisCatalogState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
            library_root: Mutex::new(None),
        }
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))
}

fn library_root_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(LIBRARY_DIR))
}

fn ensure_library_dirs(root: &Path) -> Result<(), String> {
    for sub in ["catalog", "originals", "datasets", "tiles", "jobs", "temp", "logs"] {
        fs::create_dir_all(root.join(sub)).map_err(|e| format!("create {sub}: {e}"))?;
    }
    let readme = root.join("README.txt");
    if !readme.exists() {
        let _ = fs::write(
            &readme,
            "GIS Toolbox — Local GIS Library\r\n\r\n\
Managed originals and dataset previews live here.\r\n\
This folder is separate from Network Atlas (network-atlas.sqlite).\r\n\
Do not edit catalog/gis-catalog.sqlite by hand.\r\n",
        );
    }
    Ok(())
}

fn db_path(root: &Path) -> PathBuf {
    root.join("catalog").join("gis-catalog.sqlite")
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS catalog_item (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            item_type TEXT NOT NULL DEFAULT 'vector',
            format TEXT,
            original_filename TEXT,
            original_path TEXT,
            managed_original_path TEXT,
            preview_path TEXT,
            working_path TEXT,
            feature_count INTEGER,
            sampled_feature_count INTEGER,
            geometry_types_json TEXT,
            property_keys_json TEXT,
            bbox_json TEXT,
            crs_hint TEXT,
            byte_size INTEGER,
            status TEXT NOT NULL DEFAULT 'ready',
            preview_only INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_used_at TEXT,
            description TEXT,
            manifest_json TEXT,
            tile_path TEXT,
            parent_ids_json TEXT,
            derived_op TEXT,
            restorable INTEGER NOT NULL DEFAULT 0,
            favorite INTEGER NOT NULL DEFAULT 0,
            tags_json TEXT,
            folder TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_catalog_item_updated ON catalog_item(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_catalog_item_name ON catalog_item(display_name);
        "#,
    )
    .map_err(|e| format!("gis_catalog migrate: {e}"))?;
    // Additive columns (ignore if already present).
    let _ = conn.execute_batch("ALTER TABLE catalog_item ADD COLUMN tile_path TEXT;");
    let _ = conn.execute_batch("ALTER TABLE catalog_item ADD COLUMN parent_ids_json TEXT;");
    let _ = conn.execute_batch("ALTER TABLE catalog_item ADD COLUMN derived_op TEXT;");
    let _ = conn.execute_batch(
        "ALTER TABLE catalog_item ADD COLUMN restorable INTEGER NOT NULL DEFAULT 0;",
    );
    let _ = conn.execute_batch(
        "ALTER TABLE catalog_item ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;",
    );
    let _ = conn.execute_batch("ALTER TABLE catalog_item ADD COLUMN tags_json TEXT;");
    let _ = conn.execute_batch("ALTER TABLE catalog_item ADD COLUMN folder TEXT;");
    Ok(())
}

fn now_iso() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Compact UTC-ish stamp for sorting; full ISO not required for MVP
    format!("{ms}")
}

fn with_conn<T>(
    state: &GisCatalogState,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.conn.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "GIS Library catalog is not open".to_string())?;
    f(conn)
}

fn row_to_item(row: &rusqlite::Row<'_>) -> Result<Value, rusqlite::Error> {
    let tile_path: Option<String> = row.get(23).unwrap_or(None);
    let parent_ids = parse_json_field(row.get::<_, Option<String>>(24).unwrap_or(None));
    let derived_op: Option<String> = row.get(25).unwrap_or(None);
    let restorable = row.get::<_, i64>(26).unwrap_or(0) != 0;
    let favorite = row.get::<_, i64>(27).unwrap_or(0) != 0;
    let tags = parse_json_field(row.get::<_, Option<String>>(28).unwrap_or(None));
    let folder: Option<String> = row.get(29).unwrap_or(None);
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "displayName": row.get::<_, String>(1)?,
        "itemType": row.get::<_, String>(2)?,
        "format": row.get::<_, Option<String>>(3)?,
        "originalFilename": row.get::<_, Option<String>>(4)?,
        "originalPath": row.get::<_, Option<String>>(5)?,
        "managedOriginalPath": row.get::<_, Option<String>>(6)?,
        "previewPath": row.get::<_, Option<String>>(7)?,
        "workingPath": row.get::<_, Option<String>>(8)?,
        "featureCount": row.get::<_, Option<i64>>(9)?,
        "sampledFeatureCount": row.get::<_, Option<i64>>(10)?,
        "geometryTypes": parse_json_field(row.get::<_, Option<String>>(11)?),
        "propertyKeys": parse_json_field(row.get::<_, Option<String>>(12)?),
        "bbox": parse_json_field(row.get::<_, Option<String>>(13)?),
        "crsHint": row.get::<_, Option<String>>(14)?,
        "byteSize": row.get::<_, Option<i64>>(15)?,
        "status": row.get::<_, String>(16)?,
        "previewOnly": row.get::<_, i64>(17)? != 0,
        "createdAt": row.get::<_, String>(18)?,
        "updatedAt": row.get::<_, String>(19)?,
        "lastUsedAt": row.get::<_, Option<String>>(20)?,
        "description": row.get::<_, Option<String>>(21)?,
        "manifest": parse_json_field(row.get::<_, Option<String>>(22)?),
        "tilePath": tile_path,
        "parentIds": parent_ids,
        "derivedOp": derived_op,
        "restorable": restorable,
        "favorite": favorite,
        "tags": tags,
        "folder": folder,
    }))
}

fn parse_json_field(raw: Option<String>) -> Value {
    match raw {
        Some(s) if !s.is_empty() => serde_json::from_str(&s).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

const SELECT_ITEM: &str = r#"
    SELECT id, display_name, item_type, format, original_filename, original_path,
           managed_original_path, preview_path, working_path, feature_count,
           sampled_feature_count, geometry_types_json, property_keys_json, bbox_json,
           crs_hint, byte_size, status, preview_only, created_at, updated_at,
           last_used_at, description, manifest_json, tile_path,
           parent_ids_json, derived_op, restorable, favorite, tags_json, folder
    FROM catalog_item
"#;

fn validate_source_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Source path must be absolute".into());
    }
    let s = path.to_string_lossy();
    if s.contains("..") {
        return Err("Source path must not contain ..".into());
    }
    if !path.is_file() {
        return Err(format!("Source file not found: {}", path.display()));
    }
    Ok(())
}

fn copy_file(src: &Path, dest: &Path) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create original dir: {e}"))?;
    }
    let bytes = fs::copy(src, dest).map_err(|e| format!("copy original: {e}"))?;
    Ok(bytes)
}

fn write_text(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dataset dir: {e}"))?;
    }
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))
}

#[tauri::command]
pub fn gis_catalog_open(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
) -> Result<Value, String> {
    let root = library_root_path(&app)?;
    ensure_library_dirs(&root)?;
    let path = db_path(&root);
    let conn = Connection::open(&path).map_err(|e| format!("open gis-catalog.sqlite: {e}"))?;
    migrate(&conn)?;
    *state.conn.lock() = Some(conn);
    *state.library_root.lock() = Some(root.clone());
    Ok(json!({
        "ok": true,
        "libraryRoot": root.to_string_lossy(),
        "catalogPath": path.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn gis_catalog_library_root(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
) -> Result<Value, String> {
    let root = state
        .library_root
        .lock()
        .clone()
        .unwrap_or(library_root_path(&app)?);
    ensure_library_dirs(&root)?;
    Ok(json!({ "path": root.to_string_lossy() }))
}

#[tauri::command]
pub fn gis_catalog_open_library_folder(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
) -> Result<(), String> {
    let root = state
        .library_root
        .lock()
        .clone()
        .unwrap_or(library_root_path(&app)?);
    ensure_library_dirs(&root)?;
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(root.as_os_str())
            .spawn()
            .map_err(|e| format!("Failed to open library folder: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        Err("Open library folder is only available on Windows".into())
    }
}

#[tauri::command]
pub fn gis_catalog_list_items(
    state: tauri::State<'_, Arc<GisCatalogState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!("{SELECT_ITEM} ORDER BY updated_at DESC"))
            .map_err(|e| format!("prepare list: {e}"))?;
        let rows = stmt
            .query_map([], row_to_item)
            .map_err(|e| format!("query list: {e}"))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| format!("row: {e}"))?);
        }
        Ok(json!({ "items": items }))
    })
}

fn get_item_by_id(state: &GisCatalogState, id: &str) -> Result<Option<Value>, String> {
    with_conn(state, |conn| {
        let mut stmt = conn
            .prepare(&format!("{SELECT_ITEM} WHERE id = ?1"))
            .map_err(|e| format!("prepare get: {e}"))?;
        stmt.query_row(params![id], row_to_item)
            .optional()
            .map_err(|e| format!("get item: {e}"))
    })
}

#[tauri::command]
pub fn gis_catalog_get_item(
    state: tauri::State<'_, Arc<GisCatalogState>>,
    id: String,
) -> Result<Value, String> {
    let item = get_item_by_id(&state, &id)?;
    Ok(json!({ "item": item }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GisCatalogIngestRequest {
    pub source_path: String,
    pub display_name: Option<String>,
    pub format: Option<String>,
    pub feature_count: Option<i64>,
    pub sampled_feature_count: Option<i64>,
    pub geometry_types: Option<Value>,
    pub property_keys: Option<Value>,
    pub bbox: Option<Value>,
    pub crs_hint: Option<String>,
    pub byte_size: Option<i64>,
    pub preview_only: Option<bool>,
    pub preview_geojson: Option<String>,
    /// "copy" (default) or "link" (reference original path only)
    pub mode: Option<String>,
    pub description: Option<String>,
    /// Lineage: parent catalog item ids (derived analysis outputs)
    pub parent_ids: Option<Value>,
    pub derived_op: Option<String>,
    pub restorable: Option<bool>,
}

#[tauri::command]
pub fn gis_catalog_ingest_path(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
    payload: GisCatalogIngestRequest,
) -> Result<Value, String> {
    let root = {
        let locked = state.library_root.lock().clone();
        match locked {
            Some(r) => r,
            None => {
                let r = library_root_path(&app)?;
                ensure_library_dirs(&r)?;
                let path = db_path(&r);
                let conn = Connection::open(&path).map_err(|e| format!("open catalog: {e}"))?;
                migrate(&conn)?;
                *state.conn.lock() = Some(conn);
                *state.library_root.lock() = Some(r.clone());
                r
            }
        }
    };

    let source = PathBuf::from(&payload.source_path);
    validate_source_path(&source)?;

    let id = Uuid::new_v4().to_string();
    let file_name = source
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("dataset")
        .to_string();
    let display_name = payload
        .display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| file_name.clone());
    let mode = payload
        .mode
        .as_deref()
        .unwrap_or("copy")
        .to_ascii_lowercase();
    let preview_only = payload.preview_only.unwrap_or(true);

    if let Some(ref preview) = payload.preview_geojson {
        if preview.len() > MAX_PREVIEW_CHARS {
            return Err(format!(
                "Preview GeoJSON exceeds {} MB IPC budget",
                MAX_PREVIEW_CHARS / (1024 * 1024)
            ));
        }
    }

    let managed_original = if mode == "link" {
        source.to_string_lossy().to_string()
    } else {
        let meta = fs::metadata(&source).map_err(|e| format!("stat source: {e}"))?;
        if meta.len() > MAX_COPY_BYTES {
            return Err(format!(
                "File is larger than {} MB copy limit — use link mode or a smaller file",
                MAX_COPY_BYTES / (1024 * 1024)
            ));
        }
        let dest = root.join("originals").join(&id).join(&file_name);
        copy_file(&source, &dest)?;
        dest.to_string_lossy().to_string()
    };

    let dataset_dir = root.join("datasets").join(&id);
    fs::create_dir_all(&dataset_dir).map_err(|e| format!("create dataset dir: {e}"))?;

    let preview_path = if let Some(preview) = &payload.preview_geojson {
        let p = dataset_dir.join("preview.geojson");
        write_text(&p, preview)?;
        Some(p.to_string_lossy().to_string())
    } else {
        None
    };

    let ts = now_iso();
    let parent_ids_json = payload
        .parent_ids
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    let derived_op = payload
        .derived_op
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let restorable = payload.restorable.unwrap_or(false);

    let mut manifest = json!({
        "id": id,
        "sourcePath": payload.source_path,
        "managedOriginalPath": managed_original,
        "previewPath": preview_path,
        "mode": mode,
        "importedAt": ts,
        "format": payload.format,
        "featureCount": payload.feature_count,
        "sampledFeatureCount": payload.sampled_feature_count,
        "previewOnly": preview_only,
    });
    if let Some(obj) = manifest.as_object_mut() {
        if let Some(ref parents) = payload.parent_ids {
            obj.insert("parentIds".into(), parents.clone());
        }
        if let Some(ref op) = derived_op {
            obj.insert("derivedOp".into(), json!(op));
        }
        if restorable {
            obj.insert("restorable".into(), json!(true));
        }
    }
    write_text(
        &dataset_dir.join("manifest.json"),
        &serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".into()),
    )?;

    let geometry_types_json = payload
        .geometry_types
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    let property_keys_json = payload
        .property_keys
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    let bbox_json = payload.bbox.as_ref().and_then(|v| serde_json::to_string(v).ok());
    let manifest_json = serde_json::to_string(&manifest).ok();
    let byte_size = payload.byte_size.or_else(|| {
        fs::metadata(&source)
            .ok()
            .map(|m| m.len() as i64)
    });

    with_conn(&state, |conn| {
        conn.execute(
            r#"
            INSERT INTO catalog_item (
                id, display_name, item_type, format, original_filename, original_path,
                managed_original_path, preview_path, working_path, feature_count,
                sampled_feature_count, geometry_types_json, property_keys_json, bbox_json,
                crs_hint, byte_size, status, preview_only, created_at, updated_at,
                last_used_at, description, manifest_json, parent_ids_json, derived_op, restorable
            ) VALUES (
                ?1, ?2, 'vector', ?3, ?4, ?5,
                ?6, ?7, NULL, ?8,
                ?9, ?10, ?11, ?12,
                ?13, ?14, 'ready', ?15, ?16, ?16,
                ?16, ?17, ?18, ?19, ?20, ?21
            )
            "#,
            params![
                id,
                display_name,
                payload.format,
                file_name,
                payload.source_path,
                managed_original,
                preview_path,
                payload.feature_count,
                payload.sampled_feature_count,
                geometry_types_json,
                property_keys_json,
                bbox_json,
                payload.crs_hint,
                byte_size,
                if preview_only { 1 } else { 0 },
                ts,
                payload.description,
                manifest_json,
                parent_ids_json,
                derived_op,
                if restorable { 1 } else { 0 },
            ],
        )
        .map_err(|e| format!("insert catalog item: {e}"))?;
        Ok(())
    })?;

    let item = get_item_by_id(&state, &id)?.ok_or_else(|| "Ingest succeeded but item missing".to_string())?;
    Ok(json!({ "item": item }))
}

#[tauri::command]
pub fn gis_catalog_touch_item(
    state: tauri::State<'_, Arc<GisCatalogState>>,
    id: String,
) -> Result<(), String> {
    let ts = now_iso();
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE catalog_item SET last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![ts, id],
        )
        .map_err(|e| format!("touch item: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn gis_catalog_remove_item(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
    id: String,
    delete_files: Option<bool>,
) -> Result<Value, String> {
    if id.trim().is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid catalog item id".into());
    }
    let item = get_item_by_id(&state, &id)?;
    let delete_files = delete_files.unwrap_or(true);

    with_conn(&state, |conn| {
        conn.execute("DELETE FROM catalog_item WHERE id = ?1", params![id])
            .map_err(|e| format!("delete item: {e}"))?;
        Ok(())
    })?;

    if delete_files {
        let root = state
            .library_root
            .lock()
            .clone()
            .unwrap_or(library_root_path(&app)?);
        let _ = remove_dir_all_best_effort(&root.join("originals").join(&id));
        let _ = remove_dir_all_best_effort(&root.join("datasets").join(&id));
        let _ = remove_dir_all_best_effort(&root.join("tiles").join(&id));
    }

    Ok(json!({ "ok": true, "removed": item }))
}

fn remove_dir_all_best_effort(path: &Path) -> io::Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GisCatalogSetWorkingPathRequest {
    pub id: String,
    pub working_path: String,
    pub checksum: Option<String>,
}

#[tauri::command]
pub fn gis_catalog_set_working_path(
    state: tauri::State<'_, Arc<GisCatalogState>>,
    payload: GisCatalogSetWorkingPathRequest,
) -> Result<Value, String> {
    if payload.id.trim().is_empty()
        || payload.id.contains("..")
        || payload.id.contains('/')
        || payload.id.contains('\\')
    {
        return Err("Invalid catalog item id".into());
    }
    let working = PathBuf::from(&payload.working_path);
    if !working.is_absolute() {
        return Err("workingPath must be absolute".into());
    }
    if payload.working_path.contains("..") {
        return Err("workingPath must not contain ..".into());
    }
    if !working.is_file() {
        return Err(format!("Working file not found: {}", working.display()));
    }
    let ts = now_iso();
    with_conn(&state, |conn| {
        // Store checksum in description-adjacent manifest merge via manifest_json update when present
        let existing: Option<String> = conn
            .query_row(
                "SELECT manifest_json FROM catalog_item WHERE id = ?1",
                params![payload.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("read manifest: {e}"))?;
        let mut manifest_val = existing
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or_else(|| json!({}));
        if let Some(obj) = manifest_val.as_object_mut() {
            obj.insert(
                "workingPath".into(),
                json!(payload.working_path),
            );
            if let Some(sum) = &payload.checksum {
                obj.insert("checksum".into(), json!(sum));
            }
            obj.insert("optimizedAt".into(), json!(ts));
        }
        let manifest_json = serde_json::to_string(&manifest_val).ok();
        let changed = conn
            .execute(
                r#"
                UPDATE catalog_item
                SET working_path = ?1, updated_at = ?2, manifest_json = COALESCE(?3, manifest_json)
                WHERE id = ?4
                "#,
                params![payload.working_path, ts, manifest_json, payload.id],
            )
            .map_err(|e| format!("set working path: {e}"))?;
        if changed == 0 {
            return Err("Catalog item not found".into());
        }
        Ok(())
    })?;
    let item = get_item_by_id(&state, &payload.id)?
        .ok_or_else(|| "Catalog item not found".to_string())?;
    Ok(json!({ "item": item }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GisCatalogSetTilePathRequest {
    pub id: String,
    pub tile_path: String,
    pub min_zoom: Option<i64>,
    pub max_zoom: Option<i64>,
    pub source_layer: Option<String>,
}

#[tauri::command]
pub fn gis_catalog_set_tile_path(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
    payload: GisCatalogSetTilePathRequest,
) -> Result<Value, String> {
    if payload.id.trim().is_empty()
        || payload.id.contains("..")
        || payload.id.contains('/')
        || payload.id.contains('\\')
    {
        return Err("Invalid catalog item id".into());
    }
    let tile = PathBuf::from(&payload.tile_path);
    if !tile.is_absolute() {
        return Err("tilePath must be absolute".into());
    }
    if payload.tile_path.contains("..") {
        return Err("tilePath must not contain ..".into());
    }
    if !tile.is_file() {
        return Err(format!("Tile file not found: {}", tile.display()));
    }
    let root = file_range::library_root(&app, &state)?;
    let _ = file_range::canonicalize_under_library(&root, &tile)?;
    let ts = now_iso();
    with_conn(&state, |conn| {
        let existing: Option<String> = conn
            .query_row(
                "SELECT manifest_json FROM catalog_item WHERE id = ?1",
                params![payload.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("read manifest: {e}"))?;
        let mut manifest_val = existing
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or_else(|| json!({}));
        if let Some(obj) = manifest_val.as_object_mut() {
            obj.insert("tilePath".into(), json!(payload.tile_path));
            if let Some(z) = payload.min_zoom {
                obj.insert("tileMinZoom".into(), json!(z));
            }
            if let Some(z) = payload.max_zoom {
                obj.insert("tileMaxZoom".into(), json!(z));
            }
            if let Some(layer) = &payload.source_layer {
                obj.insert("tileSourceLayer".into(), json!(layer));
            }
            obj.insert("tiledAt".into(), json!(ts));
        }
        let manifest_json = serde_json::to_string(&manifest_val).ok();
        let changed = conn
            .execute(
                r#"
                UPDATE catalog_item
                SET tile_path = ?1, updated_at = ?2, manifest_json = COALESCE(?3, manifest_json)
                WHERE id = ?4
                "#,
                params![payload.tile_path, ts, manifest_json, payload.id],
            )
            .map_err(|e| format!("set tile path: {e}"))?;
        if changed == 0 {
            return Err("Catalog item not found".into());
        }
        Ok(())
    })?;
    let item = get_item_by_id(&state, &payload.id)?
        .ok_or_else(|| "Catalog item not found".to_string())?;
    Ok(json!({ "item": item }))
}

/// Read preview.geojson for an item (capped).
#[tauri::command]
pub fn gis_catalog_read_preview(
    state: tauri::State<'_, Arc<GisCatalogState>>,
    id: String,
) -> Result<Value, String> {
    let item = get_item_by_id(&state, &id)?.ok_or_else(|| "Item not found".to_string())?;
    let preview_path = item
        .get("previewPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Item has no preview file".to_string())?;
    let path = PathBuf::from(preview_path);
    if !path.is_file() {
        return Err("Preview file missing on disk".into());
    }
    let meta = fs::metadata(&path).map_err(|e| format!("stat preview: {e}"))?;
    if meta.len() > MAX_PREVIEW_CHARS as u64 {
        return Err("Preview file exceeds read budget".into());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read preview: {e}"))?;
    let geojson: Value =
        serde_json::from_str(&text).map_err(|e| format!("parse preview GeoJSON: {e}"))?;
    Ok(json!({ "item": item, "geojson": geojson }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GisCatalogUpdateMetaRequest {
    pub id: String,
    pub favorite: Option<bool>,
    pub tags: Option<Value>,
    pub folder: Option<String>,
}

/// Update portal metadata (favorite / tags / folder). Does not touch geometry paths.
#[tauri::command]
pub fn gis_catalog_update_meta(
    state: tauri::State<'_, Arc<GisCatalogState>>,
    payload: GisCatalogUpdateMetaRequest,
) -> Result<Value, String> {
    if payload.id.trim().is_empty()
        || payload.id.contains("..")
        || payload.id.contains('/')
        || payload.id.contains('\\')
    {
        return Err("Invalid catalog item id".into());
    }
    if payload.favorite.is_none() && payload.tags.is_none() && payload.folder.is_none() {
        return Err("Nothing to update".into());
    }
    let ts = now_iso();
    let tags_json = payload
        .tags
        .as_ref()
        .and_then(|v| {
            if v.is_null() {
                Some("[]".to_string())
            } else {
                serde_json::to_string(v).ok()
            }
        });
    let folder = payload.folder.as_ref().map(|s| {
        let t = s.trim();
        if t.contains("..") {
            "".to_string()
        } else {
            t.chars().take(120).collect::<String>()
        }
    });

    with_conn(&state, |conn| {
        let changed = conn
            .execute(
                r#"
                UPDATE catalog_item SET
                    favorite = COALESCE(?1, favorite),
                    tags_json = COALESCE(?2, tags_json),
                    folder = COALESCE(?3, folder),
                    updated_at = ?4
                WHERE id = ?5
                "#,
                params![
                    payload.favorite.map(|f| if f { 1i64 } else { 0 }),
                    tags_json,
                    folder,
                    ts,
                    payload.id,
                ],
            )
            .map_err(|e| format!("update meta: {e}"))?;
        if changed == 0 {
            return Err("Catalog item not found".into());
        }
        Ok(())
    })?;

    let item = get_item_by_id(&state, &payload.id)?
        .ok_or_else(|| "Catalog item not found".to_string())?;
    Ok(json!({ "item": item }))
}

fn dir_byte_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let walk = fs::read_dir(path);
    let Ok(entries) = walk else {
        return 0;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            total = total.saturating_add(dir_byte_size(&p));
        } else if let Ok(meta) = entry.metadata() {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

/// Disk usage summary for the Local GIS Library folder (not Atlas).
#[tauri::command]
pub fn gis_catalog_storage_stats(
    app: AppHandle,
    state: tauri::State<'_, Arc<GisCatalogState>>,
) -> Result<Value, String> {
    let root = {
        let locked = state.library_root.lock().clone();
        match locked {
            Some(r) => r,
            None => library_root_path(&app)?,
        }
    };
    ensure_library_dirs(&root)?;

    let item_count: i64 = with_conn(&state, |conn| {
        conn.query_row("SELECT COUNT(*) FROM catalog_item", [], |row| row.get(0))
            .map_err(|e| format!("count items: {e}"))
    })
    .unwrap_or(0);

    let favorites: i64 = with_conn(&state, |conn| {
        conn.query_row(
            "SELECT COUNT(*) FROM catalog_item WHERE favorite != 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("count favorites: {e}"))
    })
    .unwrap_or(0);

    let total_bytes = dir_byte_size(&root);
    let originals = dir_byte_size(&root.join("originals"));
    let datasets = dir_byte_size(&root.join("datasets"));
    let tiles = dir_byte_size(&root.join("tiles"));

    Ok(json!({
        "libraryRoot": root.to_string_lossy(),
        "itemCount": item_count,
        "favoriteCount": favorites,
        "totalBytes": total_bytes,
        "originalsBytes": originals,
        "datasetsBytes": datasets,
        "tilesBytes": tiles,
    }))
}
