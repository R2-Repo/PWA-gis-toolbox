/**
 * UDOT Fiber symbol sizes.
 * Shrink from zoom 17 outward (high elevation). From 19.02 closer to the
 * ground, hold the approved look (pixels grow with the map).
 */

import { UDOT_FIBER_MIN_ZOOM } from './constants.js';

/** MapLibre zoom where a typical neighborhood / local streets view settles. */
export const UDOT_FIBER_NEIGHBORHOOD_ZOOM = UDOT_FIBER_MIN_ZOOM;

/**
 * APPROVED (user, 2026-08-20): low-elevation / close-to-ground look.
 * Do not change this zoom or the post-lock grow without an explicit request.
 * From this zoom closer to the ground, boxes/splices/cabinets hold this size on the map.
 */
export const UDOT_FIBER_GROUND_LOCK_ZOOM = 19.02;

/** Published ArcGIS PMS points × 96/72 — used until the ground-lock zoom. */
export const UDOT_FIBER_ICON_PX = Object.freeze({
    building: 44,
    cabinets: 29,
    splices: 12,
    boxes: 16,
    default: 16
});

export const UDOT_FIBER_ICON_SPRITE_MAX_PX = 256;

/**
 * APPROVED (user, 2026-08-20): high-elevation shrink starts at zoom 17.
 * Do not change the pre-lock stops without an explicit request.
 * Shrink while zooming out. Lock zoom and closer stay approved.
 * @param {number} px
 * @returns {ReadonlyArray<readonly [number, number]>}
 */
function shrinkOutThenGroundLock(px) {
    const z0 = UDOT_FIBER_GROUND_LOCK_ZOOM;
    return Object.freeze([
        Object.freeze([14, Math.max(5, Math.round(px * 0.38))]),
        Object.freeze([16, Math.max(6, Math.round(px * 0.45))]),
        Object.freeze([17, Math.max(6, Math.round(px * 0.56))]),
        Object.freeze([18, Math.max(8, Math.round(px * 0.75))]),
        Object.freeze([z0, px]),
        Object.freeze([z0 + 1, px * 2]),
        Object.freeze([z0 + 2, px * 4]),
        Object.freeze([z0 + 3, px * 8]),
        Object.freeze([z0 + 4, px * 16]),
        Object.freeze([z0 + 5, px * 32])
    ]);
}

/** Cabinets use the same lock zoom but a flatter scale than boxes/splices. */
function cabinetScaleStops(px) {
    const z0 = UDOT_FIBER_GROUND_LOCK_ZOOM;
    const grow = 1.45;
    return Object.freeze([
        Object.freeze([14, Math.max(14, Math.round(px * 0.62))]),
        Object.freeze([16, Math.max(16, Math.round(px * 0.72))]),
        Object.freeze([17, Math.max(18, Math.round(px * 0.80))]),
        Object.freeze([18, Math.max(22, Math.round(px * 0.90))]),
        Object.freeze([z0, px]),
        Object.freeze([z0 + 1, Math.round(px * grow)]),
        Object.freeze([z0 + 2, Math.round(px * grow ** 2)]),
        Object.freeze([z0 + 3, Math.round(px * grow ** 3)]),
        Object.freeze([z0 + 4, Math.round(px * grow ** 4)]),
        Object.freeze([z0 + 5, Math.round(px * grow ** 5)])
    ]);
}

export const UDOT_FIBER_ICON_ZOOM_PX = Object.freeze({
    boxes: shrinkOutThenGroundLock(UDOT_FIBER_ICON_PX.boxes),
    splices: shrinkOutThenGroundLock(UDOT_FIBER_ICON_PX.splices),
    cabinets: cabinetScaleStops(UDOT_FIBER_ICON_PX.cabinets),
    building: Object.freeze([
        [14, 32],
        [16, 44],
        [18, 64],
        [20, 88],
        [22, 104]
    ])
});

export const UDOT_FIBER_POINT_LAYER_KEYS = Object.freeze([
    'building',
    'cabinets',
    'splices',
    'boxes'
]);

/**
 * @param {string} [layerKey]
 */
export function udotFiberTargetIconPx(layerKey) {
    return UDOT_FIBER_ICON_PX[layerKey] || UDOT_FIBER_ICON_PX.default;
}

/**
 * Interpolate on-screen icon pixels at a MapLibre zoom.
 * Sheet PDFs use ~z19 (1100 ft on tabloid ≈ approved ground-lock look).
 * @param {string} [layerKey]
 * @param {number} [zoom]
 */
export function udotFiberIconPxAtZoom(layerKey, zoom = UDOT_FIBER_GROUND_LOCK_ZOOM) {
    const z = Number(zoom);
    const stops = UDOT_FIBER_ICON_ZOOM_PX[layerKey];
    if (!stops?.length || !Number.isFinite(z)) return udotFiberTargetIconPx(layerKey);
    if (z <= stops[0][0]) return stops[0][1];
    const last = stops[stops.length - 1];
    if (z >= last[0]) return last[1];
    for (let i = 1; i < stops.length; i++) {
        const [z0, p0] = stops[i - 1];
        const [z1, p1] = stops[i];
        if (z <= z1) {
            const t = (z - z0) / (z1 - z0);
            return p0 + (p1 - p0) * t;
        }
    }
    return last[1];
}

/**
 * Sprite pixel size, capped so close-up uses icon-size > 1 instead of huge SVGs.
 * @param {string} [layerKey]
 */
export function udotFiberIconSpritePx(layerKey) {
    const stops = UDOT_FIBER_ICON_ZOOM_PX[layerKey];
    const raw = stops?.length ? stops[stops.length - 1][1] : udotFiberTargetIconPx(layerKey);
    return Math.min(UDOT_FIBER_ICON_SPRITE_MAX_PX, raw);
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
        const easing = layerKey === 'building' || layerKey === 'cabinets'
            ? ['linear']
            : ['exponential', 2];
        const expr = ['interpolate', easing, ['zoom']];
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
