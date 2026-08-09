/**
 * Streaming import policy — decides which files use the high-capacity streaming
 * path (worker parse → IndexedDB workspace) instead of the standard in-memory path.
 *
 * Streaming applies only to files the standard pipeline would REJECT on size,
 * so every existing import path keeps its current behavior.
 */
import { detectFormat } from '../importer.js';
import { preflightFile, PREFLIGHT_LEVEL, formatBytes, TEXT_STRONG_BYTES } from '../import-preflight.js';
import {
    STREAM_MAX_BYTES,
    STREAM_MAX_FEATURES,
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES
} from './stream-constants.js';
import {
    readZipEntries,
    chooseMainKmlZipEntry,
    supportsZipStreaming
} from './zip-central-directory.js';

/** Formats that can be parsed incrementally without whole-file decode. */
export const STREAM_FORMATS = new Set(['geojson', 'json', 'csv', 'kml', 'xml', 'kmz', 'zip']);

export { STREAM_MAX_BYTES, STREAM_MAX_FEATURES, STREAM_BATCH_FEATURES, STREAM_BATCH_MAX_BYTES };

const JSON_SNIFF_BYTES = 64 * 1024;
const XML_SNIFF_BYTES = 12 * 1024;

/**
 * Sniff whether a .json file is a GeoJSON FeatureCollection (streamable).
 * @param {File} file
 * @returns {Promise<boolean>}
 */
export async function sniffJsonIsFeatureCollection(file) {
    try {
        const head = await file.slice(0, Math.min(file.size, JSON_SNIFF_BYTES)).text();
        return /"type"\s*:\s*"FeatureCollection"/.test(head);
    } catch {
        return false;
    }
}

/**
 * Sniff whether a .xml file is KML (mirrors importer's XML-as-KML check).
 * @param {File} file
 * @returns {Promise<boolean>}
 */
export async function sniffXmlIsKml(file) {
    try {
        const head = (await file.slice(0, Math.min(file.size, XML_SNIFF_BYTES)).text()).trim();
        return /<kml[\s/>]/i.test(head)
            || /http:\/\/www\.opengis\.net\/kml\/2\.[0-3]/i.test(head)
            || /urn:googleearth:documentation:/i.test(head);
    } catch {
        return false;
    }
}

/** Uncompressed main-KML size above which an archive must stream. */
const ARCHIVE_LARGE_ENTRY_BYTES = TEXT_STRONG_BYTES;

/**
 * Inspect an archive's central directory for a streamable main KML entry.
 * Never extracts the archive; embedded images/icons are ignored entirely.
 * @param {File} file
 * @param {{ requireLargeEntry?: boolean }} [opts] when true, only stream if the
 *   main KML expands beyond the standard text cap (archive itself passed preflight)
 * @returns {Promise<{ stream: boolean, reject: boolean, message?: string }>}
 */
async function _assessArchiveStreamEligibility(file, opts = {}) {
    let entries;
    try {
        entries = await readZipEntries(file);
    } catch {
        // Unreadable/ZIP64 — let the standard guard produce its size message.
        return { stream: false, reject: false };
    }

    const hasShapefile = entries.some((e) => !e.isDir && e.name.toLowerCase().endsWith('.shp'));
    if (hasShapefile) {
        // Zipped shapefiles keep the standard path (streaming SHP is planned).
        return { stream: false, reject: false };
    }

    const main = chooseMainKmlZipEntry(entries);
    if (!main) {
        return { stream: false, reject: false };
    }
    if (main.entry.method !== 0 && !supportsZipStreaming()) {
        return { stream: false, reject: false };
    }
    if ((main.entry.uncompressedSize || 0) > STREAM_MAX_BYTES) {
        return {
            stream: false,
            reject: true,
            message: `"${file.name}" expands to ${formatBytes(main.entry.uncompressedSize)} of KML — exceeds the ${formatBytes(STREAM_MAX_BYTES)} high-capacity import limit. Split the file externally before importing.`
        };
    }
    if (opts.requireLargeEntry && (main.entry.uncompressedSize || 0) < ARCHIVE_LARGE_ENTRY_BYTES) {
        return { stream: false, reject: false };
    }
    return { stream: true, reject: false };
}

/**
 * @param {File} file
 * @param {string|null} [format]
 * @returns {Promise<{ stream: boolean, reject: boolean, message?: string }>}
 */
export async function assessStreamEligibility(file, format = null) {
    const fmt = format ?? detectFormat(file);
    if (!fmt || !STREAM_FORMATS.has(fmt)) {
        return { stream: false, reject: false };
    }

    const sizeBytes = file.size ?? 0;
    const check = preflightFile(file, { format: fmt });

    if (fmt === 'kmz' || fmt === 'zip') {
        if (sizeBytes > STREAM_MAX_BYTES) {
            return {
                stream: false,
                reject: true,
                message: `"${file.name}" is ${formatBytes(sizeBytes)} — exceeds the ${formatBytes(STREAM_MAX_BYTES)} high-capacity import limit. Split the file externally before importing.`
            };
        }
        const overCap = check.level === PREFLIGHT_LEVEL.REJECT;
        // Even small archives can hide a huge KML (repetitive XML compresses
        // 20–1000×) — the central directory is one cheap tail read, so always
        // inspect and stream whenever the main entry expands past the text cap.
        return _assessArchiveStreamEligibility(file, { requireLargeEntry: !overCap });
    }

    if (check.level !== PREFLIGHT_LEVEL.REJECT) {
        // Under the standard caps — existing pipeline handles it.
        return { stream: false, reject: false };
    }

    if (sizeBytes > STREAM_MAX_BYTES) {
        return {
            stream: false,
            reject: true,
            message: `"${file.name}" is ${formatBytes(file.size)} — exceeds the ${formatBytes(STREAM_MAX_BYTES)} high-capacity import limit. Split the file externally before importing.`
        };
    }

    if (fmt === 'json') {
        const isFc = await sniffJsonIsFeatureCollection(file);
        if (!isFc) {
            // Non-GeoJSON JSON at this size cannot be imported — let the standard
            // guard produce its usual size-reject message.
            return { stream: false, reject: false };
        }
    }

    if (fmt === 'xml') {
        const isKml = await sniffXmlIsKml(file);
        if (!isKml) {
            return { stream: false, reject: false };
        }
    }

    return { stream: true, reject: false };
}

/**
 * Split files into streaming-eligible, standard-pipeline, and rejected buckets.
 * @param {File[]} files
 * @returns {Promise<{ streamFiles: File[], standardFiles: File[], rejectedFiles: Array<{ file: File, message: string }> }>}
 */
export async function partitionStreamingFiles(files) {
    const streamFiles = [];
    const standardFiles = [];
    const rejectedFiles = [];

    for (const file of files || []) {
        const eligibility = await assessStreamEligibility(file);
        if (eligibility.stream) {
            streamFiles.push(file);
        } else if (eligibility.reject) {
            rejectedFiles.push({ file, message: eligibility.message });
        } else {
            standardFiles.push(file);
        }
    }

    return { streamFiles, standardFiles, rejectedFiles };
}

export default {
    STREAM_FORMATS,
    STREAM_MAX_BYTES,
    STREAM_MAX_FEATURES,
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES,
    sniffJsonIsFeatureCollection,
    sniffXmlIsKml,
    assessStreamEligibility,
    partitionStreamingFiles
};
