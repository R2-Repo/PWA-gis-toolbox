/**
 * Screen-size lock for UDOT Fiber symbols.
 * Point icons scale with zoom (small when pulled back, large up close).
 * Buildings and cabinets use a larger scale than boxes/splices.
 */

import { UDOT_FIBER_MIN_ZOOM } from './constants.js';

/** MapLibre zoom where a typical neighborhood / local streets view settles. */
export const UDOT_FIBER_NEIGHBORHOOD_ZOOM = UDOT_FIBER_MIN_ZOOM;

/** Target on-screen pixels at neighborhood zoom (fallback when a layer has no stops). */
export const UDOT_FIBER_ICON_PX = Object.freeze({
    building: 44,
    cabinets: 28,
    splices: 14,
    boxes: 14,
    default: 16
});

/**
 * On-screen px by MapLibre zoom for layers that must shrink out / grow in.
 * Stops: layer min zoom → street → close → max.
 */
export const UDOT_FIBER_ICON_ZOOM_PX = Object.freeze({
    boxes: Object.freeze([
        [14, 10],
        [16, 14],
        [18, 28],
        [20, 46],
        [22, 52]
    ]),
    splices: Object.freeze([
        [14, 10],
        [16, 14],
        [18, 28],
        [20, 46],
        [22, 52]
    ]),
    cabinets: Object.freeze([
        [14, 20],
        [16, 28],
        [18, 42],
        [20, 58],
        [22, 68]
    ]),
    building: Object.freeze([
        [14, 32],
        [16, 44],
        [18, 64],
        [20, 88],
        [22, 104]
    ])
});

/**
 * @param {string} [layerKey]
 */
export function udotFiberTargetIconPx(layerKey) {
    return UDOT_FIBER_ICON_PX[layerKey] || UDOT_FIBER_ICON_PX.default;
}

/**
 * Sprite pixel size — large enough for the closest zoom stop.
 * @param {string} [layerKey]
 */
export function udotFiberIconSpritePx(layerKey) {
    const stops = UDOT_FIBER_ICON_ZOOM_PX[layerKey];
    if (stops?.length) return stops[stops.length - 1][1];
    return udotFiberTargetIconPx(layerKey);
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

function nativeWidthExpr() {
    return ['max', 10, ['to-number', ['coalesce', ['get', '_udotEsriWidth'], 24]]];
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
    const native = nativeWidthExpr();
    const stops = UDOT_FIBER_ICON_ZOOM_PX[layerKey];
    if (stops?.length) {
        const expr = ['interpolate', ['linear'], ['zoom']];
        for (const [z, px] of stops) {
            expr.push(z, ['/', px, native]);
        }
        return expr;
    }
    return buildUdotFiberZoomSize(['/', udotFiberTargetIconPx(layerKey), native], layerKey);
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

/**
 * Invisible hit-circle radius — at least 16px, ~55% of the on-screen icon.
 * @param {string} [layerKey]
 */
export function buildUdotFiberHitRadiusExpression(layerKey) {
    const stops = UDOT_FIBER_ICON_ZOOM_PX[layerKey];
    if (stops?.length) {
        const expr = ['interpolate', ['linear'], ['zoom']];
        for (const [z, px] of stops) {
            expr.push(z, Math.max(16, px * 0.55));
        }
        return expr;
    }
    return Math.max(16, udotFiberTargetIconPx(layerKey) * 0.55);
}
