/**
 * Procedural CAD-like point glyphs for UDOT Fiber Network (no external SVGs).
 * Rules start sparse — grow by attribute as symbols are identified in the field.
 */

/** @typedef {'circle'|'ring'|'square-x'|'bowtie'|'dashed-box'|'diamond'|'vee-circle'} UdotGlyphKind */

/**
 * @typedef {object} UdotGlyphRule
 * @property {string} layerKey
 * @property {string} field
 * @property {string} value
 * @property {UdotGlyphKind} glyph
 * @property {string} [color]
 */

/** Seed rules — extend as you map attributes → symbols. */
/** @type {UdotGlyphRule[]} */
export const UDOT_GLYPH_RULES = [
    { layerKey: 'boxes', field: 'DT_RSCENCLOSURE_NAME', value: 'Vault', glyph: 'dashed-box', color: '#ffffff' },
    { layerKey: 'building', field: 'MODEL', value: 'UEN Building', glyph: 'square-x', color: '#00ff00' },
    { layerKey: 'cabinets', field: 'MODEL', value: 'Cabinet', glyph: 'square-x', color: '#00ff00' }
];

/**
 * @param {string} layerKey
 * @param {Record<string, unknown>} [props]
 * @returns {{ glyph: UdotGlyphKind, color: string|null }|null}
 */
export function resolvePointGlyph(layerKey, props = {}) {
    if (layerKey === 'splices') {
        return { glyph: 'bowtie', color: '#ff0000' };
    }
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
 * @param {UdotGlyphKind} glyph
 * @param {string} stroke
 * @param {string} fill
 * @param {number} [size]
 * @returns {string} SVG markup
 */
export function makeUdotGlyphSvg(glyph, stroke, fill, size = 18) {
    const s = Math.max(12, Number(size) || 18);
    const sw = Math.max(1.2, s / 12);
    const common = `xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"`;

    if (glyph === 'square-x') {
        const pad = s * 0.15;
        const x1 = pad;
        const y1 = pad;
        const x2 = s - pad;
        const y2 = s - pad;
        return `<svg ${common}>
  <rect x="${pad}" y="${pad}" width="${s - pad * 2}" height="${s - pad * 2}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>
  <line x1="${x2}" y1="${y1}" x2="${x1}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>
  <circle cx="${s / 2}" cy="${s / 2}" r="${sw}" fill="#ffffff"/>
</svg>`;
    }

    if (glyph === 'bowtie') {
        const mid = s / 2;
        return `<svg ${common}>
  <polygon points="${s * 0.1},${s * 0.2} ${mid},${mid} ${s * 0.1},${s * 0.8}" fill="${fill}" fill-opacity="0.35" stroke="${stroke}" stroke-width="${sw}"/>
  <polygon points="${s * 0.9},${s * 0.2} ${mid},${mid} ${s * 0.9},${s * 0.8}" fill="${fill}" fill-opacity="0.35" stroke="${stroke}" stroke-width="${sw}"/>
</svg>`;
    }

    if (glyph === 'dashed-box') {
        const pad = s * 0.18;
        return `<svg ${common}>
  <rect x="${pad}" y="${pad}" width="${s - pad * 2}" height="${s - pad * 2}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="${sw * 2} ${sw * 1.5}"/>
</svg>`;
    }

    if (glyph === 'diamond') {
        const mid = s / 2;
        const pad = s * 0.15;
        return `<svg ${common}>
  <polygon points="${mid},${pad} ${s - pad},${mid} ${mid},${s - pad} ${pad},${mid}" fill="${fill}" fill-opacity="0.25" stroke="${stroke}" stroke-width="${sw}"/>
</svg>`;
    }

    if (glyph === 'ring') {
        return `<svg ${common}>
  <circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.36}" fill="none" stroke="${stroke}" stroke-width="${sw * 1.4}"/>
</svg>`;
    }

    if (glyph === 'vee-circle') {
        const cx = s / 2;
        const r = s * 0.36;
        const top = cx - r * 0.35;
        const bot = cx + r * 0.4;
        const left = cx - r * 0.42;
        const right = cx + r * 0.42;
        return `<svg ${common}>
  <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
  <polyline points="${left},${top} ${cx},${bot} ${right},${top}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
</svg>`;
    }

    // circle
    return `<svg ${common}>
  <circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.35}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
</svg>`;
}

/**
 * Register a glyph image on a MapLibre map (sync id; async pixel load).
 * @param {import('maplibre-gl').Map} map
 * @param {UdotGlyphKind} glyph
 * @param {string} color
 * @param {number} [size]
 * @returns {string} image id
 */
export function ensureUdotGlyphImage(map, glyph, color, size = 18) {
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
