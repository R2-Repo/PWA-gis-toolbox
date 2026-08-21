/**
 * Identify helpers for stacked live-layer features (popup cycle).
 */

export const LIVE_LAYER_IDENTIFY_PX = 18;

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 */
function hypot2(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @param {{ x: number, y: number }} px
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 */
export function pixelDistanceToSegment(px, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return hypot2(px, a);
    let t = ((px.x - a.x) * dx + (px.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return hypot2(px, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * @param {(lngLat: number[]) => { x: number, y: number }} project
 * @param {number[][]} coords
 * @param {{ x: number, y: number }} pixel
 */
function linePixelDistance(project, coords, pixel) {
    if (!coords?.length) return Infinity;
    if (coords.length === 1) return hypot2(pixel, project(coords[0]));
    let min = Infinity;
    for (let i = 1; i < coords.length; i++) {
        min = Math.min(min, pixelDistanceToSegment(pixel, project(coords[i - 1]), project(coords[i])));
    }
    return min;
}

/**
 * Screen-pixel distance from a click to a GeoJSON feature.
 * @param {(lngLat: number[]) => { x: number, y: number }} project
 * @param {object} feature
 * @param {{ x: number, y: number }} pixel
 */
export function featurePixelDistance(project, feature, pixel) {
    const g = feature?.geometry;
    if (!g || typeof project !== 'function') return Infinity;
    if (g.type === 'Point') return hypot2(pixel, project(g.coordinates));
    if (g.type === 'MultiPoint') {
        let min = Infinity;
        for (const c of g.coordinates || []) min = Math.min(min, hypot2(pixel, project(c)));
        return min;
    }
    if (g.type === 'LineString') return linePixelDistance(project, g.coordinates, pixel);
    if (g.type === 'MultiLineString') {
        let min = Infinity;
        for (const line of g.coordinates || []) min = Math.min(min, linePixelDistance(project, line, pixel));
        return min;
    }
    if (g.type === 'Polygon') {
        const ring = g.coordinates?.[0];
        return linePixelDistance(project, ring, pixel);
    }
    if (g.type === 'MultiPolygon') {
        let min = Infinity;
        for (const poly of g.coordinates || []) {
            min = Math.min(min, linePixelDistance(project, poly?.[0], pixel));
        }
        return min;
    }
    return Infinity;
}

/**
 * @typedef {object} LiveHit
 * @property {object} feature
 * @property {number} featureIndex
 * @property {string} layerId
 * @property {string} [layerName]
 * @property {string} [layerColor]
 */

/**
 * Add in-memory live-layer features near a click that rendered-query missed.
 * @param {object} opts
 * @param {{ project: (lngLat: [number, number]) => { x: number, y: number } }} opts.map
 * @param {Iterable<[string, { liveService?: boolean, geojson?: { features?: object[] } }]>} opts.dataLayers
 * @param {(layerId: string) => boolean} [opts.isLocked]
 * @param {{ x: number, y: number }} opts.pixel
 * @param {LiveHit[]} opts.results
 * @param {Set<string>} opts.seen
 * @param {number} [opts.bufferPx]
 * @param {(feature: object) => object} [opts.stripInternal]
 * @param {(layerId: string) => string} [opts.layerName]
 * @param {(layerId: string) => string} [opts.layerColor]
 * @param {(layerId: string) => boolean} [opts.skipLayer]
 * @returns {LiveHit[]}
 */
export function mergeLiveLayerHitsNearClick({
    map,
    dataLayers,
    isLocked,
    pixel,
    results,
    seen,
    bufferPx = LIVE_LAYER_IDENTIFY_PX,
    stripInternal,
    layerName,
    layerColor,
    skipLayer
}) {
    if (!map?.project || !dataLayers || !pixel || !results || !seen) return results;

    const project = (lngLat) => map.project(lngLat);

    for (const [layerId, info] of dataLayers) {
        if (!info?.liveService) continue;
        if (isLocked?.(layerId)) continue;
        if (skipLayer?.(layerId)) continue;
        const features = info.geojson?.features || [];
        for (const feature of features) {
            const featureIndex = Number(feature?.properties?._featureIndex);
            if (!Number.isFinite(featureIndex)) continue;
            const key = `${layerId}-${featureIndex}`;
            if (seen.has(key)) continue;
            if (featurePixelDistance(project, feature, pixel) > bufferPx) continue;
            seen.add(key);
            const cleaned = stripInternal ? stripInternal(feature) : feature;
            results.push({
                feature: cleaned,
                featureIndex,
                layerId,
                layerName: layerName?.(layerId) || layerId,
                layerColor: layerColor?.(layerId) || '#2563eb'
            });
        }
    }

    return results;
}
