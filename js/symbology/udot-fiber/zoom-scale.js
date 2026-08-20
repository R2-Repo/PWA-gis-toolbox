/**
 * Screen-size lock for UDOT Fiber symbols.
 * Below neighborhood zoom, sizes hold (do not keep growing as the map shrinks).
 * Building PMS sprites are ~156px — they are capped to a neighborhood icon size.
 */

import { UDOT_FIBER_MIN_ZOOM } from './constants.js';

/** MapLibre zoom where a typical neighborhood / local streets view settles. */
export const UDOT_FIBER_NEIGHBORHOOD_ZOOM = UDOT_FIBER_MIN_ZOOM;

/** Target on-screen pixels at neighborhood (and farther out). */
export const UDOT_FIBER_ICON_PX = Object.freeze({
    building: 18,
    cabinets: 16,
    splices: 16,
    boxes: 14,
    default: 16
});

/**
 * @param {string} [layerKey]
 */
export function udotFiberTargetIconPx(layerKey) {
    return UDOT_FIBER_ICON_PX[layerKey] || UDOT_FIBER_ICON_PX.default;
}

/**
 * MapLibre `icon-size` from published Esri PMS width (points/pixels).
 * @param {number} [esriWidth]
 * @param {string} [layerKey]
 */
export function udotFiberIconSizeFromEsriWidth(esriWidth, layerKey) {
    const target = udotFiberTargetIconPx(layerKey);
    const native = Math.max(10, Number(esriWidth) || target);
    return target / native;
}

/**
 * Hold `value` at and below neighborhood zoom. Optional slight grow when zooming in.
 * `value` may be a number or a MapLibre expression.
 * @param {number|unknown[]} value
 * @param {string} [layerKey]
 */
export function buildUdotFiberZoomSize(value, layerKey) {
    const z = UDOT_FIBER_NEIGHBORHOOD_ZOOM;
    const grow = layerKey === 'building' ? 1 : 1.12;
    const close = grow === 1 || value == null
        ? value
        : (typeof value === 'number' ? value * grow : ['*', value, grow]);
    return [
        'interpolate', ['linear'], ['zoom'],
        z - 8, value,
        z, value,
        z + 4, close
    ];
}

/**
 * @param {string} [layerKey]
 */
export function buildUdotFiberIconSizeExpression(layerKey) {
    const target = udotFiberTargetIconPx(layerKey);
    const base = [
        '/',
        target,
        ['max', 10, ['to-number', ['coalesce', ['get', '_udotEsriWidth'], 24]]]
    ];
    return buildUdotFiberZoomSize(base, layerKey);
}

/**
 * @param {number|unknown[]} width
 * @param {string} [layerKey]
 */
export function buildUdotFiberLineWidthExpression(width, layerKey) {
    return buildUdotFiberZoomSize(width, layerKey);
}

/**
 * @param {number|unknown[]} radius
 * @param {string} [layerKey]
 */
export function buildUdotFiberCircleRadiusExpression(radius, layerKey) {
    return buildUdotFiberZoomSize(radius, layerKey);
}
