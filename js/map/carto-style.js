import logger from '../core/logger.js';
import { hasResolvedCartoApiKey, withCartoKey } from './carto-key.js';

export const CARTO_LAYER_PREFIX = 'basemap-v-';
export const CARTO_GLYPHS_URL = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';
export const DEMO_GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
export const CARTO_2D_BUILDING_LAYER_IDS = [
    `${CARTO_LAYER_PREFIX}building`,
    `${CARTO_LAYER_PREFIX}building-top`
];

/** @type {Map<string, PreparedCartoStyle>} */
const STYLE_CACHE = new Map();
let missingKeyWarned = false;

/**
 * @typedef {object} PreparedCartoStyle
 * @property {string | null} glyphs
 * @property {string | null} sprite
 * @property {string | null} backgroundColor
 * @property {Record<string, object>} sources
 * @property {object[]} layers
 */

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function warnIfCartoKeyMissing() {
    if (missingKeyWarned || hasResolvedCartoApiKey()) return;
    missingKeyWarned = true;
    logger.warn('Map', 'CARTO basemap key is not set; vector tiles still load today', {
        env: 'VITE_CARTO_API_KEY'
    });
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isCartoBasemapLayerId(id) {
    return typeof id === 'string' && id.startsWith(CARTO_LAYER_PREFIX);
}

/**
 * Style layers owned by the basemap stack (backdrop, raster, vector, wash).
 * @param {string} id
 * @returns {boolean}
 */
export function isBasemapOwnedLayerId(id) {
    if (typeof id !== 'string') return false;
    return id === 'basemap-backdrop'
        || id === 'basemap-layer'
        || id === 'basemap-overlay-layer'
        || id === 'basemap-tone-wash'
        || isCartoBasemapLayerId(id);
}

/**
 * @param {string} id
 * @returns {string}
 */
export function prefixCartoId(id) {
    return `${CARTO_LAYER_PREFIX}${id}`;
}

function applyKeyToSourceSpec(spec) {
    const next = { ...spec };
    if (typeof next.url === 'string') next.url = withCartoKey(next.url);
    if (Array.isArray(next.tiles)) next.tiles = next.tiles.map((tile) => withCartoKey(tile));
    return next;
}

/**
 * Normalize a CARTO MapLibre style for injection under our stack.
 * @param {object} style
 * @param {{ labelsOnly?: boolean }} [options]
 * @returns {PreparedCartoStyle}
 */
export function prepareCartoStyle(style, options = {}) {
    const labelsOnly = options.labelsOnly === true;
    const sourceIdMap = {};
    /** @type {Record<string, object>} */
    const sources = {};

    for (const [id, spec] of Object.entries(style?.sources || {})) {
        const nextId = prefixCartoId(id);
        sourceIdMap[id] = nextId;
        sources[nextId] = applyKeyToSourceSpec(cloneJson(spec));
    }

    let backgroundColor = null;
    const layers = [];
    for (const layer of style?.layers || []) {
        if (layer.type === 'background') {
            const color = layer.paint?.['background-color'];
            if (typeof color === 'string') backgroundColor = color;
            continue;
        }
        if (labelsOnly && layer.type !== 'symbol') continue;

        const next = cloneJson(layer);
        next.id = prefixCartoId(layer.id);
        if (next.source && sourceIdMap[next.source]) {
            next.source = sourceIdMap[next.source];
        }
        layers.push(next);
    }

    if (labelsOnly) {
        const used = new Set(layers.map((layer) => layer.source).filter(Boolean));
        for (const id of Object.keys(sources)) {
            if (!used.has(id)) delete sources[id];
        }
    }

    return {
        glyphs: style?.glyphs ? withCartoKey(style.glyphs) : null,
        sprite: style?.sprite ? withCartoKey(style.sprite) : null,
        backgroundColor,
        sources,
        layers
    };
}

/**
 * @param {string} styleUrl
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<object>}
 */
export async function fetchCartoStyleJson(styleUrl, options = {}) {
    warnIfCartoKeyMissing();
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('CARTO style fetch is unavailable');
    }
    const response = await fetchImpl(withCartoKey(styleUrl));
    if (!response?.ok) {
        throw new Error(`CARTO style request failed (${response?.status || 0})`);
    }
    return response.json();
}

/**
 * @param {string} styleUrl
 * @param {{ labelsOnly?: boolean, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<PreparedCartoStyle>}
 */
export async function loadCartoVectorStyle(styleUrl, options = {}) {
    const labelsOnly = options.labelsOnly === true;
    const cacheKey = `${styleUrl}|${labelsOnly ? 'labels' : 'full'}`;
    const cached = STYLE_CACHE.get(cacheKey);
    if (cached) return cached;

    const json = await fetchCartoStyleJson(styleUrl, options);
    const prepared = prepareCartoStyle(json, { labelsOnly });
    STYLE_CACHE.set(cacheKey, prepared);
    return prepared;
}

export function clearCartoStyleCache() {
    STYLE_CACHE.clear();
}
