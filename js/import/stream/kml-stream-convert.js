/**
 * Convert streamed KML placemark blocks to GeoJSON features.
 *
 * Blocks are wrapped in a minimal synthetic document (original root namespaces
 * + referenced shared styles/schemas) and parsed in batches with the same
 * DOMParser + toGeoJSON pipeline the standard importer uses. Dependencies are
 * injected so the module is pure and node-testable.
 */
import { stripKmlPresentationFromGeoJSON } from '../parsers/kml-strip.js';

const DEFAULT_ROOT_TAG = '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">';

/** Shared style/schema context kept for wrapping (presentation data is bounded). */
export const MAX_SHARED_BLOCK_CHARS = 512 * 1024;
export const MAX_SHARED_TOTAL_CHARS = 4 * 1024 * 1024;

const STYLE_URL_RE = /<styleUrl>\s*#([^<\s]+)\s*<\/styleUrl>/g;

function _normalizeRootTag(rootTag) {
    if (!rootTag) return DEFAULT_ROOT_TAG;
    let tag = rootTag.trim();
    if (tag.endsWith('/>')) tag = `${tag.slice(0, -2)}>`;
    return tag;
}

function _extractStyleRefs(text, into) {
    STYLE_URL_RE.lastIndex = 0;
    let m;
    while ((m = STYLE_URL_RE.exec(text)) != null) {
        into.add(m[1]);
    }
    return into;
}

/**
 * @param {{
 *   DOMParserImpl: typeof DOMParser,
 *   toGeoJsonLib: { kml: (doc: Document) => object },
 *   importMode?: 'gis'|'preserve',
 *   rootTag?: string|null
 * }} deps
 */
export function createKmlBlockConverter(deps) {
    const { DOMParserImpl, toGeoJsonLib } = deps;
    const importMode = deps.importMode ?? 'gis';

    let rootTag = _normalizeRootTag(deps.rootTag ?? null);
    let rootTagSet = deps.rootTag != null;

    /** @type {Map<string, string>} `${kind}#${id}` -> block text */
    const sharedById = new Map();
    /** @type {string[]} schema blocks (included in every batch doc) */
    const schemaBlocks = [];
    let sharedTotal = 0;

    const parseDoc = (docText) => {
        const parser = new DOMParserImpl();
        const doc = parser.parseFromString(docText, 'text/xml');
        const parseError = doc.querySelector?.('parsererror')
            || doc.getElementsByTagName?.('parsererror')?.[0];
        if (parseError) {
            throw new Error(parseError.textContent?.slice(0, 200) || 'Invalid KML');
        }
        return doc;
    };

    const stylesForBlocks = (blocks) => {
        if (importMode === 'gis' || sharedById.size === 0) return '';
        const refs = new Set();
        for (const block of blocks) _extractStyleRefs(block, refs);
        const included = [];
        const push = (id) => {
            const styleMap = sharedById.get(`StyleMap#${id}`);
            const style = sharedById.get(`Style#${id}`);
            if (styleMap) {
                included.push(styleMap);
                // StyleMap pairs reference other shared styles.
                const nested = _extractStyleRefs(styleMap, new Set());
                for (const n of nested) {
                    const ns = sharedById.get(`Style#${n}`);
                    if (ns) included.push(ns);
                }
            }
            if (style) included.push(style);
        };
        for (const id of refs) push(id);
        return included.join('');
    };

    const convertBatch = (blocks) => {
        const docText = `${rootTag}<Document>${schemaBlocks.join('')}${stylesForBlocks(blocks)}${blocks.join('')}</Document></kml>`;
        const doc = parseDoc(docText);
        let fc = toGeoJsonLib.kml(doc);
        if (!fc || !Array.isArray(fc.features)) {
            fc = { type: 'FeatureCollection', features: [] };
        }
        if (importMode === 'gis') {
            fc = stripKmlPresentationFromGeoJSON(fc);
        }
        return fc.features;
    };

    return {
        get importMode() {
            return importMode;
        },

        setRootTag(tag) {
            if (rootTagSet || !tag) return;
            rootTag = _normalizeRootTag(tag);
            rootTagSet = true;
        },

        /**
         * @param {'Style'|'StyleMap'|'Schema'} kind
         * @param {string|null} id
         * @param {string} text
         */
        addShared(kind, id, text) {
            if (text.length > MAX_SHARED_BLOCK_CHARS) return;
            if (sharedTotal + text.length > MAX_SHARED_TOTAL_CHARS) return;
            if (kind === 'Schema') {
                schemaBlocks.push(text);
                sharedTotal += text.length;
                return;
            }
            if (importMode === 'gis') return; // styles are stripped anyway
            if (!id) return; // unreferencable
            const key = `${kind}#${id}`;
            if (sharedById.has(key)) return;
            sharedById.set(key, text);
            sharedTotal += text.length;
        },

        /**
         * Convert a batch of placemark blocks. Falls back to per-block parsing
         * when the batch fails, skipping only broken placemarks.
         * @param {string[]} blocks
         * @returns {{ features: object[], failed: number }}
         */
        convert(blocks) {
            if (!blocks.length) return { features: [], failed: 0 };
            try {
                return { features: convertBatch(blocks), failed: 0 };
            } catch {
                const features = [];
                let failed = 0;
                for (const block of blocks) {
                    try {
                        features.push(...convertBatch([block]));
                    } catch {
                        failed++;
                    }
                }
                return { features, failed };
            }
        }
    };
}

export default { createKmlBlockConverter, MAX_SHARED_BLOCK_CHARS, MAX_SHARED_TOTAL_CHARS };
