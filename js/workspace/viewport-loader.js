/**
 * Build viewport GeoJSON packet from workspace chunks.
 *
 * Chunk spatial queries can return oversized chunks (common for long line
 * layers whose chunk bbox spans a large area). Features must be filtered by
 * per-feature bbox intersection with the current view — otherwise the render
 * cap fills with out-of-view geometry and the zoomed view looks empty.
 *
 * When the render cap is hit, features that intersect the **center focus**
 * (middle portion of the view) are kept before edge/border features so the
 * area the user is looking at fills first.
 */
import { queryWorkspaceChunks, loadWorkspaceChunks } from './workspace-store.js';
import { RENDER_LIMITS } from '../map/render-limits.js';
import { bboxIntersects, featureBBox, geometryIntersectsBBox } from '../map/tiles/tile-math.js';
import { TILE_BUFFER, TILE_EXTENT } from '../map/tiles/tile-constants.js';

/** Default view edge pad so lines that only clip the viewport still draw. */
export const VIEWPORT_PAD_FRACTION = TILE_BUFFER / TILE_EXTENT;

/**
 * Middle fraction of each axis used as the priority “focus” region.
 * 0.5 → center half of width and height (about 25% of view area).
 */
export const VIEWPORT_CENTER_FOCUS_FRACTION = 0.5;

/**
 * Shrink bounds toward their center.
 * @param {[number,number,number,number]} bounds [west,south,east,north]
 * @param {number} [fraction] kept middle fraction of each axis (0–1]
 * @returns {[number,number,number,number]}
 */
export function centerFocusBounds(bounds, fraction = VIEWPORT_CENTER_FOCUS_FRACTION) {
    const [w, s, e, n] = bounds;
    const f = Math.min(1, Math.max(0.05, Number(fraction) || VIEWPORT_CENTER_FOCUS_FRACTION));
    const insetX = ((1 - f) / 2) * (e - w);
    const insetY = ((1 - f) / 2) * (n - s);
    return [w + insetX, s + insetY, e - insetX, n - insetY];
}

/**
 * Fill a feature list up to feature/vertex budgets (center list first).
 * Pure helper for tests and {@link buildViewportGeoJSON}.
 *
 * @param {object[]} centerFeatures
 * @param {object[]} edgeFeatures
 * @param {{ maxFeatures?: number, maxVertices?: number }} [opts]
 * @returns {{ features: object[], truncated: boolean, vertices: number }}
 */
export function selectViewportFeaturesCenterFirst(centerFeatures, edgeFeatures, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? RENDER_LIMITS.maxFeaturesPerSource;
    const maxVertices = opts.maxVertices ?? RENDER_LIMITS.maxVerticesPerViewport;
    const features = [];
    let vertices = 0;
    let truncated = false;

    const take = (list) => {
        for (const f of list) {
            if (features.length >= maxFeatures) {
                truncated = true;
                return;
            }
            const v = countGeometryVertices(f.geometry);
            if (vertices + v > maxVertices) {
                truncated = true;
                continue;
            }
            vertices += v;
            features.push(f);
        }
    };

    take(centerFeatures || []);
    if (features.length < maxFeatures) take(edgeFeatures || []);
    else if ((edgeFeatures || []).length) truncated = true;

    return { features, truncated, vertices };
}

/**
 * @param {string} layerId
 * @param {[number,number,number,number]} bounds [west,south,east,north]
 * @param {{
 *   maxFeatures?: number,
 *   maxVertices?: number,
 *   padFraction?: number,
 *   centerFocusFraction?: number,
 *   prioritizeCenter?: boolean
 * }} [options]
 * @returns {Promise<{ type: 'FeatureCollection', features: object[], truncated: boolean, candidateCount: number }>}
 */
export async function buildViewportGeoJSON(layerId, bounds, options = {}) {
    const maxFeatures = options.maxFeatures ?? RENDER_LIMITS.maxFeaturesPerSource;
    const maxVertices = options.maxVertices ?? RENDER_LIMITS.maxVerticesPerViewport;
    const padFraction = options.padFraction ?? VIEWPORT_PAD_FRACTION;
    const prioritizeCenter = options.prioritizeCenter !== false;
    const centerFraction = options.centerFocusFraction ?? VIEWPORT_CENTER_FOCUS_FRACTION;
    const queryBounds = padFraction > 0
        ? _padBounds(bounds, padFraction)
        : bounds;
    const focusBounds = prioritizeCenter
        ? centerFocusBounds(bounds, centerFraction)
        : null;

    const chunkIds = await queryWorkspaceChunks(queryBounds, layerId);
    const chunks = await loadWorkspaceChunks(chunkIds);

    const centerFeatures = [];
    const edgeFeatures = [];
    const seen = new Set();
    let candidateCount = 0;

    for (const chunk of chunks) {
        let fc;
        try {
            fc = JSON.parse(chunk.geojson);
        } catch {
            continue;
        }
        for (const f of fc.features || []) {
            if (!featureIntersectsViewport(f, queryBounds)) continue;

            const key = f.properties?._featureIndex ?? f.id;
            if (key != null) {
                if (seen.has(key)) continue;
                seen.add(key);
            }

            candidateCount++;
            if (focusBounds && featureIntersectsViewport(f, focusBounds)) {
                centerFeatures.push(f);
            } else {
                edgeFeatures.push(f);
            }
        }
    }

    if (!prioritizeCenter) {
        const { features, truncated } = selectViewportFeaturesCenterFirst(
            [],
            edgeFeatures,
            { maxFeatures, maxVertices }
        );
        return {
            type: 'FeatureCollection',
            features,
            truncated: truncated || candidateCount > features.length,
            candidateCount
        };
    }

    const { features, truncated } = selectViewportFeaturesCenterFirst(
        centerFeatures,
        edgeFeatures,
        { maxFeatures, maxVertices }
    );

    return {
        type: 'FeatureCollection',
        features,
        truncated: truncated || candidateCount > features.length,
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
    centerFocusBounds,
    selectViewportFeaturesCenterFirst,
    VIEWPORT_PAD_FRACTION,
    VIEWPORT_CENTER_FOCUS_FRACTION
};
