Run the cheap **dual-runtime QA** pass (tests, builds, boundary audit, minimal docs).

Delegate to the project subagent `.cursor/agents/dual-runtime-qa.md` (Composer fast — do not do this work on an expensive parent model).

Parent agent must:
1. Pass the list of changed files / feature summary into the subagent prompt
2. Wait for the QA report
3. Fix any blockers the QA report marks as required
4. Do not spend the parent model rewriting docs or re-running long test logs if the subagent can do it

Focus / recent work:
