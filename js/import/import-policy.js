/**
 * Platform-aware import policy — PWA keeps browser caps; desktop can path-route large files.
 */
import { hasCapability } from '../platform/contracts.js';
import {
    TEXT_STRONG_BYTES,
    BINARY_STRONG_BYTES,
    getPreflightLimits
} from './import-preflight.js';

/**
 * Absolute path on disk when available (Tauri drag-drop / native File).
 * @param {File|object} file
 * @returns {string|null}
 */
export function getNativeFilePath(file) {
    if (!file || typeof file !== 'object') return null;
    if (typeof file.path === 'string' && file.path.trim()) return file.path.trim();
    if (typeof file.__tauri_path === 'string' && file.__tauri_path.trim()) {
        return file.__tauri_path.trim();
    }
    return null;
}

/**
 * Desktop can use sidecar path import when native files + large-dataset processing are available.
 * @param {import('../platform/contracts.js').PlatformInfo|null|undefined} platform
 * @returns {boolean}
 */
export function canUseDesktopPathImport(platform) {
    if (!platform || platform.runtime !== 'windows') return false;
    return (
        hasCapability(platform, 'nativeFiles') &&
        hasCapability(platform, 'largeDatasetProcessing')
    );
}

/**
 * @param {File} file
 * @param {{ format?: string|null }} [options]
 * @returns {boolean}
 */
export function exceedsBrowserImportStrongLimit(file, options = {}) {
    const sizeBytes = file?.size ?? 0;
    const { strong } = getPreflightLimits(options.format);
    return sizeBytes >= strong;
}

/**
 * True when this file should be ingested via desktop path + sidecar (not full JS File read).
 * @param {File} file
 * @param {import('../platform/contracts.js').PlatformInfo|null|undefined} platform
 * @param {{ format?: string|null }} [options]
 * @returns {boolean}
 */
export function shouldRouteFileViaDesktopPath(file, platform, options = {}) {
    if (!canUseDesktopPathImport(platform)) return false;
    if (!exceedsBrowserImportStrongLimit(file, options)) return false;
    return Boolean(getNativeFilePath(file));
}

/**
 * Partition files for openImportForFiles.
 * @param {File[]} files
 * @param {import('../platform/contracts.js').PlatformInfo|null|undefined} platform
 * @returns {{
 *   memoryFiles: File[],
 *   pathFiles: Array<{ file: File, path: string }>,
 *   blockedLargeNoPath: File[]
 * }}
 */
export function classifyImportFiles(files, platform) {
    const memoryFiles = [];
    const pathFiles = [];
    const blockedLargeNoPath = [];
    const desktopPath = canUseDesktopPathImport(platform);

    for (const file of files || []) {
        if (!desktopPath || !exceedsBrowserImportStrongLimit(file)) {
            memoryFiles.push(file);
            continue;
        }
        const path = getNativeFilePath(file);
        if (path) {
            pathFiles.push({ file, path });
        } else {
            blockedLargeNoPath.push(file);
        }
    }

    return { memoryFiles, pathFiles, blockedLargeNoPath };
}

export {
    TEXT_STRONG_BYTES,
    BINARY_STRONG_BYTES
};
