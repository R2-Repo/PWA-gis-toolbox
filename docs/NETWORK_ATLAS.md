# ITS Network Atlas

Desktop-first operational workspace for ITS network lookup, troubleshooting, import/reconciliation, and ping — **not** a GIS widget.

## Locked decisions

| Topic | Choice |
|-------|--------|
| Shape | Workspace / subsystem (`js/atlas/`, `react/atlas/`) |
| Runtime v1 | Desktop-first; gated by `localSqlite` + `icmpPing` |
| Shell | Existing Tauri 2 + shared React/Vite — no monorepo split |
| Database | SQLite via Rust (`rusqlite`) — `network-atlas.sqlite` in app data |
| Ping | Rust ICMP (Windows `ping` CLI) — not Python sidecar |
| Analytics | No DuckDB in v1 |
| GIS panels | Unchanged; switch via Atlas \| GIS Toolbox tabs |

## Platform

- Shared Atlas code never imports `@tauri-apps/*`.
- Desktop providers: `js/platform/windows/` (`windows-atlas-db-service.js`, `windows-ping-service.js`).
- Web: capabilities unavailable; stub services throw/disable UI.
- Contracts: `DatabaseService`, `PingService` in `js/platform/contracts.js`.

## Hierarchy

```text
Region → Hub → Channel → Drop → Device
```

## Phase checklist

- [x] Phase 0 — This decision record
- [x] Phase 1 — Workspace shell (tabs, header, placeholders)
- [x] Phase 2 — SQLite + FiberSwitchLocation / ATMS import + findings
- [x] Phase 3 — Map layers, search, hierarchy, schematic, details
- [x] Phase 4 — One-shot / channel ping + status colors
- [x] Phase 5 — Area + hub workflows
- [x] Phase 6 — Temporary monitoring sessions + CSV export
- [x] Phase 7 — Reconciliation center + dashboard + exports

## Import workflow (not GIS map import)

Atlas source files use a **dedicated path**:

1. **Network Atlas → Import data → Open folder** opens `%AppData%\...\atlas-import\` (created automatically; includes `README.txt`).
2. Copy into that folder:
   - `FiberSwitchLocation YYYY-MM-DD.xlsx`
   - ATMS Master Device List `.csv`
3. **Scan folder** detects the newest matching pair.
4. **Review** shows counts (sites, switches, findings) without writing.
5. **Apply (replace DB)** rebuilds Atlas network tables (hubs/channels/drops/devices/findings). **Ping history is kept** (matched by IP). Each apply appends an `import_batch` row (kept to the newest 50) with a compact `summary_json` (entity counts + diff counts).
6. Review shows a **diff** vs the current DB (new / missing / changed IPs and channels).
7. Left panel **Import history** lists past batches (files, counts, diff). Batches are **not restorable** — only the latest apply’s network tables remain.

Opening Atlas later loads SQLite only — spreadsheets are not re-read until the next Apply.

Map: click hubs/drops to select; channel selection draws a path and fits bounds. Dashboard can scope to Network or Selection.

Operator UX:
- Last-import freshness banner (warns after 7 days)
- Hierarchy / search / map: ping dots; reachable+stale shows as warning (orange)
- Map hover tooltips (hub/drop label, IP, ping); `/` focuses search, `Esc` clears area then selection
- Map focus bar (current selection/area + Clear) and collapsible ping legend
- Map ping filter (all / needs attention / unreachable / warning / untested); pref `map.pingFilter`
- Monitor history Load more (screen + DB); search Show more when truncated; empty-DB import CTA
- Operator finish: `?` shortcuts help; left selection Clear chip; select all filtered findings
- Monitor history: Export full CSV from SQLite (all samples); Export loaded for preview only
- Copy IP: click any IP; Copy IPs on triage / hub / channel / site / area / findings / schematic
- Import history: past `import_batch` rows with counts + diff summary (keep last 50 on apply)
- Dashboard: inventory counts, wireless/provisional, finding-type cards, ping triage
- Findings focus: click finding → filter + scroll + highlight row
- Findings: entityKind chip + Open on map; status/type filters; Show all / CSV; bulk select → status / Copy IPs / Ping / Start monitor
- Reload DB button (left panel) rehydrates from SQLite; stops active monitor after confirm
- Ping triage: unreachable / stale / untested / needs attention + per-row Ping
- Hub map + schematic hubs colored by worst-of switch ping rollup
- Hub detail: ping all / primary / secondary + start monitor
- Area query + View area findings → Reconciliation
- Area clear + entity selection overrides stale area scope
- Scoped drops CSV / printable report (triage stats + finding-type breakdown)
- Channel schematic: drop + hub/channel finding badges, wireless tag, clickable hubs
- Wireless inferred on import from ATMS device type / model
- Channel/site/device detail with ping + monitor
- Device detail: gateway/subnet/provisional
- Monitor from drop/hub/channel/site/device/triage/area/selected findings; section auto-opens when active
- Past monitor sessions: list / view / re-export CSV / delete; prune by retention (default 30d on open)
- Operator prefs (SQLite `atlas_pref`): monitor interval, dashboard scope, triage mode, session retention, map ping filter
- Ping toasts (start + up/down summary)
- Reconciliation findings follow Network / Selection scope
- Ping age on drop details / schematic (stale after 24h)
- Findings: suggested action, editable notes, link to hub/channel/drop/device/site
- Monitor samples persisted; stop on leave Atlas (CSV only when Stop clicked)
- Import Review: findings-by-type summary + full diff lists + changed-IP details + CSV

Manual file pickers remain as a fallback. Do **not** use the header Import / map drop for these sources.

## Non-goals (v1)

SNMP/SSH/CDP, 24/7 monitoring, email alerts, full API, fiber panel tracing, DuckDB, PWA full parity.

## Agents

Read this doc before Atlas work. Follow `docs/PWA_DESKTOP_COMPAT.md` and `.cursor/skills/fix-desktop/SKILL.md` for desktop changes.
