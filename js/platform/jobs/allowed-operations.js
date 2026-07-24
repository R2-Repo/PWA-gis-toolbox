/**
 * Narrow allow-list of native compute / job operations.
 * Keep in sync with desktop/sidecar/python and src-tauri job handlers.
 */
export const NATIVE_OPERATIONS = Object.freeze({
    ECHO: 'echo',
    SUMMARIZE_GEOJSON: 'summarize_geojson',
    INSPECT_VECTOR: 'inspect_vector',
    SAMPLE_VECTOR: 'sample_vector',
    FILE_CHECKSUM: 'file_checksum',
    CONVERT_TO_GEOPARQUET: 'convert_to_geoparquet',
    SUMMARIZE_VECTOR: 'summarize_vector',
    GENERATE_PMTILES: 'generate_pmtiles',
    BUFFER_VECTOR: 'buffer_vector',
    CLIP_VECTOR: 'clip_vector',
    SPATIAL_JOIN: 'spatial_join',
    REPROJECT_VECTOR: 'reproject_vector',
    SPATIAL_FILTER: 'spatial_filter'
});

export const NATIVE_OPERATION_LIST = Object.freeze(Object.values(NATIVE_OPERATIONS));

/**
 * @param {string} operation
 * @returns {boolean}
 */
export function isKnownNativeOperation(operation) {
    return NATIVE_OPERATION_LIST.includes(operation);
}
