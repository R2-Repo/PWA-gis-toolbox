use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub struct AtlasDbState {
    conn: Mutex<Option<Connection>>,
}

impl Default for AtlasDbState {
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
    Ok(dir.join("network-atlas.sqlite"))
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS import_batch (
            id TEXT PRIMARY KEY,
            batch_date TEXT,
            imported_at TEXT NOT NULL,
            workbook_name TEXT,
            atms_name TEXT
        );
        CREATE TABLE IF NOT EXISTS raw_source_record (
            id TEXT PRIMARY KEY,
            batch_id TEXT,
            source TEXT,
            payload_json TEXT
        );
        CREATE TABLE IF NOT EXISTS hub (
            id TEXT PRIMARY KEY,
            hub_code TEXT NOT NULL UNIQUE,
            name TEXT,
            lat REAL,
            lon REAL,
            region_id TEXT
        );
        CREATE TABLE IF NOT EXISTS channel (
            id TEXT PRIMARY KEY,
            channel_number TEXT NOT NULL UNIQUE,
            primary_hub_id TEXT,
            secondary_hub_id TEXT,
            primary_hub_code TEXT,
            secondary_hub_code TEXT
        );
        CREATE TABLE IF NOT EXISTS site (
            id TEXT PRIMARY KEY,
            inventory_name TEXT,
            site_id TEXT,
            lat REAL,
            lon REAL
        );
        CREATE TABLE IF NOT EXISTS drop_node (
            id TEXT PRIMARY KEY,
            channel_id TEXT,
            channel_number TEXT,
            drop_number INTEGER,
            site_id TEXT,
            inventory_name TEXT,
            lat REAL,
            lon REAL,
            device_id TEXT,
            ip TEXT,
            model TEXT,
            manufacturer TEXT,
            wireless INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS device (
            id TEXT PRIMARY KEY,
            drop_id TEXT,
            ip TEXT,
            device_type TEXT,
            manufacturer TEXT,
            model TEXT,
            status TEXT,
            inventory_name TEXT,
            gateway TEXT,
            subnet TEXT,
            subnet_mask TEXT,
            pri_hub TEXT,
            sec_hub TEXT,
            source TEXT,
            lat REAL,
            lon REAL,
            provisional INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reconciliation_finding (
            id TEXT PRIMARY KEY,
            finding_type TEXT,
            severity TEXT,
            description TEXT,
            suggested_action TEXT,
            status TEXT,
            notes TEXT,
            created_at TEXT,
            resolved_at TEXT,
            entity_id TEXT,
            entity_kind TEXT,
            ip TEXT,
            source_record_ids_json TEXT
        );
        CREATE TABLE IF NOT EXISTS ping_session (
            id TEXT PRIMARY KEY,
            label TEXT,
            started_at TEXT,
            stopped_at TEXT
        );
        CREATE TABLE IF NOT EXISTS ping_result (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            target_ip TEXT,
            status TEXT,
            rtt_ms REAL,
            error TEXT,
            at TEXT
        );
        CREATE TABLE IF NOT EXISTS atlas_pref (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        "#,
    )
    .map_err(|e| format!("migrate: {e}"))?;
    // Additive columns for DBs created before entity_kind/ip existed
    let _ = conn.execute("ALTER TABLE reconciliation_finding ADD COLUMN entity_kind TEXT", []);
    let _ = conn.execute("ALTER TABLE reconciliation_finding ADD COLUMN ip TEXT", []);
    Ok(())
}

fn with_conn<T>(
    state: &AtlasDbState,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.conn.lock();
    let conn = guard
        .as_ref()
        .ok_or_else(|| "Atlas database is not open".to_string())?;
    f(conn)
}

#[tauri::command]
pub fn atlas_db_open(app: AppHandle, state: tauri::State<'_, Arc<AtlasDbState>>) -> Result<(), String> {
    let path = db_path(&app)?;
    let conn = Connection::open(&path).map_err(|e| format!("open sqlite: {e}"))?;
    migrate(&conn)?;
    *state.conn.lock() = Some(conn);
    Ok(())
}

fn load_snapshot_inner(conn: &Connection) -> Result<Value, String> {
    let mut hubs = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, hub_code, name, lat, lon, region_id FROM hub ORDER BY hub_code")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "hubCode": r.get::<_, String>(1)?,
                    "name": r.get::<_, Option<String>>(2)?,
                    "lat": r.get::<_, Option<f64>>(3)?,
                    "lon": r.get::<_, Option<f64>>(4)?,
                    "regionId": r.get::<_, Option<String>>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            hubs.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut channels = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, channel_number, primary_hub_id, secondary_hub_id, primary_hub_code, secondary_hub_code FROM channel ORDER BY channel_number",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "channelNumber": r.get::<_, String>(1)?,
                    "primaryHubId": r.get::<_, Option<String>>(2)?,
                    "secondaryHubId": r.get::<_, Option<String>>(3)?,
                    "primaryHubCode": r.get::<_, Option<String>>(4)?,
                    "secondaryHubCode": r.get::<_, Option<String>>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            channels.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut sites = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, inventory_name, site_id, lat, lon FROM site")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "inventoryName": r.get::<_, Option<String>>(1)?,
                    "siteId": r.get::<_, Option<String>>(2)?,
                    "lat": r.get::<_, Option<f64>>(3)?,
                    "lon": r.get::<_, Option<f64>>(4)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            sites.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut drops = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, channel_id, channel_number, drop_number, site_id, inventory_name, lat, lon, device_id, ip, model, manufacturer, wireless FROM drop_node",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "channelId": r.get::<_, Option<String>>(1)?,
                    "channelNumber": r.get::<_, Option<String>>(2)?,
                    "dropNumber": r.get::<_, Option<i64>>(3)?,
                    "siteId": r.get::<_, Option<String>>(4)?,
                    "inventoryName": r.get::<_, Option<String>>(5)?,
                    "lat": r.get::<_, Option<f64>>(6)?,
                    "lon": r.get::<_, Option<f64>>(7)?,
                    "deviceId": r.get::<_, Option<String>>(8)?,
                    "ip": r.get::<_, Option<String>>(9)?,
                    "model": r.get::<_, Option<String>>(10)?,
                    "manufacturer": r.get::<_, Option<String>>(11)?,
                    "wireless": r.get::<_, i64>(12)? != 0,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            drops.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut devices = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, drop_id, ip, device_type, manufacturer, model, status, inventory_name, gateway, subnet, subnet_mask, pri_hub, sec_hub, source, lat, lon, provisional FROM device",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "dropId": r.get::<_, Option<String>>(1)?,
                    "ip": r.get::<_, Option<String>>(2)?,
                    "deviceType": r.get::<_, Option<String>>(3)?,
                    "manufacturer": r.get::<_, Option<String>>(4)?,
                    "model": r.get::<_, Option<String>>(5)?,
                    "status": r.get::<_, Option<String>>(6)?,
                    "inventoryName": r.get::<_, Option<String>>(7)?,
                    "gateway": r.get::<_, Option<String>>(8)?,
                    "subnet": r.get::<_, Option<String>>(9)?,
                    "subnetMask": r.get::<_, Option<String>>(10)?,
                    "priHub": r.get::<_, Option<String>>(11)?,
                    "secHub": r.get::<_, Option<String>>(12)?,
                    "source": r.get::<_, Option<String>>(13)?,
                    "lat": r.get::<_, Option<f64>>(14)?,
                    "lon": r.get::<_, Option<f64>>(15)?,
                    "provisional": r.get::<_, i64>(16)? != 0,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            devices.push(row.map_err(|e| e.to_string())?);
        }
    }

    let mut findings = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, finding_type, severity, description, suggested_action, status, notes, created_at, resolved_at, entity_id, entity_kind, ip, source_record_ids_json FROM reconciliation_finding",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let src: Option<String> = r.get(12)?;
                let source_ids: Value = src
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(|| json!([]));
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "findingType": r.get::<_, Option<String>>(1)?,
                    "severity": r.get::<_, Option<String>>(2)?,
                    "description": r.get::<_, Option<String>>(3)?,
                    "suggestedAction": r.get::<_, Option<String>>(4)?,
                    "status": r.get::<_, Option<String>>(5)?,
                    "notes": r.get::<_, Option<String>>(6)?,
                    "createdAt": r.get::<_, Option<String>>(7)?,
                    "resolvedAt": r.get::<_, Option<String>>(8)?,
                    "entityId": r.get::<_, Option<String>>(9)?,
                    "entityKind": r.get::<_, Option<String>>(10)?,
                    "ip": r.get::<_, Option<String>>(11)?,
                    "sourceRecordIds": source_ids,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            findings.push(row.map_err(|e| e.to_string())?);
        }
    }

    let last_import = conn
        .query_row(
            "SELECT id, batch_date, imported_at, workbook_name, atms_name FROM import_batch ORDER BY imported_at DESC LIMIT 1",
            [],
            |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "batchDate": r.get::<_, Option<String>>(1)?,
                    "importedAt": r.get::<_, String>(2)?,
                    "workbookName": r.get::<_, Option<String>>(3)?,
                    "atmsName": r.get::<_, Option<String>>(4)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    // Latest ping status per IP (survive restart + import)
    let mut ping_results = serde_json::Map::new();
    {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT pr.target_ip, pr.status, pr.rtt_ms, pr.error, pr.at
                FROM ping_result pr
                INNER JOIN (
                    SELECT target_ip, MAX(rowid) AS max_rowid
                    FROM ping_result
                    WHERE target_ip IS NOT NULL AND target_ip != ''
                    GROUP BY target_ip
                ) latest ON pr.rowid = latest.max_rowid
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    json!({
                        "status": r.get::<_, Option<String>>(1)?.unwrap_or_else(|| "untested".into()),
                        "rttMs": r.get::<_, Option<f64>>(2)?,
                        "error": r.get::<_, Option<String>>(3)?,
                        "at": r.get::<_, Option<String>>(4)?,
                    }),
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ip, entry) = row.map_err(|e| e.to_string())?;
            ping_results.insert(ip, entry);
        }
    }

    Ok(json!({
        "hubs": hubs,
        "channels": channels,
        "sites": sites,
        "drops": drops,
        "devices": devices,
        "findings": findings,
        "pingResults": ping_results,
        "lastImport": last_import,
    }))
}

