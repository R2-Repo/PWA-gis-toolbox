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

## Non-goals (v1)

SNMP/SSH/CDP, 24/7 monitoring, email alerts, full API, fiber panel tracing, DuckDB, PWA full parity.

## Agents

Read this doc before Atlas work. Follow `docs/PWA_DESKTOP_COMPAT.md` and `.cursor/skills/fix-desktop/SKILL.md` for desktop changes.
