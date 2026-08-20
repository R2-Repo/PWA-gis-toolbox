/**
 * Cheap live-vector viewport cache: skip ArcGIS hits when the view is
 * already covered, or when the layer is below its min zoom.
 */

/** Extra envelope on each side so zoom-in / small pans reuse the last fetch. */
export const LIVE_FETCH_PAD = 0.2;

/** Float slack so a view sitting on the cached edge still counts as covered. */
export const LIVE_CONTAIN_SLACK = 0.01;

/**
 * @typedef {{ west: number, south: number, east: number, north: number }} LngLatEnvelope
 */

/**
 * @param {{ getWest(): number, getSouth(): number, getEast(): number, getNorth(): number }} bounds
 * @returns {LngLatEnvelope}
 */
export function envelopeFromMapBounds(bounds) {
    return {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth()
    };
}

/**
 * @param {LngLatEnvelope} env
 * @param {number} [pad]
 * @returns {LngLatEnvelope}
 */
export function padEnvelope(env, pad = LIVE_FETCH_PAD) {
    const dx = (env.east - env.west) * pad;
    const dy = (env.north - env.south) * pad;
    return {
        west: env.west - dx,
        south: env.south - dy,
        east: env.east + dx,
        north: env.north + dy
    };
}

/**
 * @param {LngLatEnvelope|null|undefined} outer
 * @param {LngLatEnvelope|null|undefined} inner
 * @param {number} [slack]
 */
export function envelopeContains(outer, inner, slack = LIVE_CONTAIN_SLACK) {
    if (!outer || !inner) return false;
    const dx = Math.max(0, (outer.east - outer.west) * slack);
    const dy = Math.max(0, (outer.north - outer.south) * slack);
    return inner.west >= outer.west - dx
        && inner.east <= outer.east + dx
        && inner.south >= outer.south - dy
        && inner.north <= outer.north + dy;
}

/**
 * @param {number} zoom
 * @param {number|null|undefined} minZoom
 */
export function isLiveLayerInRange(zoom, minZoom) {
    const floor = Number(minZoom);
    if (!Number.isFinite(floor)) return true;
    return Number(zoom) >= floor;
}

/**
 * @param {{ zoom: number, minZoom?: number|null, view: LngLatEnvelope, cached?: LngLatEnvelope|null }} input
 * @returns {'hide'|'reuse'|'fetch'}
 */
export function resolveLiveViewportAction(input) {
    if (!isLiveLayerInRange(input.zoom, input.minZoom)) return 'hide';
    if (input.cached && envelopeContains(input.cached, input.view)) return 'reuse';
    return 'fetch';
}

/**
 * @param {number|null|undefined} refreshMs
 * @param {number} fallback
 */
export function resolveLiveRefreshMs(refreshMs, fallback) {
    const n = Number(refreshMs);
    return Number.isFinite(n) ? n : fallback;
}
