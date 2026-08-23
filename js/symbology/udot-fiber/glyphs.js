/**
 * Procedural CAD lookalike glyphs for UDOT Fiber Network (no external SVGs).
 */
import { resolveLookalike } from './lookalikes.js';
import { UDOT_BOX_IN_LABEL_PROP, UDOT_BOX_LABEL_FIELD } from './constants.js';
import { UDOT_FIBER_POINT_LAYER_KEYS, udotFiberIconSpritePx } from './zoom-scale.js';
import {
    UDOT_PIP_GLYPH_PROP,
    ensureProtectInPlaceImage,
    isProtectInPlaceFeature,
    protectInPlaceOutlineKind
} from './protect-in-place.js';

/** @typedef {'circle'|'ring'|'rect'|'square-x'|'bowtie'|'dashed-box'|'diamond'|'vee-circle'|'rounded-square'|'hex'|'building'} UdotGlyphKind */

/**
 * @typedef {object} UdotGlyphRule
 * @property {string} layerKey
 * @property {string} field
 * @property {string} value
 * @property {UdotGlyphKind} glyph
 * @property {string} [color]
 */

/** Pixel canvas for registered sprites. */
export const UDOT_FIBER_GLYPH_PX = 24;

/** Seed rules — lookalikes cover published classes first. */
/** @type {UdotGlyphRule[]} */
export const UDOT_GLYPH_RULES = [
    { layerKey: 'boxes', field: 'DT_RSCENCLOSURE_NAME', value: 'Vault', glyph: 'ring', color: '#ff0000' },
    { layerKey: 'building', field: 'MODEL', value: 'UEN Building', glyph: 'square-x', color: '#00ff00' },
    { layerKey: 'cabinets', field: 'MODEL', value: 'Cabinet', glyph: 'square-x', color: '#00ff00' }
];

const POINT_KEYS = new Set(['cabinets', 'splices', 'boxes', 'building']);

/**
 * @param {string} layerKey
 * @param {Record<string, unknown>} [props]
 * @returns {{ glyph: UdotGlyphKind, color: string|null }|null}
 */
export function resolvePointGlyph(layerKey, props = {}) {
    const lookalike = resolveLookalike(layerKey, props);
    if (lookalike) return lookalike;
    for (const rule of UDOT_GLYPH_RULES) {
        if (rule.layerKey !== layerKey) continue;
        const raw = props[rule.field];
        if (raw == null) continue;
        const text = String(raw);
        if (text === rule.value || text.toLowerCase().includes(String(rule.value).toLowerCase())) {
            return { glyph: rule.glyph, color: rule.color || null };
        }
    }
    return null;
}

/**
 * Build a MapLibre match expression for icon-image from class field + glyph map.
 * @param {string} field
 * @param {Array<{ value: string, imageId: string }>} pairs
 * @param {string} fallbackImageId
 */
export function buildGlyphMatchExpression(field, pairs, fallbackImageId) {
    if (!pairs.length) return fallbackImageId;
    const expr = ['match', ['to-string', ['get', field]]];
    for (const pair of pairs) {
        expr.push(String(pair.value), pair.imageId);
    }
    expr.push(fallbackImageId);
    return expr;
}

/**
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 255, g: 255, b: 255 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 */
function rgbToHex({ r, g, b }) {
    const byte = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} t
 */
function mixHex(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return rgbToHex({
        r: A.r + (B.r - A.r) * t,
        g: A.g + (B.g - A.g) * t,
        b: A.b + (B.b - A.b) * t
    });
}

/**
 * @param {string} color
 */
function toneFor(color) {
    const base = color || '#ffffff';
    return {
        base,
        fill: mixHex(base, '#ffffff', 0.18),
        stroke: mixHex(base, '#000000', 0.28),
        highlight: mixHex(base, '#ffffff', 0.5)
    };
}

/**
 * @param {number} w
 * @param {number} h
 * @param {string} inner
 */
function svgFrame(w, h, inner) {
    const common = `xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`;
    return `<svg ${common}>${inner}</svg>`;
}

/**
 * @param {UdotGlyphKind} glyph
 * @param {string} stroke
 * @param {string} fill
 * @param {number} [size]
 * @returns {string} SVG markup
 */
export function makeUdotGlyphSvg(glyph, stroke, fill, size = UDOT_FIBER_GLYPH_PX) {
    const s = Math.max(16, Number(size) || UDOT_FIBER_GLYPH_PX);
    const sw = Math.max(1.15, s / 14);
    const tone = toneFor(stroke || fill || '#ffffff');
    const ink = tone.stroke;
    const body = tone.fill;
    const hi = tone.highlight;
    const pad = s * 0.18;
    const mid = s / 2;

    if (glyph === 'square-x') {
        const x1 = pad;
        const y1 = pad;
        const x2 = s - pad;
        const y2 = s - pad * 1.15;
        return svgFrame(s, s, `
  <rect x="${pad}" y="${pad * 0.85}" width="${s - pad * 2}" height="${s - pad * 2.1}" rx="${sw}" fill="${body}" fill-opacity="0.22" stroke="${ink}" stroke-width="${sw}"/>
  <line x1="${x1 + sw}" y1="${y1}" x2="${x2 - sw}" y2="${y2}" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>
  <line x1="${x2 - sw}" y1="${y1}" x2="${x1 + sw}" y2="${y2}" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>
  <ellipse cx="${mid}" cy="${pad * 1.15}" rx="${s * 0.16}" ry="${s * 0.05}" fill="${hi}" fill-opacity="0.45"/>`);
    }

    if (glyph === 'bowtie') {
        return svgFrame(s, s, `
  <polygon points="${s * 0.06},${s * 0.14} ${mid},${mid} ${s * 0.06},${s * 0.82}" fill="${body}" fill-opacity="0.55" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>
  <polygon points="${s * 0.94},${s * 0.14} ${mid},${mid} ${s * 0.94},${s * 0.82}" fill="${body}" fill-opacity="0.55" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`);
    }

    if (glyph === 'rect') {
        const w = Math.round(s * 1.4);
        const h = Math.round(s * 0.82);
        const rw = w * 0.9;
        const rh = rw / 2.05;
        const x = (w - rw) / 2;
        const y = (h - rh) / 2;
        return svgFrame(w, h, `
  <rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="0.4" fill="#ffffff" fill-opacity="1" stroke="${ink}" stroke-width="${sw * 1.15}"/>`);
    }

    if (glyph === 'dashed-box') {
        return svgFrame(s, s, `
  <rect x="${pad}" y="${pad * 0.85}" width="${s - pad * 2}" height="${s - pad * 2.1}" rx="${sw}" fill="${body}" fill-opacity="0.12" stroke="${ink}" stroke-width="${sw}" stroke-dasharray="${sw * 2.1} ${sw * 1.4}"/>
  <ellipse cx="${mid}" cy="${pad * 1.15}" rx="${s * 0.14}" ry="${s * 0.04}" fill="${hi}" fill-opacity="0.4"/>`);
    }

    if (glyph === 'diamond') {
        const top = pad * 0.85;
        const bot = s - pad * 1.2;
        return svgFrame(s, s, `
  <polygon points="${mid},${top} ${s - pad},${mid} ${mid},${bot} ${pad},${mid}" fill="${body}" fill-opacity="0.42" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>
  <ellipse cx="${mid}" cy="${pad * 1.2}" rx="${s * 0.1}" ry="${s * 0.035}" fill="${hi}" fill-opacity="0.45"/>`);
    }

    if (glyph === 'ring') {
        return svgFrame(s, s, `
  <circle cx="${mid}" cy="${mid}" r="${s * 0.34}" fill="${body}" fill-opacity="0.16" stroke="${ink}" stroke-width="${sw * 1.45}"/>`);
    }

    if (glyph === 'vee-circle') {
        const cx = mid;
        const r = s * 0.3;
        const top = cx - r * 0.32;
        const bot = cx + r * 0.36;
        const left = cx - r * 0.4;
        const right = cx + r * 0.4;
        return svgFrame(s, s, `
  <circle cx="${cx}" cy="${cx * 0.96}" r="${r}" fill="${body}" fill-opacity="0.18" stroke="${ink}" stroke-width="${sw}"/>
  <polyline points="${left},${top} ${cx},${bot} ${right},${top}" fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }

    if (glyph === 'rounded-square') {
        return svgFrame(s, s, `
  <rect x="${pad}" y="${pad * 0.85}" width="${s - pad * 2}" height="${s - pad * 2.1}" rx="${s * 0.14}" fill="${body}" fill-opacity="0.5" stroke="${ink}" stroke-width="${sw}"/>
  <ellipse cx="${mid}" cy="${pad * 1.2}" rx="${s * 0.16}" ry="${s * 0.045}" fill="${hi}" fill-opacity="0.5"/>`);
    }

    if (glyph === 'hex') {
        const r = s * 0.34;
        const cy = mid * 0.96;
        const pts = [0, 1, 2, 3, 4, 5].map((i) => {
            const a = (Math.PI / 180) * (60 * i - 30);
            return `${mid + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        }).join(' ');
        return svgFrame(s, s, `
  <polygon points="${pts}" fill="${body}" fill-opacity="0.5" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>
  <ellipse cx="${mid}" cy="${s * 0.3}" rx="${s * 0.12}" ry="${s * 0.04}" fill="${hi}" fill-opacity="0.45"/>`);
    }

    if (glyph === 'building') {
        const x = pad;
        const w = s - pad * 2;
        const roof = pad * 0.7;
        const baseY = s - pad * 1.2;
        const wallY = s * 0.38;
        return svgFrame(s, s, `
  <polygon points="${mid},${roof} ${x},${wallY} ${x + w},${wallY}" fill="${body}" fill-opacity="0.55" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>
  <rect x="${x + sw * 0.4}" y="${wallY}" width="${w - sw * 0.8}" height="${baseY - wallY}" fill="${body}" fill-opacity="0.42" stroke="${ink}" stroke-width="${sw}"/>
  <ellipse cx="${mid}" cy="${roof + sw}" rx="${s * 0.1}" ry="${s * 0.03}" fill="${hi}" fill-opacity="0.4"/>`);
    }

    return svgFrame(s, s, `
  <circle cx="${mid}" cy="${mid * 0.96}" r="${s * 0.3}" fill="${body}" stroke="${ink}" stroke-width="${sw}"/>
  <ellipse cx="${mid}" cy="${s * 0.3}" rx="${s * 0.12}" ry="${s * 0.04}" fill="${hi}" fill-opacity="0.45"/>`);
}

