Run the **widget-scaffold** subagent (Composer fast) to double-check a GIS Widget **Build Plan**.

Use `.cursor/agents/widget-scaffold.md`.

Parent (or I) must provide the Build Plan below. The subagent:

1. Checks playbook / authoring checklist (including **`restoreState`**, **`requiredCapabilities`**, hidden vs visible registry)
2. Confirms browser/PWA-safe work (**no live API** in tests; mocks/fixtures only)
3. Looks for registry/name/draw conflicts with other widgets; confirms **`RunPreviewFooter`** (not hand-rolled `modal-footer`) in the React plan
4. Reports Ready vs Needs fixes

Review-only unless I say **apply scaffold**.

Build Plan:
