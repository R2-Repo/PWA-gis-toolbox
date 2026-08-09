/**
 * Sniff attribute / column names before full import.
 */
import { detectFormat } from './importer.js';
import { loadPapaParse } from '../core/libs.js';
import { loadJSZip } from '../core/libs.js';

const SAMPLE_BYTES = 384 * 1024;

/**
 * @param {string} text
 * @returns {string[]}
 */
export function sniffPropertyKeysFromGeoJsonText(text) {
    const keys = new Set();
    const propBlocks = text.matchAll(/"properties"\s*:\s*\{([^}]*)\}/g);
    let count = 0;
    for (const match of propBlocks) {
        if (count++ > 50) break;
        const inner = match[1] || '';
        for (const km of inner.matchAll(/"([^"\\]+)"\s*:/g)) {
            keys.add(km[1]);
            if (keys.size >= 500) break;
        }
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
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

    if (['geojson', 'json', 'csv', 'tsv', 'txt', 'kml', 'gpx', 'xml'].includes(format)) {
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
        if (format === 'geojson' || format === 'json') {
            try {
                const data = JSON.parse(head);
                if (data.type === 'FeatureCollection' && data.features?.[0]?.properties) {
                    return Object.keys(data.features[0].properties).sort();
                }
                if (data.type === 'Feature' && data.properties) {
                    return Object.keys(data.properties).sort();
                }
                if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
                    return Object.keys(data[0]).sort();
                }
            } catch {
                /* truncated JSON */
            }
            return sniffPropertyKeysFromGeoJsonText(head);
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
    sniffPropertyKeysFromGeoJsonText,
    sniffKmlFieldNames,
    sniffGpxFieldNames,
    sniffCsvFieldNames
};
