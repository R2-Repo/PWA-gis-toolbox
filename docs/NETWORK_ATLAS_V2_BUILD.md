# Network Atlas V2 — Build Plan (committed)

Desktop-first implementation on `staging`. Idea details: [`docs/NETWORK_ATLAS_V2.md`](NETWORK_ATLAS_V2.md). V3 deferred: [`docs/NETWORK_ATLAS_V3.md`](NETWORK_ATLAS_V3.md).

## V2 scope (8 phases)

| Phase | Idea | Key paths |
|-------|------|-----------|
| 1 | Golden-record merge | `js/atlas/import/merge-proposals.js`, `AtlasImportDialog.jsx` |
| 2 | Wireless + parent fiber | `src-tauri/src/atlas/db.rs`, `pipeline.js`, `map-layers.js` |
| 3 | Unified buildings import | `js/atlas/import/unified-buildings.js`, hub detail UI |
| 4 | In-Atlas DB edit | Rust `atlas_entity_*` commands, edit mode UI |
| 5 | Referral layers + reorder | `AtlasMapLayersPanel.jsx`, `map-layers.js` |
| 6 | Subnet / rogue scan | `js/atlas/ip-allocation.js`, `ip-scan.js` |
| 7 | Pop-out channel workers | `ChannelMonitorWorker.jsx`, `worker-manager.js` |
| 8 | Cut extent assistant | `js/atlas/cut-extent.js` |

## Milestones

- **M1:** Phases 1–2 — cleaner inventory, wireless on map
- **M2:** Phases 3–4 — buildings file, map edits
- **M3:** Phases 5–6 — referrals, rogue scan
- **M4:** Phases 7–8 — workers, cut extent

## Gates

- Phase 3: unified buildings column contract with data owners
- Phase 6: IP chunk rules documented with real channels

## Verify each phase

`npm test`, `npm run build`, `npm run build:desktop`; desktop Atlas smoke.
