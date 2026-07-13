/**
 * Map preview overlays for Sheet Cutter (shared by widget + PDF export).
 */

/** @type {object[]} */
let activePreviewEntries = [];

/**
 * @param {object} mapService
 */
export function clearSheetPreview(mapService) {
    for (const entry of activePreviewEntries) {
        mapService.removeTempFeature?.(entry);
    }
    activePreviewEntries = [];
}

/**
 * @param {object} mapService
 * @param {object} layers
 * @param {{ singleFrame?: object|null }} [options]
 */
export function showSheetPreview(mapService, layers = {}, options = {}) {
    clearSheetPreview(mapService);

    const push = (geojson, previewOptions = {}) => {
        if (!geojson?.features?.length && geojson?.type !== 'Feature') return;
        const entry = mapService.showTempFeature?.(geojson, 0, previewOptions);
        if (entry) activePreviewEntries.push(entry);
    };

    const sheetPreviewStyle = { fillOpacity: 0 };

    if (layers.route?.features?.length) {
        push(layers.route);
    }

    if (options.singleFrame) {
        push(options.singleFrame, sheetPreviewStyle);
        return;
    }

    if (layers.sheetFrames?.features?.length) {
        push(layers.sheetFrames, sheetPreviewStyle);
    }
}

/**
 * @param {import('geojson').FeatureCollection} sheetFrames
 * @param {string} sheetId
 * @returns {import('geojson').FeatureCollection|null}
 */
export function buildSingleSheetFrameCollection(sheetFrames, sheetId) {
    const feature = sheetFrames?.features?.find((entry) => entry.properties?.sheet_id === sheetId);
    if (!feature) return null;
    return { type: 'FeatureCollection', features: [feature] };
}

/**
 * @param {import('geojson').FeatureCollection|import('geojson').Feature} geojson
 * @returns {[[number, number], [number, number]]|null}
 */
export function boundsFromGeoJson(geojson) {
    if (typeof turf === 'undefined' || !geojson) return null;
    try {
        const bbox = turf.bbox(geojson);
        if (!bbox?.every((value) => Number.isFinite(value))) return null;
        return [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    } catch (_) {
        return null;
    }
}