#[tauri::command]
pub fn atlas_db_load_snapshot(state: tauri::State<'_, Arc<AtlasDbState>>) -> Result<Value, String> {
    with_conn(&state, load_snapshot_inner)
}

fn json_str(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| {
        if x.is_null() {
            None
        } else if let Some(s) = x.as_str() {
            Some(s.to_string())
        } else {
            Some(x.to_string())
        }
    })
}

fn json_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|i| i as f64)))
}

fn json_i64(v: Option<&Value>) -> Option<i64> {
    v.and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
}

#[tauri::command]
pub fn atlas_import_apply(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

        // Replace network entity tables. Keep ping_session / ping_result (keyed by IP).
        tx.execute_batch(
            r#"
            DELETE FROM reconciliation_finding;
            DELETE FROM device;
            DELETE FROM drop_node;
            DELETE FROM site;
            DELETE FROM channel;
            DELETE FROM hub;
            DELETE FROM raw_source_record;
            "#,
        )
        .map_err(|e| e.to_string())?;

        let batch = payload.get("batch").ok_or("missing batch")?;
        tx.execute(
            "INSERT INTO import_batch (id, batch_date, imported_at, workbook_name, atms_name) VALUES (?1,?2,?3,?4,?5)",
            params![
                json_str(batch.get("id")).unwrap_or_default(),
                json_str(batch.get("batchDate")),
                json_str(batch.get("importedAt")).unwrap_or_default(),
                json_str(batch.get("workbookName")),
                json_str(batch.get("atmsName")),
            ],
        )
        .map_err(|e| e.to_string())?;

        if let Some(arr) = payload.get("rawRecords").and_then(|v| v.as_array()) {
            for r in arr {
                let payload_json = r
                    .get("payload")
                    .map(|p| p.to_string())
                    .unwrap_or_else(|| "{}".into());
                tx.execute(
                    "INSERT INTO raw_source_record (id, batch_id, source, payload_json) VALUES (?1,?2,?3,?4)",
                    params![
                        json_str(r.get("id")).unwrap_or_default(),
                        json_str(r.get("batchId")),
                        json_str(r.get("source")),
                        payload_json,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(arr) = payload.get("hubs").and_then(|v| v.as_array()) {
            for h in arr {
                tx.execute(
                    "INSERT OR REPLACE INTO hub (id, hub_code, name, lat, lon, region_id) VALUES (?1,?2,?3,?4,?5,?6)",
                    params![
                        json_str(h.get("id")).unwrap_or_default(),
                        json_str(h.get("hubCode")).unwrap_or_default(),
                        json_str(h.get("name")),
                        json_f64(h.get("lat")),
                        json_f64(h.get("lon")),
                        json_str(h.get("regionId")),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(arr) = payload.get("channels").and_then(|v| v.as_array()) {
            for c in arr {
                tx.execute(
                    "INSERT OR REPLACE INTO channel (id, channel_number, primary_hub_id, secondary_hub_id, primary_hub_code, secondary_hub_code) VALUES (?1,?2,?3,?4,?5,?6)",
                    params![
                        json_str(c.get("id")).unwrap_or_default(),
                        json_str(c.get("channelNumber")).unwrap_or_default(),
                        json_str(c.get("primaryHubId")),
                        json_str(c.get("secondaryHubId")),
                        json_str(c.get("primaryHubCode")),
                        json_str(c.get("secondaryHubCode")),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(arr) = payload.get("sites").and_then(|v| v.as_array()) {
            for s in arr {
                tx.execute(
                    "INSERT OR REPLACE INTO site (id, inventory_name, site_id, lat, lon) VALUES (?1,?2,?3,?4,?5)",
                    params![
                        json_str(s.get("id")).unwrap_or_default(),
                        json_str(s.get("inventoryName")),
                        json_str(s.get("siteId")),
                        json_f64(s.get("lat")),
                        json_f64(s.get("lon")),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(arr) = payload.get("drops").and_then(|v| v.as_array()) {
            for d in arr {
                let wireless = d
                    .get("wireless")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false) as i64;
                tx.execute(
                    "INSERT OR REPLACE INTO drop_node (id, channel_id, channel_number, drop_number, site_id, inventory_name, lat, lon, device_id, ip, model, manufacturer, wireless) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![
                        json_str(d.get("id")).unwrap_or_default(),
                        json_str(d.get("channelId")),
                        json_str(d.get("channelNumber")),
                        json_i64(d.get("dropNumber")),
                        json_str(d.get("siteId")),
                        json_str(d.get("inventoryName")),
                        json_f64(d.get("lat")),
                        json_f64(d.get("lon")),
                        json_str(d.get("deviceId")),
                        json_str(d.get("ip")),
                        json_str(d.get("model")),
                        json_str(d.get("manufacturer")),
                        wireless,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(arr) = payload.get("devices").and_then(|v| v.as_array()) {
            for d in arr {
                let provisional = d
                    .get("provisional")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false) as i64;
                tx.execute(
                    "INSERT OR REPLACE INTO device (id, drop_id, ip, device_type, manufacturer, model, status, inventory_name, gateway, subnet, subnet_mask, pri_hub, sec_hub, source, lat, lon, provisional) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
                    params![
                        json_str(d.get("id")).unwrap_or_default(),
                        json_str(d.get("dropId")),
                        json_str(d.get("ip")),
                        json_str(d.get("deviceType")),
                        json_str(d.get("manufacturer")),
                        json_str(d.get("model")),
                        json_str(d.get("status")),
                        json_str(d.get("inventoryName")),
                        json_str(d.get("gateway")),
                        json_str(d.get("subnet")),
                        json_str(d.get("subnetMask")),
                        json_str(d.get("priHub")),
                        json_str(d.get("secHub")),
                        json_str(d.get("source")),
                        json_f64(d.get("lat")),
                        json_f64(d.get("lon")),
                        provisional,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(arr) = payload.get("findings").and_then(|v| v.as_array()) {
            for f in arr {
                let src = f
                    .get("sourceRecordIds")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "[]".into());
                tx.execute(
                    "INSERT OR REPLACE INTO reconciliation_finding (id, finding_type, severity, description, suggested_action, status, notes, created_at, resolved_at, entity_id, entity_kind, ip, source_record_ids_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![
                        json_str(f.get("id")).unwrap_or_default(),
                        json_str(f.get("findingType")),
                        json_str(f.get("severity")),
                        json_str(f.get("description")),
                        json_str(f.get("suggestedAction")),
                        json_str(f.get("status")),
                        json_str(f.get("notes")),
                        json_str(f.get("createdAt")),
                        json_str(f.get("resolvedAt")),
                        json_str(f.get("entityId")),
                        json_str(f.get("entityKind")),
                        json_str(f.get("ip")),
                        src,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(payload
            .get("summary")
            .cloned()
            .unwrap_or_else(|| json!({ "ok": true })))
    })
}

#[tauri::command]
pub fn atlas_ping_save(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let session_id = json_str(payload.get("sessionId")).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let label = json_str(payload.get("label"));
        let now = chrono_like_now();
        conn.execute(
            "INSERT OR REPLACE INTO ping_session (id, label, started_at, stopped_at) VALUES (?1,?2,?3,?4)",
            params![session_id, label, now, now],
        )
        .map_err(|e| e.to_string())?;
        if let Some(arr) = payload.get("results").and_then(|v| v.as_array()) {
            for r in arr {
                let id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO ping_result (id, session_id, target_ip, status, rtt_ms, error, at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        id,
                        session_id,
                        json_str(r.get("ip")),
                        json_str(r.get("status")),
                        json_f64(r.get("rttMs")),
                        json_str(r.get("error")),
                        json_str(r.get("at")).unwrap_or(now.clone()),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
}

fn chrono_like_now() -> String {
    // Prefer ISO-8601 UTC when available (Windows); fall back to unix seconds.
    #[cfg(windows)]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        if let Ok(dur) = SystemTime::now().duration_since(UNIX_EPOCH) {
            let secs = dur.as_secs();
            // Minimal UTC formatting without chrono crate
            // JS side accepts unix seconds or ISO; emit seconds for stability.
            // Frontend formatPingWhen handles both.
            return secs.to_string();
        }
    }
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[tauri::command]
pub fn atlas_finding_update(
    finding_id: String,
    patch: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let status = json_str(patch.get("status"));
        let notes = json_str(patch.get("notes"));
        let resolved = if status.as_deref() == Some("Resolved") {
            Some(chrono_like_now())
        } else {
            None
        };
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM reconciliation_finding WHERE id = ?1",
                params![finding_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if existing.is_none() {
            return Ok(());
        }
        conn.execute(
            "UPDATE reconciliation_finding SET status = COALESCE(?2, status), notes = COALESCE(?3, notes), resolved_at = COALESCE(?4, resolved_at) WHERE id = ?1",
            params![finding_id, status, notes, resolved],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
