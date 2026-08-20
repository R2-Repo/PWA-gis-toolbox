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
 * @param {object|null|undefined} drawingInfo
 * @returns {{ field: string|null, markers: Array<{ value: string, imageId: string, imageData: string, contentType: string }> }}
 */
export function pictureMarkersFromDrawingInfo(drawingInfo) {
    const renderer = drawingInfo?.renderer;
    const field = renderer?.field1 && renderer.field1 !== '*' ? String(renderer.field1) : null;
    const markers = [];
    const seenImage = new Set();
    for (const info of collectUniqueInfos(renderer || {})) {
        const symbol = info.symbol;
        if (!symbol || symbol.type !== 'esriPMS' || !symbol.imageData) continue;
        const imageId = `arcgis-pms-${String(symbol.url || info.value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
        if (seenImage.has(imageId) && markers.some((m) => m.value === String(info.value))) continue;
        seenImage.add(imageId);
        markers.push({
            value: String(info.value),
            imageId,
            imageData: String(symbol.imageData),
            contentType: symbol.contentType || 'image/png',
            esriWidth: Number(symbol.width) || Number(symbol.height) || 24
        });
    }
    return { field, markers };
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

/**
 * Stamp `_udotGlyph` with the published PMS image id for the class field.
 * @param {object[]} features
 * @param {{ field: string|null, markers: Array<{ value: string, imageId: string }> }} pack
 * @returns {object[]}
 */
export function decorateFeaturesWithPictureMarkers(features, pack) {
    if (!pack?.field || !pack.markers?.length || !features?.length) return features;
    const byValue = new Map(pack.markers.map((m) => [m.value, m]));
    return features.map((feature) => {
        const raw = feature?.properties?.[pack.field];
        if (raw == null || raw === '') return feature;
        const marker = byValue.get(String(raw));
        if (!marker?.imageId) return feature;
        return {
            ...feature,
            properties: {
                ...feature.properties,
                _udotGlyph: marker.imageId,
                _udotEsriWidth: marker.esriWidth || 24
            }
        };
    });
}

export default {
    esriLineStyleToDash,
    resolveEsriLineDasharray,
    pictureMarkersFromDrawingInfo,
    registerPictureMarkers,
    loadPictureMarker,
    decorateFeaturesWithPictureMarkers
};
