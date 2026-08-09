/**
 * Distinct-value accumulator for pre-import attribute scans.
 * Pure module — worker/test safe.
 */
import { IMPORT_VALUE_SCAN_CAP } from './import-feature-filter.js';

/**
 * @param {number} [cap]
 */
export function createValueAccumulator(cap = IMPORT_VALUE_SCAN_CAP) {
    /** @type {Map<string, { set: Set<string>, truncated: boolean, uniqueCount: number }>} */
    const fields = new Map();
    let rows = 0;

    const ensure = (name) => {
        let entry = fields.get(name);
        if (!entry) {
            entry = { set: new Set(), truncated: false, uniqueCount: 0 };
            fields.set(name, entry);
        }
        return entry;
    };

    return {
        get rowCount() {
            return rows;
        },

        /**
         * @param {Record<string, unknown>|null|undefined} props
         * @param {string[]|null} [fieldNames] when set, only these keys are tracked
         */
        addProperties(props, fieldNames = null) {
            rows += 1;
            if (!props || typeof props !== 'object') return;
            const keys = fieldNames?.length ? fieldNames : Object.keys(props);
            for (const name of keys) {
                if (!Object.prototype.hasOwnProperty.call(props, name)) continue;
                const entry = ensure(name);
                const raw = props[name];
                if (raw == null || raw === '') continue;
                const text = typeof raw === 'string' ? raw : String(raw);
                if (entry.set.has(text)) continue;
                if (entry.set.size >= cap) {
                    entry.truncated = true;
                    continue;
                }
                entry.set.add(text);
            }
        },

        /**
         * Ensure field slots exist even when never seen in rows (from sniff list).
         * @param {string[]} fieldNames
         */
        ensureFields(fieldNames) {
            for (const name of fieldNames || []) {
                if (name) ensure(name);
            }
        },

        /**
         * @returns {{ fields: Array<{ name: string, values: string[], truncated: boolean, uniqueCount: number }>, rowCount: number }}
         */
        build() {
            const out = [];
            for (const [name, entry] of fields) {
                const values = [...entry.set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                out.push({
                    name,
                    values,
                    truncated: entry.truncated,
                    uniqueCount: entry.truncated ? Math.max(values.length, entry.set.size) : values.length
                });
            }
            out.sort((a, b) => a.name.localeCompare(b.name));
            return { fields: out, rowCount: rows };
        }
    };
}

/**
 * Pull ExtendedData / name / description from a KML Placemark XML block.
 * Best-effort; does not build a DOM.
 * @param {string} blockText
 * @returns {Record<string, string>}
 */
export function extractKmlPlacemarkProperties(blockText) {
    const props = {};
    if (!blockText) return props;

    const nameMatch = blockText.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
    if (nameMatch) props.name = _stripXml(nameMatch[1]);

    const descMatch = blockText.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    if (descMatch) props.description = _stripXml(descMatch[1]);

    for (const m of blockText.matchAll(/<(?:SimpleData|Data)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:SimpleData|Data)>/gi)) {
        props[m[1]] = _stripXml(m[2]);
    }
    for (const m of blockText.matchAll(/<Data\s+name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/gi)) {
        props[m[1]] = _stripXml(m[2]);
    }
    return props;
}

function _stripXml(text) {
    return String(text || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}
