Run a **dual-runtime smoke** for the current change (or the feature I describe).

Follow `docs/PWA_DESKTOP_COMPAT.md` minimal smoke section and `.cursor/skills/feature-both/SKILL.md` done checks.

Do this:
1. List which files changed and classify: shared / PWA-only / desktop-only
2. Run `npm test`, `npm run build` (or `build:web`), and `npm run build:desktop` when builds are in scope
3. Give a short checklist for me to click through on PWA and on desktop (only the blast radius — not the whole app)
4. Call out anything that looks like it could break the other runtime

Focus:
