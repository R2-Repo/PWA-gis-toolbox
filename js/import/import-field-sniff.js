/**
 * Sniff attribute / column names before full import.
 *
 * GeoJSON long-line files often put multi-MB geometries before properties.
 * A fixed head byte sample (old 384KB) never reaches attribute keys — use a
 * streaming feature pass for geojson/json instead.
 */
import { detectFormat } from './importer.js';
import { loadPapaParse } from '../core/libs.js';
import { loadJSZip } from '../core/libs.js';
import { GeoJSONFeatureStreamParser } from './stream/geojson-stream-parser.js';

/** Head sample for CSV / KML / GPX / zip entry heads. */
export const SAMPLE_BYTES = 1024 * 1024;

/** GeoJSON streaming field sniff — enough features to union sparse schemas. */
export const GEOJSON_FIELD_SNIFF_MAX_FEATURES = 500;

/** Safety stop so one pathological feature cannot hang the sniff forever. */
export const GEOJSON_FIELD_SNIFF_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Extract property keys from a properties object text with nested braces.
 * @param {string} inner
 * @returns {string[]}
 */
export function propertyKeysFromObjectText(inner) {
    const keys = [];
    if (!inner) return keys;
    let i = 0;
    const n = inner.length;
    while (i < n) {
        while (i < n && /\s|,/.test(inner[i])) i++;
        if (i >= n) break;
        if (inner[i] !== '"') {
            // Skip unexpected token
            i++;
            continue;
        }
        i++;
        let key = '';
        while (i < n) {
            if (inner[i] === '\\' && i + 1 < n) {
                key += inner[i + 1];
                i += 2;
                continue;
            }
            if (inner[i] === '"') {
                i++;
                break;
            }
            key += inner[i++];
        }
        while (i < n && /\s/.test(inner[i])) i++;
        if (inner[i] !== ':') continue;
        i++;
        while (i < n && /\s/.test(inner[i])) i++;
        if (key) keys.push(key);
        // Skip value (string / number / object / array / literal).
        if (inner[i] === '"') {
            i++;
            while (i < n) {
                if (inner[i] === '\\' && i + 1 < n) {
                    i += 2;
                    continue;
                }
                if (inner[i] === '"') {
                    i++;
                    break;
                }
                i++;
            }
        } else if (inner[i] === '{' || inner[i] === '[') {
            const open = inner[i];
            const close = open === '{' ? '}' : ']';
            let depth = 0;
            let inStr = false;
            for (; i < n; i++) {
                const ch = inner[i];
                if (inStr) {
                    if (ch === '\\' && i + 1 < n) {
                        i++;
                        continue;
                    }
                    if (ch === '"') inStr = false;
                    continue;
                }
                if (ch === '"') {
                    inStr = true;
                    continue;
                }
                if (ch === open) depth++;
                else if (ch === close) {
                    depth--;
                    if (depth === 0) {
                        i++;
                        break;
                    }
                }
            }
        } else {
            while (i < n && inner[i] !== ',' && inner[i] !== '}') i++;
        }
    }
    return keys;
}

/**
 * Regex / brace-match fallback when streaming sniff is unavailable.
 * @param {string} text
 * @returns {string[]}
 */
export function sniffPropertyKeysFromGeoJsonText(text) {
    const keys = new Set();
    let searchFrom = 0;
    const marker = '"properties"';
    let blocks = 0;
    while (blocks < 200 && searchFrom < text.length && keys.size < 500) {
        const idx = text.indexOf(marker, searchFrom);
        if (idx < 0) break;
        let i = idx + marker.length;
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] !== ':') {
            searchFrom = idx + marker.length;
            continue;
        }
        i++;
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] !== '{') {
            searchFrom = idx + marker.length;
            continue;
        }
        const start = i + 1;
        let depth = 0;
        let inStr = false;
        for (; i < text.length; i++) {
            const ch = text[i];
            if (inStr) {
                if (ch === '\\' && i + 1 < text.length) {
                    i++;
                    continue;
                }
                if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') {
                inStr = true;
                continue;
            }
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    i++;
                    break;
                }
            }
        }
        const inner = text.slice(start, i - 1);
        for (const key of propertyKeysFromObjectText(inner)) {
            keys.add(key);
            if (keys.size >= 500) break;
        }
        blocks++;
        searchFrom = i;
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * Stream GeoJSON features and union property keys (ignores geometry size).
 * @param {File} file
 * @param {{ maxFeatures?: number, maxBytes?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function sniffGeoJsonFieldsStreaming(file, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? GEOJSON_FIELD_SNIFF_MAX_FEATURES;
    const maxBytes = opts.maxBytes ?? GEOJSON_FIELD_SNIFF_MAX_BYTES;
    const keys = new Set();
    let featuresSeen = 0;
    let bytesProcessed = 0;
    let stop = false;

    const parser = new GeoJSONFeatureStreamParser({
        onFeature: (feature) => {
            if (stop) return;
            featuresSeen++;
            const props = feature?.properties;
            if (props && typeof props === 'object') {
                for (const key of Object.keys(props)) {
                    if (key) keys.add(key);
                }
            }
            if (featuresSeen >= maxFeatures || keys.size >= 500) stop = true;
        }
    });

    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    try {
        while (!stop) {
            const { done, value } = await reader.read();
            if (done) {
                try {
                    parser.push(decoder.decode());
                    parser.finish();
                } catch { /* truncated / non-FC — keep keys found so far */ }
                break;
            }
            bytesProcessed += value.byteLength;
            parser.push(decoder.decode(value, { stream: true }));
            if (bytesProcessed >= maxBytes) break;
        }
    } finally {
        try {
            await reader.cancel();
        } catch { /* ignore */ }
    }

    if (keys.size) return [...keys].sort((a, b) => a.localeCompare(b));
    // Fallback: head text brace-match if stream found nothing (odd payloads).
    try {
        const head = await file.slice(0, Math.min(file.size, SAMPLE_BYTES)).text();
        return sniffPropertyKeysFromGeoJsonText(head);
    } catch {
        return [];
    }
}

/**
 * @param {string} head
 * @returns {string[]}
 */
export function sniffGpxFieldNames(head) {
    const keys = new Set(['name', 'desc', 'time', 'cmt', 'sym', 'type']);
    for (const tag of ['name', 'desc', 'time', 'cmt', 'sym', 'type']) {
        if (new RegExp(`<${tag}[\\s/>]`, 'i').test(head)) keys.add(tag);
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} head
 * @returns {string[]}
 */
export function sniffKmlFieldNames(head) {
    const keys = new Set();
    for (const m of head.matchAll(/<(?:SimpleData|Data)\s+name="([^"]+)"/gi)) {
        keys.add(m[1]);
    }
    for (const m of head.matchAll(/<ExtendedData>[\s\S]*?<\/ExtendedData>/gi)) {
        for (const sm of m[0].matchAll(/name="([^"]+)"/gi)) {
            keys.add(sm[1]);
        }
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} head
 * @returns {Promise<string[]>}
 */
export async function sniffCsvFieldNames(head) {
    const line = head.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
    if (!line) return [];
    try {
        const papa = await loadPapaParse();
        if (papa?.parse) {
            const parsed = papa.parse(`${line}\n`, { header: true, preview: 1 });
            if (parsed.meta?.fields?.length) return parsed.meta.fields;
        }
    } catch {
        /* fall through */
    }
    return line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

/**
 * @param {File} file
 * @returns {Promise<string[]>}
 */
export async function sniffFieldsFromFile(file) {
    const format = detectFormat(file);
    if (!format) return [];

    if (format === 'zip' || format === 'kmz') {
        // Preferred: central-directory + streamed head — works for archives of
        // any size without extracting the whole zip.
        try {
            const { readZipEntries, chooseMainKmlZipEntry, readZipEntryHead, openZipEntryStream, isRealZipEntry } =
                await import('./stream/zip-central-directory.js');
            const entries = await readZipEntries(file);

            // Zipped shapefile — field names come from the .dbf header.
            const dbfEntry = entries.find(
                (e) => isRealZipEntry(e) && e.name.toLowerCase().endsWith('.dbf')
            );
            const hasShp = entries.some(
                (e) => isRealZipEntry(e) && e.name.toLowerCase().endsWith('.shp')
            );
            if (hasShp && dbfEntry) {
                const { createByteReader } = await import('./stream/byte-reader.js');
                const { readDbfHeader } = await import('./stream/dbf-stream-parser.js');
                const reader = createByteReader(await openZipEntryStream(file, dbfEntry));
                try {
                    const header = await readDbfHeader(reader);
                    const names = header.fields.map((f) => f.name).filter(Boolean);
                    if (names.length) return names.sort((a, b) => a.localeCompare(b));
                } finally {
                    await reader.cancel();
                }
            }

            const main = chooseMainKmlZipEntry(entries);
            if (main) {
                const head = await readZipEntryHead(file, main.entry, SAMPLE_BYTES);
                const kmlFields = sniffKmlFieldNames(head);
                if (kmlFields.length) return kmlFields;
            }
        } catch {
            /* fall back to JSZip head sniff below */
        }
        try {
            const buffer = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
            const JSZipLib = await loadJSZip();
            if (!JSZipLib?.loadAsync) return [];
            const zip = await JSZipLib.loadAsync(buffer);
            let kmlEntry = null;
            zip.forEach((path, entry) => {
                if (!entry.dir && path.toLowerCase().endsWith('.kml') && !kmlEntry) {
                    kmlEntry = entry;
                }
            });
            if (kmlEntry) {
                const text = await kmlEntry.async('string');
                const kmlFields = sniffKmlFieldNames(text.slice(0, SAMPLE_BYTES));
                if (kmlFields.length) return kmlFields;
            }
        } catch {
            return [];
        }
        return [];
    }

    if (format === 'geojson' || format === 'json') {
        try {
            return await sniffGeoJsonFieldsStreaming(file);
        } catch {
            try {
                const head = await file.slice(0, Math.min(file.size, SAMPLE_BYTES)).text();
                return sniffPropertyKeysFromGeoJsonText(head);
            } catch {
                return [];
            }
        }
    }

    if (['csv', 'tsv', 'txt', 'kml', 'gpx', 'xml'].includes(format)) {
        let head;
        try {
            head = await file.slice(0, Math.min(file.size, SAMPLE_BYTES)).text();
        } catch {
            return [];
        }

        if (format === 'csv' || format === 'tsv' || format === 'txt') {
            return sniffCsvFieldNames(head);
        }
        if (format === 'kml' || format === 'xml') {
            const kml = sniffKmlFieldNames(head);
            if (kml.length) return kml;
        }
        if (format === 'gpx') {
            return sniffGpxFieldNames(head);
        }
    }

    if (format === 'xlsx' || format === 'xls') {
        try {
            const { loadXLSX } = await import('../core/libs.js');
            const XLSX = await loadXLSX();
            if (!XLSX?.read) return [];
            const buffer = await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array', sheetRows: 2 });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            if (!sheet) return [];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const header = rows[0];
            if (Array.isArray(header)) {
                return header.map(String).filter(Boolean);
            }
        } catch {
            return [];
        }
    }

    return [];
}

export default {
    sniffFieldsFromFile,
    sniffGeoJsonFieldsStreaming,
    sniffPropertyKeysFromGeoJsonText,
    propertyKeysFromObjectText,
    sniffKmlFieldNames,
    sniffGpxFieldNames,
    sniffCsvFieldNames,
    SAMPLE_BYTES,
    GEOJSON_FIELD_SNIFF_MAX_FEATURES,
    GEOJSON_FIELD_SNIFF_MAX_BYTES
};
