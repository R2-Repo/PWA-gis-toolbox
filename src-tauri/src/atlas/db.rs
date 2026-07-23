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
            atms_name TEXT,
            summary_json TEXT
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
            region_id TEXT,
            aka TEXT,
            hub_ip TEXT,
            channels_subnet TEXT,
            is_shed INTEGER
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
        CREATE TABLE IF NOT EXISTS connected_building (
            id TEXT PRIMARY KEY,
            building_name TEXT NOT NULL,
            building_type TEXT,
            provider TEXT,
            status TEXT,
            from_hub TEXT,
            to_hub TEXT,
            address TEXT,
            lat REAL,
            lon REAL,
            region_id TEXT,
            switch_1_ip TEXT,
            switch_2_ip TEXT,
            desktop_1_ip TEXT,
            desktop_2_ip TEXT,
            decoder_1_ip TEXT,
            decoder_2_ip TEXT,
            decoder_3_ip TEXT,
            decoder_4_ip TEXT,
            decoder_5_ip TEXT,
            decoder_6_ip TEXT,
            decoder_7_ip TEXT,
            decoder_8_ip TEXT,
            decoder_9_ip TEXT,
            decoder_10_ip TEXT
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
    let _ = conn.execute("ALTER TABLE import_batch ADD COLUMN summary_json TEXT", []);
    let _ = conn.execute("ALTER TABLE hub ADD COLUMN aka TEXT", []);
    let _ = conn.execute("ALTER TABLE hub ADD COLUMN hub_ip TEXT", []);
    let _ = conn.execute("ALTER TABLE hub ADD COLUMN channels_subnet TEXT", []);
    let _ = conn.execute("ALTER TABLE hub ADD COLUMN is_shed INTEGER", []);
    let _ = conn.execute("ALTER TABLE drop_node ADD COLUMN parent_drop_id TEXT", []);
    let _ = conn.execute("ALTER TABLE drop_node ADD COLUMN wireless_hop_type TEXT", []);
    Ok(())
}

fn parse_summary_json(raw: Option<String>) -> Value {
    raw.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            return None;
        }
        serde_json::from_str::<Value>(t).ok()
    })
    .unwrap_or(Value::Null)
}

fn import_batch_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, String>(0)?,
        "batchDate": r.get::<_, Option<String>>(1)?,
        "importedAt": r.get::<_, String>(2)?,
        "workbookName": r.get::<_, Option<String>>(3)?,
        "atmsName": r.get::<_, Option<String>>(4)?,
        "summary": parse_summary_json(r.get::<_, Option<String>>(5)?),
    }))
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
            .prepare(
                "SELECT id, hub_code, name, lat, lon, region_id, aka, hub_ip, channels_subnet, is_shed FROM hub ORDER BY hub_code",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let is_shed: Option<i64> = r.get(9)?;
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "hubCode": r.get::<_, String>(1)?,
                    "name": r.get::<_, Option<String>>(2)?,
                    "lat": r.get::<_, Option<f64>>(3)?,
                    "lon": r.get::<_, Option<f64>>(4)?,
                    "regionId": r.get::<_, Option<String>>(5)?,
                    "aka": r.get::<_, Option<String>>(6)?,
                    "hubIp": r.get::<_, Option<String>>(7)?,
                    "channelsSubnet": r.get::<_, Option<String>>(8)?,
                    "isShed": is_shed.map(|v| v != 0).unwrap_or(false),
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
                "SELECT id, channel_id, channel_number, drop_number, site_id, inventory_name, lat, lon, device_id, ip, model, manufacturer, wireless, parent_drop_id, wireless_hop_type FROM drop_node",
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
                    "parentDropId": r.get::<_, Option<String>>(13)?,
                    "wirelessHopType": r.get::<_, Option<String>>(14)?,
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

    let mut connected_buildings = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, building_name, building_type, provider, status, from_hub, to_hub, address, lat, lon, region_id, \
                 switch_1_ip, switch_2_ip, desktop_1_ip, desktop_2_ip, \
                 decoder_1_ip, decoder_2_ip, decoder_3_ip, decoder_4_ip, decoder_5_ip, \
                 decoder_6_ip, decoder_7_ip, decoder_8_ip, decoder_9_ip, decoder_10_ip \
                 FROM connected_building ORDER BY building_name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "buildingName": r.get::<_, String>(1)?,
                    "buildingType": r.get::<_, Option<String>>(2)?,
                    "provider": r.get::<_, Option<String>>(3)?,
                    "status": r.get::<_, Option<String>>(4)?,
                    "fromHub": r.get::<_, Option<String>>(5)?,
                    "toHub": r.get::<_, Option<String>>(6)?,
                    "address": r.get::<_, Option<String>>(7)?,
                    "lat": r.get::<_, Option<f64>>(8)?,
                    "lon": r.get::<_, Option<f64>>(9)?,
                    "regionId": r.get::<_, Option<String>>(10)?,
                    "switch1Ip": r.get::<_, Option<String>>(11)?,
                    "switch2Ip": r.get::<_, Option<String>>(12)?,
                    "desktop1Ip": r.get::<_, Option<String>>(13)?,
                    "desktop2Ip": r.get::<_, Option<String>>(14)?,
                    "decoder1Ip": r.get::<_, Option<String>>(15)?,
                    "decoder2Ip": r.get::<_, Option<String>>(16)?,
                    "decoder3Ip": r.get::<_, Option<String>>(17)?,
                    "decoder4Ip": r.get::<_, Option<String>>(18)?,
                    "decoder5Ip": r.get::<_, Option<String>>(19)?,
                    "decoder6Ip": r.get::<_, Option<String>>(20)?,
                    "decoder7Ip": r.get::<_, Option<String>>(21)?,
                    "decoder8Ip": r.get::<_, Option<String>>(22)?,
                    "decoder9Ip": r.get::<_, Option<String>>(23)?,
                    "decoder10Ip": r.get::<_, Option<String>>(24)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            connected_buildings.push(row.map_err(|e| e.to_string())?);
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
            "SELECT id, batch_date, imported_at, workbook_name, atms_name, summary_json FROM import_batch ORDER BY imported_at DESC LIMIT 1",
            [],
            import_batch_row,
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
        "connectedBuildings": connected_buildings,
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
            DELETE FROM connected_building;
            DELETE FROM channel;
            DELETE FROM hub;
            DELETE FROM raw_source_record;
            "#,
        )
        .map_err(|e| e.to_string())?;

        let batch = payload.get("batch").ok_or("missing batch")?;
        let summary_json = payload
            .get("summary")
            .map(|v| v.to_string())
            .or_else(|| batch.get("summary").map(|v| v.to_string()))
            .unwrap_or_else(|| "null".into());
        tx.execute(
            "INSERT INTO import_batch (id, batch_date, imported_at, workbook_name, atms_name, summary_json) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                json_str(batch.get("id")).unwrap_or_default(),
                json_str(batch.get("batchDate")),
                json_str(batch.get("importedAt")).unwrap_or_default(),
                json_str(batch.get("workbookName")),
                json_str(batch.get("atmsName")),
                summary_json,
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
                let is_shed = h
                    .get("isShed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false) as i64;
                tx.execute(
                    "INSERT OR REPLACE INTO hub (id, hub_code, name, lat, lon, region_id, aka, hub_ip, channels_subnet, is_shed) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    params![
                        json_str(h.get("id")).unwrap_or_default(),
                        json_str(h.get("hubCode")).unwrap_or_default(),
                        json_str(h.get("name")),
                        json_f64(h.get("lat")),
                        json_f64(h.get("lon")),
                        json_str(h.get("regionId")),
                        json_str(h.get("aka")),
                        json_str(h.get("hubIp")),
                        json_str(h.get("channelsSubnet")),
                        is_shed,
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
                    "INSERT OR REPLACE INTO drop_node (id, channel_id, channel_number, drop_number, site_id, inventory_name, lat, lon, device_id, ip, model, manufacturer, wireless, parent_drop_id, wireless_hop_type) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
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
                        json_str(d.get("parentDropId")),
                        json_str(d.get("wirelessHopType")),
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

        if let Some(arr) = payload.get("connectedBuildings").and_then(|v| v.as_array()) {
            for b in arr {
                tx.execute(
                    "INSERT OR REPLACE INTO connected_building (
                        id, building_name, building_type, provider, status, from_hub, to_hub, address, lat, lon, region_id,
                        switch_1_ip, switch_2_ip, desktop_1_ip, desktop_2_ip,
                        decoder_1_ip, decoder_2_ip, decoder_3_ip, decoder_4_ip, decoder_5_ip,
                        decoder_6_ip, decoder_7_ip, decoder_8_ip, decoder_9_ip, decoder_10_ip
                    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
                    params![
                        json_str(b.get("id")).unwrap_or_default(),
                        json_str(b.get("buildingName")).unwrap_or_default(),
                        json_str(b.get("buildingType")),
                        json_str(b.get("provider")),
                        json_str(b.get("status")),
                        json_str(b.get("fromHub")),
                        json_str(b.get("toHub")),
                        json_str(b.get("address")),
                        json_f64(b.get("lat")),
                        json_f64(b.get("lon")),
                        json_str(b.get("regionId")),
                        json_str(b.get("switch1Ip")),
                        json_str(b.get("switch2Ip")),
                        json_str(b.get("desktop1Ip")),
                        json_str(b.get("desktop2Ip")),
                        json_str(b.get("decoder1Ip")),
                        json_str(b.get("decoder2Ip")),
                        json_str(b.get("decoder3Ip")),
                        json_str(b.get("decoder4Ip")),
                        json_str(b.get("decoder5Ip")),
                        json_str(b.get("decoder6Ip")),
                        json_str(b.get("decoder7Ip")),
                        json_str(b.get("decoder8Ip")),
                        json_str(b.get("decoder9Ip")),
                        json_str(b.get("decoder10Ip")),
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

        // Keep metadata history bounded (entities/raw are already replaced above).
        // Nested SELECT materializes ids so SQLite allows DELETE on the same table.
        tx.execute(
            r#"
            DELETE FROM import_batch
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id FROM import_batch
                    ORDER BY imported_at DESC
                    LIMIT 50
                )
            )
            "#,
            [],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(payload
            .get("summary")
            .cloned()
            .unwrap_or_else(|| json!({ "ok": true })))
    })
}

/// List past import batch metadata (newest first). Not restorable — apply replaces network tables.
#[tauri::command]
pub fn atlas_import_list_batches(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let limit = payload
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(50)
            .clamp(1, 200);

        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, batch_date, imported_at, workbook_name, atms_name, summary_json
                FROM import_batch
                ORDER BY imported_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], import_batch_row)
            .map_err(|e| e.to_string())?;

        let mut batches = Vec::new();
        for row in rows {
            batches.push(row.map_err(|e| e.to_string())?);
        }
        Ok(json!({ "batches": batches }))
    })
}

#[tauri::command]
pub fn atlas_ping_save(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let session_id =
            json_str(payload.get("sessionId")).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let label = json_str(payload.get("label"));
        let now = chrono_like_now();
        let started_at = json_str(payload.get("startedAt")).unwrap_or_else(|| now.clone());

        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM ping_session WHERE id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if existing.is_none() {
            // First write creates the session; keep stopped_at NULL until finalize.
            conn.execute(
                "INSERT INTO ping_session (id, label, started_at, stopped_at) VALUES (?1,?2,?3,NULL)",
                params![session_id, label, started_at],
            )
            .map_err(|e| e.to_string())?;
        } else if let Some(lbl) = label {
            // Optional label refresh only — never rewrite started_at/stopped_at here.
            conn.execute(
                "UPDATE ping_session SET label = COALESCE(?2, label) WHERE id = ?1",
                params![session_id, lbl],
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(arr) = payload.get("results").and_then(|v| v.as_array()) {
            // Cap batch size to limit DB growth from a compromised renderer.
            for r in arr.iter().take(500) {
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

/// List monitor sessions (excludes one-shot by default).
#[tauri::command]
pub fn atlas_ping_list_sessions(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let limit = payload
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(50)
            .clamp(1, 500);
        let include_one_shot = payload
            .get("includeOneShot")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let sql = if include_one_shot {
            r#"
            SELECT s.id, s.label, s.started_at, s.stopped_at,
                   COUNT(r.id) AS sample_count,
                   COUNT(DISTINCT r.target_ip) AS target_count
            FROM ping_session s
            LEFT JOIN ping_result r ON r.session_id = s.id
            GROUP BY s.id
            ORDER BY COALESCE(s.started_at, '') DESC
            LIMIT ?1
            "#
        } else {
            r#"
            SELECT s.id, s.label, s.started_at, s.stopped_at,
                   COUNT(r.id) AS sample_count,
                   COUNT(DISTINCT r.target_ip) AS target_count
            FROM ping_session s
            LEFT JOIN ping_result r ON r.session_id = s.id
            WHERE COALESCE(s.label, '') != 'one-shot'
            GROUP BY s.id
            ORDER BY COALESCE(s.started_at, '') DESC
            LIMIT ?1
            "#
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "label": r.get::<_, Option<String>>(1)?,
                    "startedAt": r.get::<_, Option<String>>(2)?,
                    "stoppedAt": r.get::<_, Option<String>>(3)?,
                    "sampleCount": r.get::<_, i64>(4)?,
                    "targetCount": r.get::<_, i64>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row.map_err(|e| e.to_string())?);
        }
        Ok(json!({ "sessions": sessions }))
    })
}

/// Load one session + samples.
/// Default: newest-first with `limit` (UI preview).
/// `all: true`: chronological ASC with a high safety cap (full CSV export).
#[tauri::command]
pub fn atlas_ping_load_session(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let session_id = json_str(payload.get("sessionId"))
            .ok_or_else(|| "sessionId is required".to_string())?;
        let load_all = payload
            .get("all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let limit = if load_all {
            payload
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(500_000)
                .clamp(1, 500_000)
        } else {
            payload
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(200)
                .clamp(1, 5000)
        };

        let session: Option<Value> = conn
            .query_row(
                "SELECT id, label, started_at, stopped_at FROM ping_session WHERE id = ?1",
                params![session_id],
                |r| {
                    Ok(json!({
                        "id": r.get::<_, String>(0)?,
                        "label": r.get::<_, Option<String>>(1)?,
                        "startedAt": r.get::<_, Option<String>>(2)?,
                        "stoppedAt": r.get::<_, Option<String>>(3)?,
                    }))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some(session) = session else {
            return Err(format!("Ping session not found: {session_id}"));
        };

        let order = if load_all {
            "ASC"
        } else {
            "DESC"
        };
        let sql = format!(
            r#"
                SELECT target_ip, status, rtt_ms, error, at
                FROM ping_result
                WHERE session_id = ?1
                ORDER BY COALESCE(at, '') {order}
                LIMIT ?2
                "#
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id, limit], |r| {
                Ok(json!({
                    "ip": r.get::<_, Option<String>>(0)?,
                    "status": r.get::<_, Option<String>>(1)?,
                    "rttMs": r.get::<_, Option<f64>>(2)?,
                    "error": r.get::<_, Option<String>>(3)?,
                    "at": r.get::<_, Option<String>>(4)?,
                    "timestamp": r.get::<_, Option<String>>(4)?,
                    "sessionId": session_id.clone(),
                }))
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }

        Ok(json!({
            "session": session,
            "results": results,
            "all": load_all,
        }))
    })
}

/// Mark a session stopped without rewriting started_at or re-inserting samples.
#[tauri::command]
pub fn atlas_ping_finalize_session(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let session_id = json_str(payload.get("sessionId"))
            .ok_or_else(|| "sessionId is required".to_string())?;
        let stopped_at = json_str(payload.get("stoppedAt")).unwrap_or_else(chrono_like_now);
        conn.execute(
            "UPDATE ping_session SET stopped_at = ?2 WHERE id = ?1",
            params![session_id, stopped_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

fn delete_ping_session_row(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM ping_result WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ping_session WHERE id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete one monitor session and its samples.
#[tauri::command]
pub fn atlas_ping_delete_session(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let session_id = json_str(payload.get("sessionId"))
            .ok_or_else(|| "sessionId is required".to_string())?;
        delete_ping_session_row(conn, &session_id)?;
        Ok(())
    })
}

/// Delete many sessions (max 200). Returns how many were removed.
#[tauri::command]
pub fn atlas_ping_delete_sessions(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let ids: Vec<String> = payload
            .get("sessionIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .take(200)
                    .collect()
            })
            .unwrap_or_default();
        let mut deleted = 0i64;
        for id in ids {
            delete_ping_session_row(conn, &id)?;
            deleted += 1;
        }
        Ok(json!({ "deleted": deleted }))
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

fn is_allowed_pref_key(key: &str) -> bool {
    matches!(
        key,
        "monitor.interval"
            | "dashboard.scope"
            | "triage.mode"
            | "sessions.retentionDays"
            | "map.pingFilter"
            | "ping.count"
    )
}

fn is_allowed_pref_value(key: &str, value: &str) -> bool {
    match key {
        "monitor.interval" => matches!(value, "continuous" | "1" | "2" | "5" | "30" | "60"),
        "dashboard.scope" => matches!(value, "network" | "selection"),
        "triage.mode" => matches!(value, "unreachable" | "stale" | "untested" | "attention"),
        "sessions.retentionDays" => matches!(value, "0" | "7" | "30" | "90"),
        "map.pingFilter" => matches!(
            value,
            "all"
                | "attention"
                | "unreachable"
                | "warning"
                | "untested"
                | "intermittent"
                | "no_ip"
        ),
        "ping.count" => matches!(value, "1" | "2" | "4" | "8"),
        _ => false,
    }
}

/// Get one preference value.
#[tauri::command]
pub fn atlas_pref_get(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let key = json_str(payload.get("key")).ok_or_else(|| "key is required".to_string())?;
        if !is_allowed_pref_key(&key) {
            return Err(format!("Unsupported preference key: {key}"));
        }
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM atlas_pref WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(json!({ "key": key, "value": value }))
    })
}

/// Get all known preferences (missing keys omitted).
#[tauri::command]
pub fn atlas_pref_get_all(
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<Value, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT key, value FROM atlas_pref")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut prefs = serde_json::Map::new();
        for row in rows {
            let (key, value) = row.map_err(|e| e.to_string())?;
            if is_allowed_pref_key(&key) {
                prefs.insert(key, json!(value));
            }
        }
        Ok(json!({ "prefs": prefs }))
    })
}

