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
