/**
 * Narrow allow-list of native compute / job operations.
 * Keep in sync with desktop/sidecar/python and src-tauri job handlers.
 */
export const NATIVE_OPERATIONS = Object.freeze({
    ECHO: 'echo',
    SUMMARIZE_GEOJSON: 'summarize_geojson'
});

export const NATIVE_OPERATION_LIST = Object.freeze(Object.values(NATIVE_OPERATIONS));

/**
 * @param {string} operation
 * @returns {boolean}
 */
export function isKnownNativeOperation(operation) {
    return NATIVE_OPERATION_LIST.includes(operation);
}
