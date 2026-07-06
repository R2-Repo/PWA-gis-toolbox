import { isPresentationMode } from '../presentation/presentation-mode-detector.js';
import { parseAppUrl, hasRecognizedAppUrlConfig } from './app-url-parser.js';

/** @type {import('./app-url-schema.js').AppUrlConfig | null | undefined} */
let cachedConfig = undefined;
/** @type {boolean | undefined} */
let cachedHasConfig = undefined;

function resetCache() {
    cachedConfig = undefined;
    cachedHasConfig = undefined;
}

/**
 * @returns {import('./app-url-schema.js').AppUrlConfig}
 */
export function getAppUrlConfig() {
    if (cachedConfig !== undefined) return cachedConfig;
    if (isPresentationMode()) {
        cachedConfig = {};
        cachedHasConfig = false;
        return cachedConfig;
    }
    cachedConfig = parseAppUrl();
    cachedHasConfig = hasRecognizedAppUrlConfig(cachedConfig);
    return cachedConfig;
}

export function hasAppUrlConfig() {
    if (cachedHasConfig !== undefined) return cachedHasConfig;
    getAppUrlConfig();
    return !!cachedHasConfig;
}

export function shouldSkipSessionRestore() {
    return hasAppUrlConfig();
}

/** @visibleForTesting */
export function _resetAppUrlDetectorCache() {
    resetCache();
}
