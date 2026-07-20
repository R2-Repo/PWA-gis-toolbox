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
5. **Apply (replace DB)** rebuilds Atlas network tables (hubs/channels/drops/devices/findings). **Ping history is kept** (matched by IP).
6. Review shows a **diff** vs the current DB (new / missing / changed IPs and channels).

Opening Atlas later loads SQLite only — spreadsheets are not re-read until the next Apply.

Map: click hubs/drops to select; channel selection draws a path and fits bounds. Dashboard can scope to Network or Selection.

Operator UX:
- Last-import freshness banner on the left panel
- Ping triage: unreachable / stale / untested / needs attention + bulk re-ping
- Hub detail: ping all / primary / secondary switch sets
- Area query: rectangle or polygon, map overlay, fit bounds, Selection scope, open findings
- Area clear + entity selection overrides stale area scope
- Scoped drops CSV / printable report (Network vs Selection)
- Channel schematic shows open finding badges per drop
- Channel summary + site drops list with ping
- Monitor from drop, triage list, or area; live sample tail
- Ping toasts (start + up/down summary)
- Reconciliation findings follow Network / Selection scope
- Ping age on drop details / schematic (stale after 24h)
- Findings: suggested action, editable notes, link to hub/channel/drop/device/site
- Monitor samples persisted; stop on leave Atlas (CSV only when Stop clicked)
- Import Review: full diff lists (IPs/channels/drops) + CSV export

Manual file pickers remain as a fallback. Do **not** use the header Import / map drop for these sources.

## Non-goals (v1)

SNMP/SSH/CDP, 24/7 monitoring, email alerts, full API, fiber panel tracing, DuckDB, PWA full parity.

## Agents

Read this doc before Atlas work. Follow `docs/PWA_DESKTOP_COMPAT.md` and `.cursor/skills/fix-desktop/SKILL.md` for desktop changes.
