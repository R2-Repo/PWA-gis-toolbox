---
name: pwa-desktop-compat
description: Classify whether a GIS Toolbox change is PWA-only, desktop-only, or shared, and what smoke checks apply. Use when the user reports a bug without naming a runtime, or when work might break the other target.
---

# PWA ↔ Desktop change classifier

## Read first

[`docs/PWA_DESKTOP_COMPAT.md`](../../../docs/PWA_DESKTOP_COMPAT.md)

## Quick classify

| Signal | Treat as | Next skill |
|--------|----------|------------|
| User says PWA / web / browser / staging preview | PWA | `fix-pwa` |
| User says desktop / Windows / Tauri / WebView2 | Desktop | `fix-desktop` |
| Works in browser, fails in Tauri | Desktop-first (shell/platform) | `fix-desktop` |
| Fails in both | Shared | Fix shared; dual smoke |
| Unclear | Ask one question: “Does this fail in the browser PWA too?” | then route |

## Non-negotiables

- One codebase; two builds; no widget forks
- `@tauri-apps/*` only under `js/platform/windows/`
- Adapter over rewrite when a feature needs OS windows/files/compute
