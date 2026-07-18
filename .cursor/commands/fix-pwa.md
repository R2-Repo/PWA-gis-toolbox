Fix / update the **public PWA** (web / browser runtime).

Follow `.cursor/skills/fix-pwa/SKILL.md` and read `docs/PWA_DESKTOP_COMPAT.md` first.

Hard constraints (do not ask me to repeat these):
- Prefer shared `js/` / `react/` and/or `js/platform/web/`
- Do not add Tauri, sidecar, or Windows-only APIs
- Keep `npm run build:desktop` green
- No `@tauri-apps/*` outside `js/platform/windows/`

Verify with `npm test` and `npm run build` (or `build:web`). Browser-smoke only the changed flow.

My request:
