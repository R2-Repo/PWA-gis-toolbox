use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub struct UdotFiberDbState {
    conn: Mutex<Option<Connection>>,
}

impl Default for UdotFiberDbState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("udot-fiber-network.sqlite"))
}

const ALLOWED_LAYER_KEYS: &[&str] = &[
    "cabinets",
    "splices",
    "boxes",
    "fiber",
    "conduit",
    "building",
];

fn assert_layer_key(layer_key: &str) -> Result<(), String> {
    if ALLOWED_LAYER_KEYS.contains(&layer_key) {
        Ok(())
    } else {
        Err(format!("unsupported UDOT Fiber layerKey: {layer_key}"))
    }
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS sync_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS features (
            layer_key TEXT NOT NULL,
            object_id TEXT NOT NULL,
            layer_id INTEGER,
            updatedate TEXT,
            geometry_json TEXT,
            properties_json TEXT NOT NULL,
            PRIMARY KEY (layer_key, object_id)
        );
        CREATE INDEX IF NOT EXISTS idx_features_layer ON features(layer_key);
        "#,
    )
    .map_err(|e| format!("migrate: {e}"))?;
    Ok(())
}

fn with_conn<T>(
    state: &UdotFiberDbState,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.conn.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "UDOT Fiber database is not open".to_string())?;
    f(conn)
}

#[tauri::command]
pub fn udot_fiber_db_open(
    app: AppHandle,
    state: tauri::State<'_, Arc<UdotFiberDbState>>,
) -> Result<(), String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| format!("open sqlite: {e}"))?;
    migrate(&conn)?;
    *state.conn.lock() = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn udot_fiber_get_sync_meta(
    state: tauri::State<'_, Arc<UdotFiberDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let row: Option<String> = conn
            .query_row(
                "SELECT payload_json FROM sync_meta WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match row {
            Some(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
            None => Ok(json!({
                "lastSyncAt": null,
                "layerCounts": {},
                "lastError": null
            })),
        }
    })
}

#[tauri::command]
pub fn udot_fiber_set_sync_meta(
    state: tauri::State<'_, Arc<UdotFiberDbState>>,
    payload: Value,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let text = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_meta (id, payload_json) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json",
            params![text],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn udot_fiber_replace_layer(
    state: tauri::State<'_, Arc<UdotFiberDbState>>,
    payload: Value,
) -> Result<Value, String> {
    let layer_key = payload
        .get("layerKey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "layerKey required".to_string())?
        .to_string();
    assert_layer_key(&layer_key)?;
    let layer_id = payload
        .get("layerId")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let features = payload
        .get("features")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    with_conn(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM features WHERE layer_key = ?1", params![&layer_key])
            .map_err(|e| e.to_string())?;

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO features (layer_key, object_id, layer_id, updatedate, geometry_json, properties_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|e| e.to_string())?;

            for (i, feature) in features.iter().enumerate() {
                let props = feature.get("properties").cloned().unwrap_or(json!({}));
                let object_id = props
                    .get("OBJECTID")
                    .or_else(|| props.get("objectid"))
                    .map(|v| match v {
                        Value::Number(n) => n.to_string(),
                        Value::String(s) => s.clone(),
                        _ => format!("{i}"),
                    })
                    .unwrap_or_else(|| format!("{i}"));
                let updatedate = props
                    .get("UPDATEDATE")
                    .or_else(|| props.get("updatedate"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let geometry_json = feature
                    .get("geometry")
                    .map(|g| serde_json::to_string(g).unwrap_or_else(|_| "null".into()))
                    .unwrap_or_else(|| "null".into());
                let props_json = serde_json::to_string(&props).map_err(|e| e.to_string())?;
                stmt.execute(params![
                    &layer_key,
                    object_id,
                    layer_id,
                    updatedate,
                    geometry_json,
                    props_json
                ])
                .map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({ "layerKey": layer_key, "featureCount": features.len() }))
    })
}

fn load_layer_features(conn: &Connection, layer_key: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT object_id, geometry_json, properties_json FROM features WHERE layer_key = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![layer_key], |r| {
            let geometry_json: String = r.get(1)?;
            let props_json: String = r.get(2)?;
            Ok((geometry_json, props_json))
        })
        .map_err(|e| e.to_string())?;

    let mut features = Vec::new();
    for row in rows {
        let (geometry_json, props_json) = row.map_err(|e| e.to_string())?;
        let geometry: Value = serde_json::from_str(&geometry_json).unwrap_or(Value::Null);
        let properties: Value = serde_json::from_str(&props_json).unwrap_or(json!({}));
        features.push(json!({
            "type": "Feature",
            "geometry": geometry,
            "properties": properties
        }));
    }
    Ok(features)
}

#[tauri::command]
pub fn udot_fiber_load_layer(
    state: tauri::State<'_, Arc<UdotFiberDbState>>,
    payload: Value,
) -> Result<Value, String> {
    let layer_key = payload
        .get("layerKey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "layerKey required".to_string())?;
    assert_layer_key(layer_key)?;
    with_conn(&state, |conn| {
        let features = load_layer_features(conn, layer_key)?;
        Ok(json!({
            "type": "FeatureCollection",
            "features": features
        }))
    })
}

#[tauri::command]
pub fn udot_fiber_load_all_layers(
    state: tauri::State<'_, Arc<UdotFiberDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let keys = [
            "cabinets",
            "splices",
            "boxes",
            "fiber",
            "conduit",
            "building",
        ];
        let mut layers = serde_json::Map::new();
        for key in keys {
            let features = load_layer_features(conn, key)?;
            layers.insert(
                key.to_string(),
                json!({
                    "type": "FeatureCollection",
                    "features": features
                }),
            );
        }
        Ok(json!({ "layers": layers }))
    })
}