/** @type {Array<[UdotGlyphKind, string]>} */
export const UDOT_FIBER_PRELOAD_GLYPHS = [
    ['square-x', '#00ff00'],
    ['bowtie', '#ff0000'],
    ['rect', '#111111'],
    ['dashed-box', '#ffffff'],
    ['diamond', '#ffff00'],
    ['diamond', '#94a3b8'],
    ['rounded-square', '#00f0f0'],
    ['ring', '#ff0000'],
    ['hex', '#ff7f00'],
    ['building', '#00ff00'],
    ['circle', '#94a3b8'],
    ['circle', '#00ff00'],
    ['circle', '#ff7f00'],
    ['ring', '#94a3b8'],
    ['ring', '#00ff00'],
    ['vee-circle', '#ffff00']
];

/**
 * Register a glyph image on a MapLibre map (sync id; async pixel load).
 * @param {import('maplibre-gl').Map} map
 * @param {UdotGlyphKind} glyph
 * @param {string} color
 * @param {number} [size]
 * @returns {string} image id
 */
export function ensureUdotGlyphImage(map, glyph, color, size = UDOT_FIBER_GLYPH_PX) {
    const safeColor = String(color || '#ffffff').replace(/#/g, '');
    const imageId = `udot-glyph-${glyph}-${safeColor}-${size}`;
    if (!map || map.hasImage?.(imageId)) return imageId;

    const svg = makeUdotGlyphSvg(glyph, color || '#ffffff', color || '#ffffff', size);
    if (typeof Image === 'undefined') return imageId;

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
 * @param {number} [size]
 */
export function preloadUdotFiberGlyphs(map, size = UDOT_FIBER_GLYPH_PX) {
    const sizes = new Set([UDOT_FIBER_GLYPH_PX, Number(size) || UDOT_FIBER_GLYPH_PX]);
    for (const key of UDOT_FIBER_POINT_LAYER_KEYS) {
        sizes.add(udotFiberIconSpritePx(key));
    }
    for (const px of sizes) {
        for (const [glyph, color] of UDOT_FIBER_PRELOAD_GLYPHS) {
            ensureUdotGlyphImage(map, glyph, color, px);
        }
    }
}

/**
 * Stamp procedural lookalike image ids onto Fiber point features.
 * @param {string} layerKey
 * @param {object[]} features
 * @param {import('maplibre-gl').Map} [map]
 * @param {number} [size]
 */
export function decorateUdotFiberPointFeatures(layerKey, features, map, size) {
    if (!features?.length || !POINT_KEYS.has(layerKey)) return features;
    const px = Number.isFinite(Number(size)) && Number(size) > 0
        ? Number(size)
        : Math.max(UDOT_FIBER_GLYPH_PX, udotFiberIconSpritePx(layerKey));
    return features.map((feature) => {
        const hit = resolvePointGlyph(layerKey, feature.properties || {});
        const pip = isProtectInPlaceFeature(feature);
        if (!hit && !pip) return feature;
        const properties = { ...(feature.properties || {}) };
        if (hit) {
            properties._udotGlyph = ensureUdotGlyphImage(map, hit.glyph, hit.color || '#ffffff', px);
            properties._udotEsriWidth = px;
        }
        if (pip) {
            properties[UDOT_PIP_GLYPH_PROP] = ensureProtectInPlaceImage(
                map,
                protectInPlaceOutlineKind(layerKey),
                px
            );
        }
        if (!pip && layerKey === 'boxes' && hit?.glyph === 'rect') {
            const raw = properties[UDOT_BOX_LABEL_FIELD];
            if (raw != null && String(raw).trim() !== '') {
                properties[UDOT_BOX_IN_LABEL_PROP] = 1;
            }
        }
        return {
            ...feature,
            properties
        };
    });
}
