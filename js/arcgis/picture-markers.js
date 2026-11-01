/**
 * ArcGIS picture-marker symbols (esriPMS) → MapLibre images.
 * Uses `symbol.imageData` from layer drawingInfo (same PNGs ArcGIS Online draws).
 */
import { collectUniqueInfos } from './drawing-info.js';

/**
 * @param {string} [styleName]
 * @returns {number[]|null}
 */
export function esriLineStyleToDash(styleName) {
    switch (String(styleName || '')) {
        case 'esriSLSDash':
            return [3, 2];
        case 'esriSLSDot':
            return [1, 2];
        case 'esriSLSDashDot':
            return [3, 2, 1, 2];
        case 'esriSLSDashDotDot':
            return [3, 2, 1, 2, 1, 2];
        default:
            return null;
    }
}

/**
 * MapLibre 4 cannot paint data-driven `line-dasharray` (match/literal arrays
 * fail silently — labels still draw). Use one constant pattern when every
 * class is dashed the same way.
 * @param {Array<{ style?: string }>} classes
 * @returns {number[]|null}
 */
export function resolveEsriLineDasharray(classes) {
    if (!classes?.length) return null;
    const dashes = classes.map((c) => esriLineStyleToDash(c.style));
    if (!dashes.some(Boolean)) return null;
    return dashes.find(Boolean);
}

/**
 * @param {object} symbol
 * @param {string} key
 * @param {Set<string>} seenImage
 * @param {object[]} markers
 * @param {{ value?: string, classMin?: number, classMax?: number }} [opts]
 */
