/**
 * Thin wrapper around Tauri frontend APIs.
 * This is the ONLY module that may import @tauri-apps/*.
 */

/**
 * @returns {boolean}
 */
export function isTauriAvailable() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * @template T
 * @param {string} command
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<T>}
 */
export async function invokeCommand(command, args = {}) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
}

/**
 * @param {string} event
 * @param {(event: { payload: any }) => void} handler
 * @returns {Promise<() => void>}
 */
export async function listenEvent(event, handler) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen(event, handler);
}

/**
 * @param {object} [options]
 * @returns {Promise<string | string[] | null>}
 */
export async function openNativeDialog(options = {}) {
    const dialog = await import('@tauri-apps/plugin-dialog');
    return dialog.open(options);
}

/**
 * @param {object} [options]
 * @returns {Promise<string | null>}
 */
export async function saveNativeDialog(options = {}) {
    const dialog = await import('@tauri-apps/plugin-dialog');
    return dialog.save(options);
}

/**
 * Lock or set the WebView page zoom factor (desktop shell only).
 * @param {number} scaleFactor
 * @returns {Promise<void>}
 */
export async function setWebviewZoom(scaleFactor = 1) {
    if (!isTauriAvailable()) return;
    try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        await getCurrentWebview().setZoom(scaleFactor);
    } catch {
        /* zoom API unavailable — ignore */
    }
}

/**
 * Close the current webview window (used by Dual Screen map window exit).
 * @returns {Promise<void>}
 */
export async function closeCurrentWebviewWindow() {
    if (!isTauriAvailable()) return;
    try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        await getCurrentWebviewWindow().close();
    } catch {
        try {
            window.close();
        } catch {
            /* ignore */
        }
    }
}

/**
 * @param {string} label
 * @returns {Promise<boolean>}
 */
export async function isWebviewWindowOpen(label) {
    if (!isTauriAvailable() || !label) return false;
    try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const existing = await WebviewWindow.getByLabel(label);
        return Boolean(existing);
    } catch {
        return false;
    }
}

/**
 * @param {string} label
 * @returns {Promise<void>}
 */
export async function focusWebviewWindowByLabel(label) {
    if (!isTauriAvailable() || !label) return;
    try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const existing = await WebviewWindow.getByLabel(label);
        if (existing) await existing.setFocus();
    } catch {
        /* ignore */
    }
}

/**
 * @param {string} label
 * @returns {Promise<void>}
 */
export async function closeWebviewWindowByLabel(label) {
    if (!isTauriAvailable() || !label) return;
    try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const existing = await WebviewWindow.getByLabel(label);
        if (existing) await existing.close();
    } catch {
        /* ignore */
    }
}

/**
 * Create or focus the Dual Screen map WebviewWindow.
 * @param {{
 *   label: string,
 *   url: string,
 *   title?: string,
 *   bounds?: { width: number, height: number, x?: number, y?: number }
 * }} opts
 * @returns {Promise<boolean>} true if the window exists / was created
 */
export async function createOrFocusMapWebviewWindow(opts) {
    if (!isTauriAvailable()) return false;
    const label = opts?.label || 'map';
    const url = opts?.url || 'map-window.html';
    const title = opts?.title || 'GIS Toolbox — Map';
    const bounds = opts?.bounds || {};

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const existing = await WebviewWindow.getByLabel(label);
        if (existing) {
            try {
                await existing.show();
            } catch {
                /* ignore */
            }
            try {
                await existing.setFocus();
            } catch {
                /* ignore */
            }
            try {
                await existing.setZoom(1);
            } catch {
                /* ignore */
            }
            return true;
        }

        const width = Math.round(bounds.width || 1200);
        const height = Math.round(bounds.height || 800);
        const x = Number.isFinite(bounds.x) ? Math.round(bounds.x) : undefined;
        const y = Number.isFinite(bounds.y) ? Math.round(bounds.y) : undefined;

        /** @type {Record<string, unknown>} */
        const config = {
            url,
            title,
            width,
            height,
            focus: true,
            resizable: true,
            visible: true,
            zoomHotkeysEnabled: true
        };
        if (x != null && y != null) {
            config.x = x;
            config.y = y;
        } else {
            config.center = true;
        }

        const webview = new WebviewWindow(label, config);

        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn(value);
            };
            const timer = setTimeout(() => {
                finish(reject, new Error('Timed out creating map webview'));
            }, 8000);
            webview.once('tauri://created', () => finish(resolve));
            webview.once('tauri://error', (event) => {
                finish(reject, new Error(event?.payload || 'Failed to create map webview'));
            });
        });

        try {
            await webview.setZoom(1);
        } catch {
            /* ignore */
        }
        return true;
    } catch (err) {
        console.warn('[Desktop] Failed to open Dual Screen map window', err);
        return false;
    }
}
