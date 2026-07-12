/**
 * SVG icon generators for procurement plan-production point symbols.
 * Each icon is designed for crisp MapLibre rendering at 32–48 px.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {number} size
 * @param {string} inner
 * @returns {string}
 */
function wrapSvg(size, inner) {
    return `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 32 32">${inner}</svg>`;
}

/**
 * @param {object} [options]
 * @param {string} [options.stroke]
 * @param {string} [options.fill]
 * @param {number} [options.opacity]
 * @returns {string}
 */
export function handholeType1Svg(options = {}) {
    const stroke = options.stroke || '#047857';
    const fill = options.fill || '#10b981';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <rect x="6" y="8" width="20" height="16" rx="4" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>
        <rect x="13" y="14" width="6" height="4" rx="1" fill="${stroke}" opacity="0.35"/>
    `);
}

/**
 * @param {object} [options]
 * @returns {string}
 */
export function handholeType2Svg(options = {}) {
    const stroke = options.stroke || '#065f46';
    const fill = options.fill || '#059669';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <path d="M6 10 L26 8 L26 24 L6 26 Z" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M20 8 L26 8 L26 14" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
        <rect x="13" y="14" width="6" height="4" rx="1" fill="${stroke}" opacity="0.35"/>
    `);
}

/**
 * @param {object} [options]
 * @returns {string}
 */
export function handholeType3Svg(options = {}) {
    const stroke = options.stroke || '#0f766e';
    const fill = options.fill || '#14b8a6';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <polygon points="16,5 26,10 26,22 16,27 6,22 6,10" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="16" cy="16" r="3.5" fill="${stroke}" opacity="0.35"/>
    `);
}

/**
 * @param {object} [options]
 * @returns {string}
 */
export function handholeVaultSvg(options = {}) {
    const stroke = options.stroke || '#334155';
    const fill = options.fill || '#64748b';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <polygon points="16,4 27,9 27,23 16,28 5,23 5,9" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
        <line x1="8" y1="12" x2="24" y2="12" stroke="${stroke}" stroke-width="1.2" opacity="0.5"/>
        <line x1="8" y1="16" x2="24" y2="16" stroke="${stroke}" stroke-width="1.2" opacity="0.5"/>
        <line x1="8" y1="20" x2="24" y2="20" stroke="${stroke}" stroke-width="1.2" opacity="0.5"/>
        <rect x="13" y="14" width="6" height="5" rx="1" fill="#1e293b" opacity="0.45"/>
    `);
}

/**
 * @param {object} [options]
 * @returns {string}
 */
export function spliceEnclosureSvg(options = {}) {
    const stroke = options.stroke || '#6d28d9';
    const fill = options.fill || '#8b5cf6';
    const accent = options.accent || '#c4b5fd';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <circle cx="16" cy="16" r="11" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>
        <path d="M16 7 L18.5 13.5 L25.5 14 L20 18.5 L21.5 25.5 L16 22 L10.5 25.5 L12 18.5 L6.5 14 L13.5 13.5 Z"
            fill="${accent}" opacity="0.85"/>
        <circle cx="16" cy="16" r="3" fill="${stroke}" opacity="0.55"/>
    `);
}

/**
 * @param {object} [options]
 * @returns {string}
 */
export function buildingEntranceSvg(options = {}) {
    const stroke = options.stroke || '#4338ca';
    const fill = options.fill || '#6366f1';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <rect x="7" y="10" width="18" height="16" rx="2" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>
        <path d="M16 6 L26 10 L26 12 L6 12 L6 10 Z" fill="${stroke}" opacity="0.75"/>
        <rect x="13" y="17" width="6" height="9" rx="1" fill="#eef2ff" stroke="${stroke}" stroke-width="1.5"/>
        <circle cx="17.5" cy="22" r="0.8" fill="${stroke}"/>
    `);
}

/**
 * @param {object} [options]
 * @returns {string}
 */
export function buildingSvg(options = {}) {
    const stroke = options.stroke || '#5b21b6';
    const fill = options.fill || '#7c3aed';
    const opacity = options.opacity ?? 0.92;
    return wrapSvg(32, `
        <rect x="8" y="12" width="16" height="14" rx="1.5" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>
        <rect x="11" y="15" width="3" height="3" fill="#ede9fe" opacity="0.9"/>
        <rect x="18" y="15" width="3" height="3" fill="#ede9fe" opacity="0.9"/>
        <rect x="11" y="20" width="3" height="3" fill="#ede9fe" opacity="0.9"/>
        <rect x="18" y="20" width="3" height="3" fill="#ede9fe" opacity="0.9"/>
        <path d="M8 12 L16 6 L24 12" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
    `);
}

/** @type {Record<string, (options?: object) => string>} */
export const PROCEDURE_ICON_RENDERERS = {
    'handhole-type-1': handholeType1Svg,
    'handhole-type-2': handholeType2Svg,
    'handhole-type-3': handholeType3Svg,
    'handhole-vault': handholeVaultSvg,
    'splice-enclosure': spliceEnclosureSvg,
    'building-entrance': buildingEntranceSvg,
    'building': buildingSvg
};

/**
 * @param {string} iconId
 * @param {object} [options]
 * @returns {string|null}
 */
export function renderProcurementIcon(iconId, options = {}) {
    const renderer = PROCEDURE_ICON_RENDERERS[iconId];
    return renderer ? renderer(options) : null;
}
