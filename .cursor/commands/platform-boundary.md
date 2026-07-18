Run the readonly **platform-boundary** subagent (Composer fast).

Use `.cursor/agents/platform-boundary.md`.

Parent must pass:
- changed file list (or “review current dual-runtime/platform paths”)
- brief intent

Check PWA↔desktop boundaries **and** obvious desktop security risks (arbitrary shell/Python, path escape, secrets, unallow-listed native ops). Return the subagent report; parent fixes failures.

Focus:
