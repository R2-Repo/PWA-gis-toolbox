/**
 * KML/KMZ GIS strip — remove known presentation properties only.
 * Does not strip user attributes that merely start with fill_/stroke_/marker-.
 */

/** Exact SimpleStyle / KML presentation keys removed in GIS mode. */
export const KML_PRESENTATION_KEYS = new Set([
    'description',
    'Description',
    'styleUrl',
    'styleHash',
    'styleMapHash',
    'icon',
    'Icon',
    'balloonStyle',
    'BalloonStyle',
    'visibility',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-color',
    'fill',
    'fill-opacity',
    'fill-color',
    'marker-color',
    'marker-size',
    'marker-symbol'
]);

/** Long HTML/text kept active but flagged for cold-detach preference downstream. */
export const KML_LONG_STRING_THRESHOLD = 2000;

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isKmlPresentationKey(key) {
    return KML_PRESENTATION_KEYS.has(key);
}

/**
 * @param {import('geojson').FeatureCollection} geojson
 * @returns {{
 *   geojson: import('geojson').FeatureCollection,
 *   removedKeys: string[],
 *   longStringFields: string[]
 * }}
 */
export function stripKmlPresentationFromGeoJSONWithReport(geojson) {
    const removed = new Set();
    const longFields = new Set();
    if (!geojson?.features) {
        return { geojson, removedKeys: [], longStringFields: [] };
    }

    const features = geojson.features.map((f) => {
        const props = f.properties || {};
        const slim = {};
        for (const [k, v] of Object.entries(props)) {
            if (isKmlPresentationKey(k)) {
                removed.add(k);
                continue;
            }
            if (typeof v === 'string' && v.length > KML_LONG_STRING_THRESHOLD) {
                longFields.add(k);
                // Keep active — callers may cold-detach later. Do not silently drop.
            }
            slim[k] = v;
        }
        if (slim.name == null && props.name != null) slim.name = props.name;
        return { ...f, properties: slim };
    });

    return {
        geojson: { ...geojson, features },
        removedKeys: [...removed].sort(),
        longStringFields: [...longFields].sort()
    };
}

/**
 * @param {import('geojson').FeatureCollection} geojson
 * @returns {import('geojson').FeatureCollection}
 */
export function stripKmlPresentationFromGeoJSON(geojson) {
    return stripKmlPresentationFromGeoJSONWithReport(geojson).geojson;
}

export default {
    KML_PRESENTATION_KEYS,
    KML_LONG_STRING_THRESHOLD,
    isKmlPresentationKey,
    stripKmlPresentationFromGeoJSON,
    stripKmlPresentationFromGeoJSONWithReport
};
