/**
 * Narrow allow-list of compute / job operation names.
 * Reserved for future browser workers (e.g. WASM); the web platform currently stubs these.
 */
export const NATIVE_OPERATIONS = Object.freeze({
    ECHO: 'echo',
    SUMMARIZE_GEOJSON: 'summarize_geojson',
    INSPECT_VECTOR: 'inspect_vector',
    SAMPLE_VECTOR: 'sample_vector',
    FILE_CHECKSUM: 'file_checksum',
    CONVERT_TO_GEOPARQUET: 'convert_to_geoparquet',
    CONVERT_TO_COG: 'convert_to_cog',
    SUMMARIZE_VECTOR: 'summarize_vector',
    GENERATE_PMTILES: 'generate_pmtiles',
    BUFFER_VECTOR: 'buffer_vector',
    CLIP_VECTOR: 'clip_vector',
    SPATIAL_JOIN: 'spatial_join',
    REPROJECT_VECTOR: 'reproject_vector',
    SPATIAL_FILTER: 'spatial_filter',
    NEAREST_JOIN: 'nearest_join',
    SIMPLIFY_VECTOR: 'simplify_vector',
    DISSOLVE_VECTOR: 'dissolve_vector',
    UNION_VECTOR: 'union_vector',
    EXPLODE_VECTOR: 'explode_vector',
    SAMPLE_FEATURES: 'sample_features',
    FILTER_ATTRIBUTES: 'filter_attributes',
    UPDATE_ATTRIBUTES: 'update_attributes',
    SAVE_VECTOR: 'save_vector'
});

export const NATIVE_OPERATION_LIST = Object.freeze(Object.values(NATIVE_OPERATIONS));

/**
 * @param {string} operation
 * @returns {boolean}
 */
export function isKnownNativeOperation(operation) {
    return NATIVE_OPERATION_LIST.includes(operation);
}