/// Upsert one preference.
#[tauri::command]
pub fn atlas_pref_set(
    payload: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let key = json_str(payload.get("key")).ok_or_else(|| "key is required".to_string())?;
        if !is_allowed_pref_key(&key) {
            return Err(format!("Unsupported preference key: {key}"));
        }
        let value = match payload.get("value") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.to_string()),
            Some(Value::Bool(b)) => Some(b.to_string()),
            Some(_) => return Err("Preference value must be a string or number".into()),
        };
        if let Some(v) = value {
            if v.len() > 200 {
                return Err("Preference value too long".into());
            }
            if !is_allowed_pref_value(&key, &v) {
                return Err(format!("Unsupported preference value for {key}"));
            }
            conn.execute(
                "INSERT INTO atlas_pref (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, v],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute("DELETE FROM atlas_pref WHERE key = ?1", params![key])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
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

#[tauri::command]
pub fn atlas_entity_update(
    entity_kind: String,
    entity_id: String,
    patch: Value,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        match entity_kind.as_str() {
            "hub" => {
                conn.execute(
                    "UPDATE hub SET name = COALESCE(?3, name), aka = COALESCE(?4, aka), hub_ip = COALESCE(?5, hub_ip), lat = COALESCE(?6, lat), lon = COALESCE(?7, lon) WHERE id = ?1 OR hub_code = ?2",
                    params![
                        entity_id,
                        entity_id,
                        json_str(patch.get("name")),
                        json_str(patch.get("aka")),
                        json_str(patch.get("hubIp")),
                        json_f64(patch.get("lat")),
                        json_f64(patch.get("lon")),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            "connected_building" => {
                conn.execute(
                    "UPDATE connected_building SET building_name = COALESCE(?2, building_name), building_type = COALESCE(?3, building_type), from_hub = COALESCE(?4, from_hub), to_hub = COALESCE(?5, to_hub), switch_1_ip = COALESCE(?6, switch_1_ip), lat = COALESCE(?7, lat), lon = COALESCE(?8, lon) WHERE id = ?1",
                    params![
                        entity_id,
                        json_str(patch.get("buildingName")),
                        json_str(patch.get("buildingType")),
                        json_str(patch.get("fromHub")),
                        json_str(patch.get("toHub")),
                        json_str(patch.get("switch1Ip")),
                        json_f64(patch.get("lat")),
                        json_f64(patch.get("lon")),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            "drop" => {
                conn.execute(
                    "UPDATE drop_node SET inventory_name = COALESCE(?2, inventory_name), ip = COALESCE(?3, ip), lat = COALESCE(?4, lat), lon = COALESCE(?5, lon), parent_drop_id = COALESCE(?6, parent_drop_id) WHERE id = ?1",
                    params![
                        entity_id,
                        json_str(patch.get("inventoryName")),
                        json_str(patch.get("ip")),
                        json_f64(patch.get("lat")),
                        json_f64(patch.get("lon")),
                        json_str(patch.get("parentDropId")),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            _ => return Err(format!("Unsupported entity kind: {entity_kind}")),
        }
        Ok(())
    })
}

#[tauri::command]
pub fn atlas_entity_move(
    entity_kind: String,
    entity_id: String,
    lat: f64,
    lon: f64,
    state: tauri::State<'_, Arc<AtlasDbState>>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        match entity_kind.as_str() {
            "hub" => {
                conn.execute(
                    "UPDATE hub SET lat = ?2, lon = ?3 WHERE id = ?1 OR hub_code = ?1",
                    params![entity_id, lat, lon],
                )
                .map_err(|e| e.to_string())?;
            }
            "connected_building" | "drop" => {
                let table = if entity_kind == "connected_building" {
                    "connected_building"
                } else {
                    "drop_node"
                };
                let sql = format!("UPDATE {table} SET lat = ?2, lon = ?3 WHERE id = ?1");
                conn.execute(&sql, params![entity_id, lat, lon])
                    .map_err(|e| e.to_string())?;
            }
            _ => return Err(format!("Unsupported entity kind: {entity_kind}")),
        }
        Ok(())
    })
}
