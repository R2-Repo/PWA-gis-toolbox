Add or change a feature for **both** the public PWA and the Windows desktop app.

Follow `.cursor/skills/feature-both/SKILL.md` and read `docs/PWA_DESKTOP_COMPAT.md` first.

Process (do not skip):
1. Split into shared vs `js/platform/web/` vs `js/platform/windows/` (and shell/sidecar only if needed)
2. Plan web behavior + desktop behavior + degradation before coding
3. Implement shared first, then both providers — no Tauri in shared modules
4. Definition of done — all required:
   - `npm test`
   - `npm run build` (or `build:web`)
   - `npm run build:desktop`
   - Smoke the **same feature** on PWA and desktop (or list exact desktop steps if this environment cannot run Tauri)
5. Do not claim done until both runtimes are covered
6. Do not ask me to re-explain PWA vs desktop rules

My feature request:
