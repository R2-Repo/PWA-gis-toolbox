/**
 * Existing protect in place paint for editable UDOT Fiber operational copies.
 * Dashed black stroke, no fill, no class color.
 */

import { UDOT_FIBER_POINT_LAYER_KEYS, udotFiberIconSpritePx } from './zoom-scale.js';

export const UDOT_PROTECT_IN_PLACE_PROP = '_udotProtectInPlace';
export const UDOT_PIP_GLYPH_PROP = '_udotPipGlyph';
export const UDOT_PIP_COLOR = '#000000';
export const UDOT_PIP_LINE_DASH = Object.freeze([3, 2]);
export const UDOT_PIP_PDF_DASH = Object.freeze([2.4, 1.8]);

const DEFAULT_SPRITE_PX = 24;

/**
 * @param {object|null|undefined} feature
 * @returns {boolean}
 */
export function isProtectInPlaceFeature(feature) {
    const value = feature?.properties?.[UDOT_PROTECT_IN_PLACE_PROP];
    return value === 1 || value === true || value === '1';
}

/**
 * @param {object} feature
 * @param {boolean} enabled
 * @returns {object}
 */
export function setProtectInPlaceFlag(feature, enabled) {
    const properties = { ...(feature?.properties || {}) };
    if (enabled) properties[UDOT_PROTECT_IN_PLACE_PROP] = 1;
    else {
        delete properties[UDOT_PROTECT_IN_PLACE_PROP];
        delete properties[UDOT_PIP_GLYPH_PROP];
    }
    return { ...feature, properties };
}

/**
 * @returns {unknown[]}
 */
export function protectInPlaceFlagExpression() {
    return ['to-number', ['coalesce', ['get', UDOT_PROTECT_IN_PLACE_PROP], 0]];
}

/**
 * @param {unknown} baseFilter
 * @param {unknown} extra
 * @returns {unknown}
 */
export function andMapLibreFilter(baseFilter, extra) {
    if (!extra) return baseFilter;
    if (!baseFilter) return extra;
    if (Array.isArray(baseFilter) && baseFilter[0] === 'all') {
        return ['all', ...baseFilter.slice(1), extra];
    }
    return ['all', baseFilter, extra];
}

/**
 * @param {unknown} [baseFilter]
 * @returns {unknown}
 */
export function excludeProtectInPlaceFilter(baseFilter) {
    return andMapLibreFilter(baseFilter, ['==', protectInPlaceFlagExpression(), 0]);
}

/**
 * @param {unknown} [baseFilter]
 * @returns {unknown}
 */
export function includeProtectInPlaceFilter(baseFilter) {
    return andMapLibreFilter(baseFilter, ['==', protectInPlaceFlagExpression(), 1]);
}

/**
 * @param {string} [fiberKey]
 * @returns {'rect'|'circle'}
 */
export function protectInPlaceOutlineKind(fiberKey) {
    return fiberKey === 'boxes' ? 'rect' : 'circle';
}

/**
 * @param {'rect'|'circle'} kind
 * @param {number} [size]
 * @returns {string}
 */
export function protectInPlaceImageId(kind, size = DEFAULT_SPRITE_PX) {
    const px = Math.max(16, Math.round(Number(size) || DEFAULT_SPRITE_PX));
    return `udot-pip-${kind}-${px}`;
}

/**
 * Hollow dashed black outline — no fill, no class color.
 * @param {'rect'|'circle'} kind
 * @param {number} [size]
 * @returns {string}
 */
export function makeProtectInPlaceSvg(kind, size = DEFAULT_SPRITE_PX) {
    const s = Math.max(16, Number(size) || DEFAULT_SPRITE_PX);
    const sw = Math.max(1.4, s / 12);
    const dash = `${(sw * 2.4).toFixed(2)} ${(sw * 1.6).toFixed(2)}`;
    const common = `xmlns="http://www.w3.org/2000/svg"`;

    if (kind === 'rect') {
        const w = Math.round(s * 1.4);
        const h = Math.round(s * 0.82);
        const rw = w * 0.9;
        const rh = rw / 2.05;
        const x = (w - rw) / 2;
        const y = (h - rh) / 2;
        return `<svg ${common} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="none" stroke="${UDOT_PIP_COLOR}" stroke-width="${sw * 1.15}" stroke-dasharray="${dash}"/>
</svg>`;
    }

    const mid = s / 2;
    const r = s * 0.34;
    return `<svg ${common} width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${UDOT_PIP_COLOR}" stroke-width="${sw * 1.45}" stroke-dasharray="${dash}"/>
</svg>`;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {'rect'|'circle'} kind
 * @param {number} [size]
 * @returns {string}
 */
export function ensureProtectInPlaceImage(map, kind, size = DEFAULT_SPRITE_PX) {
    const imageId = protectInPlaceImageId(kind, size);
    if (!map || map.hasImage?.(imageId)) return imageId;
    if (typeof Image === 'undefined') return imageId;

    const svg = makeProtectInPlaceSvg(kind, size);
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
        try {
            if (map && !map.hasImage(imageId)) map.addImage(imageId, img);
        } finally {
            URL.revokeObjectURL(url);
        }
    };
    img.src = url;
    return imageId;
}

/**
 * @param {import('maplibre-gl').Map} [map]
 */
export function preloadProtectInPlaceImages(map) {
    const sizes = new Set([DEFAULT_SPRITE_PX]);
    for (const key of UDOT_FIBER_POINT_LAYER_KEYS) {
        sizes.add(udotFiberIconSpritePx(key));
    }
    for (const px of sizes) {
        ensureProtectInPlaceImage(map, 'circle', px);
        ensureProtectInPlaceImage(map, 'rect', px);
    }
}
