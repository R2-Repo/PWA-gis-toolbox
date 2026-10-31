/**
 * Shared ZIP path helpers for KMZ import and in-archive link resolution.
 */
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { formatBytes } from './import-preflight.js';
import { LIMITS } from './import-limits.js';

/** Max total uncompressed bytes inside ZIP/KMZ before parse (HANDOFF). */
export const MAX_ZIP_UNCOMPRESSED_BYTES = LIMITS.maxZipUncompressedBytes;

export function normalizeZipPath(p) {
    return p.replace(/\\/g, '/');
}

export function dirnameInZip(p) {
    const n = normalizeZipPath(p);
    const i = n.lastIndexOf('/');
    return i <= 0 ? '' : n.slice(0, i + 1);
}

export function resolveZipInternalHref(mainKmlPath, href) {
    const h = href.trim();
    if (!h || /^(https?:|data:|blob:|\/\/)/i.test(h) || h.startsWith('#')) return null;
    const dir = dirnameInZip(mainKmlPath);
    const combined = dir + h.replace(/^\.\//, '');
    const parts = combined.split('/').filter(Boolean);
    const stack = [];
    for (const part of parts) {
        if (part === '..') stack.pop();
        else if (part !== '.') stack.push(part);
    }
    return stack.join('/');
}

/**
 * Read a .kml file from a KMZ zip by relative href (one hop, same archive).
 * @param {import('jszip')} zip
 * @param {string} mainKmlPath
 * @param {string} href
 */
export async function readKmlFromKmzZip(zip, mainKmlPath, href) {
    const resolved = resolveZipInternalHref(mainKmlPath, href);
    if (!resolved || !resolved.toLowerCase().endsWith('.kml')) return null;

    const pathMap = new Map();
    zip.forEach((relPath, entry) => {
        if (!entry.dir) pathMap.set(normalizeZipPath(relPath).toLowerCase(), entry);
    });

    const entry = pathMap.get(resolved.toLowerCase());
    if (!entry) return null;
    return entry.async('string');
}

/**
 * @param {import('jszip')} zip
 * @param {string} mainKmlPath
 */
export function createKmzLinkResolver(zip, mainKmlPath) {
    return (href) => readKmlFromKmzZip(zip, mainKmlPath, href);
}

/**
 * Sum declared uncompressed sizes from a loaded JSZip instance.
 * @param {import('jszip')} zip
 * @returns {number}
 */
export function sumZipUncompressedBytes(zip) {
    if (!zip?.forEach) return 0;
    let total = 0;
    zip.forEach((_path, entry) => {
        if (entry.dir) return;
        total += entry._data?.uncompressedSize ?? 0;
    });
    return total;
}

/**
 * Load ZIP from buffer and sum uncompressed entry sizes.
 * @param {ArrayBuffer} buffer
 * @param {object} JSZipLib
 * @returns {Promise<number>}
 */
export async function measureZipUncompressedBytes(buffer, JSZipLib) {
    if (!JSZipLib?.loadAsync) return 0;
    let zip;
    try {
        zip = await JSZipLib.loadAsync(buffer);
    } catch {
        return 0;
    }
    return sumZipUncompressedBytes(zip);
}

/**
 * @param {number} totalBytes
 * @param {string} fileName
 */
export function assertZipUncompressedBudget(totalBytes, fileName) {
    if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new AppError(
            `"${fileName}" would expand to ${formatBytes(totalBytes)} uncompressed (limit ${formatBytes(MAX_ZIP_UNCOMPRESSED_BYTES)}). Split or simplify the archive before importing.`,
            ErrorCategory.OUT_OF_MEMORY,
            { fileName, uncompressedBytes: totalBytes, limit: MAX_ZIP_UNCOMPRESSED_BYTES }
        );
    }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {object} JSZipLib
 * @param {string} fileName
 */
export async function assertZipBufferWithinBudget(buffer, JSZipLib, fileName) {
    const total = await measureZipUncompressedBytes(buffer, JSZipLib);
    assertZipUncompressedBudget(total, fileName);
    return total;
}
