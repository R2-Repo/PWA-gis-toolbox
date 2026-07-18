/**
 * Desktop Dual Screen window opener — Tauri WebviewWindow.
 * BroadcastChannel sync stays shared; only lifecycle uses this service.
 */

import {
    closeWebviewWindowByLabel,
    createOrFocusMapWebviewWindow,
    focusWebviewWindowByLabel,
    isTauriAvailable,
    isWebviewWindowOpen
} from './tauri-bridge.js';

/**
 * @param {string} label
 * @returns {import('../contracts.js').MapWindowHandle}
 */
function wrapTauriWindow(label) {
    let closed = false;

    const markClosed = () => {
        closed = true;
    };

    // Best-effort: poll isOpen so coordinator's existing closed-check works.
    const poll = setInterval(async () => {
        if (closed) {
            clearInterval(poll);
            return;
        }
        const open = await isWebviewWindowOpen(label);
        if (!open) {
            markClosed();
            clearInterval(poll);
        }
    }, 500);

    return {
        get closed() {
            return closed;
        },
        async focus() {
            if (closed) return;
            await focusWebviewWindowByLabel(label);
        },
        async close() {
            if (closed) return;
            markClosed();
            clearInterval(poll);
            await closeWebviewWindowByLabel(label);
        }
    };
}

/**
 * @returns {import('../contracts.js').WindowService}
 */
export function createWindowsWindowService() {
    return {
        /**
         * @param {import('../contracts.js').OpenMapWindowOptions} opts
         * @returns {Promise<import('../contracts.js').MapWindowHandle | null>}
         */
        async openMapWindow(opts = {}) {
            if (!isTauriAvailable()) return null;
            const label = opts.label || 'map';
            const created = await createOrFocusMapWebviewWindow({
                label,
                url: opts.url || 'map-window.html',
                title: opts.title || 'GIS Toolbox — Map',
                bounds: opts.bounds
            });
            if (!created) return null;
            return wrapTauriWindow(label);
        }
    };
}
