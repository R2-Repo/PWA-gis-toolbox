# Windows platform provider

**Only this folder may import `@tauri-apps/*`.**

| File | Role |
|------|------|
| `tauri-bridge.js` | `invoke`, native dialog wrappers |
| `windows-file-service.js` | Open / save / folder / reveal in Explorer |
| `windows-compute-service.js` | Placeholder for Python/GPU ops |
| `windows-job-service.js` | Placeholder for long-running jobs |
| `windows-platform.js` | Assembles `platform` + `services` for WidgetContext |

Shell IPC lives in `src-tauri/`. See `docs/PWA_DESKTOP_WORKFLOW_PLAN.md`.
