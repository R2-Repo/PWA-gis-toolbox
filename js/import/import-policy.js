/** Browser import policy. */
import {
    TEXT_STRONG_BYTES,
    BINARY_STRONG_BYTES,
    getPreflightLimits
} from './import-preflight.js';

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
 * Normalize files for openImportForFiles / handleFileImport.
 * @param {File[]} files
 * @returns {{ memoryFiles: File[] }}
 */
export function classifyImportFiles(files) {
    return {
        memoryFiles: Array.from(files || [])
    };
}

export {
    TEXT_STRONG_BYTES,
    BINARY_STRONG_BYTES
};
