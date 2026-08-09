/**
 * Streaming import policy — decides which files use the high-capacity streaming
 * path (worker parse → IndexedDB workspace) instead of the standard in-memory path.
 *
 * Streaming applies only to files the standard pipeline would REJECT on size,
 * so every existing import path keeps its current behavior.
 */
import { detectFormat } from '../importer.js';
import { preflightFile, PREFLIGHT_LEVEL, formatBytes } from '../import-preflight.js';
import {
    STREAM_MAX_BYTES,
    STREAM_MAX_FEATURES,
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES
} from './stream-constants.js';

/** Formats that can be parsed incrementally without whole-file decode. */
export const STREAM_FORMATS = new Set(['geojson', 'json', 'csv']);

export { STREAM_MAX_BYTES, STREAM_MAX_FEATURES, STREAM_BATCH_FEATURES, STREAM_BATCH_MAX_BYTES };

const JSON_SNIFF_BYTES = 64 * 1024;

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
 * @param {File} file
 * @param {string|null} [format]
 * @returns {Promise<{ stream: boolean, reject: boolean, message?: string }>}
 */
export async function assessStreamEligibility(file, format = null) {
    const fmt = format ?? detectFormat(file);
    if (!fmt || !STREAM_FORMATS.has(fmt)) {
        return { stream: false, reject: false };
    }

    const check = preflightFile(file, { format: fmt });
    if (check.level !== PREFLIGHT_LEVEL.REJECT) {
        // Under the standard caps — existing pipeline handles it.
        return { stream: false, reject: false };
    }

    if ((file.size ?? 0) > STREAM_MAX_BYTES) {
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
    assessStreamEligibility,
    partitionStreamingFiles
};