function pushEsriPmsMarker(symbol, key, seenImage, markers, opts = {}) {
    if (!symbol || symbol.type !== 'esriPMS' || !symbol.imageData) return;
    const imageId = `arcgis-pms-${String(symbol.url || key).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
    const value = opts.value != null ? String(opts.value) : String(key);
    if (seenImage.has(imageId) && markers.some((m) => m.value === value && m.imageId === imageId)) return;
    seenImage.add(imageId);
    const entry = {
        value,
        imageId,
        imageData: String(symbol.imageData),
        contentType: symbol.contentType || 'image/png',
        esriWidth: Number(symbol.width) || Number(symbol.height) || 24
    };
    if (opts.classMin != null || opts.classMax != null) {
        entry.classMin = Number(opts.classMin);
        entry.classMax = Number(opts.classMax);
    }
    markers.push(entry);
}

/**
 * @param {object|null|undefined} drawingInfo
 * @returns {{
 *   field: string|null,
 *   matchMode: 'unique'|'classBreaks'|'all',
 *   markers: Array<{ value: string, imageId: string, imageData: string, contentType: string, esriWidth?: number, classMin?: number, classMax?: number }>
 * }}
 */
export function pictureMarkersFromDrawingInfo(drawingInfo) {
    const renderer = drawingInfo?.renderer;
    if (!renderer) return { field: null, matchMode: 'unique', markers: [] };

    const markers = [];
    const seenImage = new Set();
    const rendererType = String(renderer.type || '');

    if (rendererType === 'classBreaks' && renderer.field) {
        const field = String(renderer.field);
        for (const info of renderer.classBreakInfos || []) {
            pushEsriPmsMarker(
                info.symbol,
                `${info.classMinValue}-${info.classMaxValue}`,
                seenImage,
                markers,
                {
                    value: `${info.classMinValue ?? ''}-${info.classMaxValue ?? ''}`,
                    classMin: info.classMinValue ?? renderer.minValue,
                    classMax: info.classMaxValue ?? renderer.maxValue
                }
            );
        }
        return { field, matchMode: 'classBreaks', markers };
    }

    let field = renderer.field1 && renderer.field1 !== '*' ? String(renderer.field1) : null;
    let matchMode = 'unique';

    for (const info of collectUniqueInfos(renderer)) {
        pushEsriPmsMarker(info.symbol, info.value, seenImage, markers, { value: info.value });
    }

    if (!markers.length && renderer.symbol?.type === 'esriPMS') {
        matchMode = 'all';
        field = null;
        pushEsriPmsMarker(renderer.symbol, 'all', seenImage, markers, { value: '__all__' });
    }

    return { field, matchMode, markers };
}

/**
 * Stamp picture-marker props on an imported dataset and retain the marker pack for map registration.
 * @param {object} dataset
 * @param {object|null|undefined} drawingInfo
 */
export function attachPictureMarkersToDataset(dataset, drawingInfo) {
    if (!dataset) return dataset;
    const pack = pictureMarkersFromDrawingInfo(drawingInfo);
    if (!pack.markers.length) return dataset;
    dataset._arcgisPictureMarkers = pack;
    if (dataset.geojson?.features?.length) {
        dataset.geojson = {
            ...dataset.geojson,
            features: decorateFeaturesWithPictureMarkers(dataset.geojson.features, pack)
        };
    }
    return dataset;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ markers?: Array<{ imageId: string, imageData: string, contentType: string }> }} pack
 */
export async function registerPictureMarkers(map, pack) {
    const markers = pack?.markers || [];
    if (!map || !markers.length) return;
    await Promise.all(markers.map((marker) => loadPictureMarker(map, marker)));
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ imageId: string, imageData: string, contentType: string }} marker
 * @returns {Promise<string>}
 */
export function loadPictureMarker(map, marker) {
    return new Promise((resolve) => {
        if (!map || !marker?.imageId || !marker.imageData) {
            resolve('');
            return;
        }
        if (map.hasImage?.(marker.imageId)) {
            resolve(marker.imageId);
            return;
        }
        if (typeof Image === 'undefined') {
            resolve(marker.imageId);
            return;
        }
        const img = new Image();
        img.onload = () => {
            try {
                if (map && !map.hasImage(marker.imageId)) map.addImage(marker.imageId, img);
            } finally {
                resolve(marker.imageId);
            }
        };
        img.onerror = () => resolve('');
        img.src = `data:${marker.contentType || 'image/png'};base64,${marker.imageData}`;
    });
}

function stampFeatureGlyph(feature, marker) {
    if (!marker?.imageId) return feature;
    return {
        ...feature,
        properties: {
            ...(feature.properties || {}),
            _udotGlyph: marker.imageId,
            _udotEsriWidth: marker.esriWidth || 24
        }
    };
}

/**
 * Stamp `_udotGlyph` with the published PMS image id for the class field.
 * @param {object[]} features
 * @param {{ field: string|null, matchMode?: string, markers: Array<{ value: string, imageId: string, esriWidth?: number, classMin?: number, classMax?: number }> }} pack
 * @returns {object[]}
 */
export function decorateFeaturesWithPictureMarkers(features, pack) {
    if (!pack?.markers?.length || !features?.length) return features;

    if (pack.matchMode === 'all' || (!pack.field && pack.markers.length === 1)) {
        const marker = pack.markers[0];
        return features.map((feature) => stampFeatureGlyph(feature, marker));
    }

    if (pack.matchMode === 'classBreaks' && pack.field) {
        return features.map((feature) => {
            const num = Number(feature?.properties?.[pack.field]);
            if (!Number.isFinite(num)) return feature;
            const marker = pack.markers.find((m) => {
                const lo = Number(m.classMin);
                const hi = Number(m.classMax);
                if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
                return num >= lo && num <= hi;
            });
            return marker ? stampFeatureGlyph(feature, marker) : feature;
        });
    }

    if (!pack.field) return features;

    const byValue = new Map(pack.markers.map((m) => [m.value, m]));
    return features.map((feature) => {
        const raw = feature?.properties?.[pack.field];
        if (raw == null || raw === '') return feature;
        const marker = byValue.get(String(raw));
        return marker ? stampFeatureGlyph(feature, marker) : feature;
    });
}

export default {
    esriLineStyleToDash,
    resolveEsriLineDasharray,
    pictureMarkersFromDrawingInfo,
    attachPictureMarkersToDataset,
    registerPictureMarkers,
    loadPictureMarker,
    decorateFeaturesWithPictureMarkers
};
