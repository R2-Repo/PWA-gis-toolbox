/**
 * Build viewport GeoJSON packet from workspace chunks.
 *
 * Chunk spatial queries can return oversized chunks (common for long line
 * layers whose chunk bbox spans a large area). Features must be filtered by
 * per-feature bbox intersection with the current view — otherwise the render
 * cap fills with out-of-view geometry and the zoomed view looks empty.
 */
import { queryWorkspaceChunks, loadWorkspaceChunks } from './workspace-store.js';
import { RENDER_LIMITS } from '../map/render-limits.js';
import { bboxIntersects, featureBBox, geometryIntersectsBBox } from '../map/tiles/tile-math.js';
import { TILE_BUFFER, TILE_EXTENT } from '../map/tiles/tile-constants.js';

/** Default view edge pad so lines that only clip the viewport still draw. */
export const VIEWPORT_PAD_FRACTION = TILE_BUFFER / TILE_EXTENT;

/**
 * @param {string} layerId
 * @param {[number,number,number,number]} bounds [west,south,east,north]
 * @param {{
 *   maxFeatures?: number,
 *   maxVertices?: number,
 *   padFraction?: number
 * }} [options]
 * @returns {Promise<{ type: 'FeatureCollection', features: object[], truncated: boolean, candidateCount: number }>}
 */
export async function buildViewportGeoJSON(layerId, bounds, options = {}) {
    const maxFeatures = options.maxFeatures ?? RENDER_LIMITS.maxFeaturesPerSource;
    const maxVertices = options.maxVertices ?? RENDER_LIMITS.maxVerticesPerViewport;
    const padFraction = options.padFraction ?? VIEWPORT_PAD_FRACTION;
    const queryBounds = padFraction > 0
        ? _padBounds(bounds, padFraction)
        : bounds;

    const chunkIds = await queryWorkspaceChunks(queryBounds, layerId);
    const chunks = await loadWorkspaceChunks(chunkIds);

    const features = [];
    let vertices = 0;
    let candidateCount = 0;
    let truncated = false;

    for (const chunk of chunks) {
        let fc;
        try {
            fc = JSON.parse(chunk.geojson);
        } catch {
            continue;
        }
        for (const f of fc.features || []) {
            if (!featureIntersectsViewport(f, queryBounds)) continue;
            candidateCount++;

            if (features.length >= maxFeatures) {
                truncated = true;
                continue;
            }

            const v = countGeometryVertices(f.geometry);
            // Skip one oversized feature instead of aborting the whole viewport fill.
            if (vertices + v > maxVertices) {
                truncated = true;
                continue;
            }

            vertices += v;
            features.push(f);
        }
    }

    if (candidateCount > features.length) truncated = true;

    return {
        type: 'FeatureCollection',
        features,
        truncated,
        candidateCount
    };
}

/**
 * @param {object|null|undefined} feature
 * @param {[number,number,number,number]} bounds
 * @returns {boolean}
 */
export function featureIntersectsViewport(feature, bounds) {
    if (!feature?.geometry) return false;
    const bbox = featureBBox(feature);
    if (!bbox) return false;
    // Fast reject on envelope, then require real geometry∩view (parity with
    // tiled featureBelongsInTile) so long lines whose bbox covers the view
    // but miss it do not crowd the render cap.
    if (!bboxIntersects(bbox, bounds)) return false;
    return geometryIntersectsBBox(feature.geometry, bounds);
}

/**
 * @param {object|null|undefined} geom
 * @returns {number}
 */
export function countGeometryVertices(geom) {
    if (!geom?.coordinates) return 0;
    let n = 0;
    const visit = (coords) => {
        if (typeof coords[0] === 'number') {
            n++;
            return;
        }
        for (const c of coords) visit(c);
    };
    visit(geom.coordinates);
    return n;
}

function _padBounds(bounds, fraction) {
    const [w, s, e, n] = bounds;
    const dx = Math.max(0, (e - w) * fraction);
    const dy = Math.max(0, (n - s) * fraction);
    return [w - dx, s - dy, e + dx, n + dy];
}

export default {
    buildViewportGeoJSON,
    featureIntersectsViewport,
    countGeometryVertices,
    VIEWPORT_PAD_FRACTION
};
