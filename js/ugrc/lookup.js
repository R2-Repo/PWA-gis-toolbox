import { UGRC_REVERSE_MILEPOST_DEFAULTS } from './config.js';
import {
    formatRouteMilepostLabel,
    formatRouteMilepostMessage,
    reverseMilepost
} from './client.js';
import { hasResolvedUgrcApiKey, resolveUgrcApiKey } from './keys.js';

const LOOKUP_UNAVAILABLE = 'Route & milepost lookup is unavailable.';
const LOOKUP_FAILED = 'Route & milepost lookup failed.';

/**
 * @param {number} [bufferMeters]
 * @returns {string}
 */
export function noStateRouteMessage(bufferMeters = UGRC_REVERSE_MILEPOST_DEFAULTS.buffer) {
    return `No UDOT state route within ${bufferMeters} m. This lookup only works near Utah state routes and interstates, not local streets.`;
}

/**
 * Run reverse milepost lookup and report via toast / clipboard.
 *
 * @param {{ lat: number, lng: number }} latlng
 * @param {{
 *   showToast?: (message: string, type?: string) => void,
 *   copyText?: (text: string) => Promise<void>
 * }} [deps]
 * @returns {Promise<'success'|'no_match'|'missing_key'|'error'>}
 */
export async function runReverseMilepostLookup(latlng, deps = {}) {
    const showToast = deps.showToast || (() => {});
    const copyText = deps.copyText || ((text) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return Promise.reject(new Error('clipboard unavailable'));
    });

    if (!hasResolvedUgrcApiKey()) {
        showToast(LOOKUP_UNAVAILABLE, 'warning');
        return 'missing_key';
    }

    const apiKey = resolveUgrcApiKey();
    showToast('Looking up route & milepost…', 'info');

    const outcome = await reverseMilepost({
        lat: latlng.lat,
        lng: latlng.lng,
        apiKey,
        buffer: UGRC_REVERSE_MILEPOST_DEFAULTS.buffer,
        spatialReference: UGRC_REVERSE_MILEPOST_DEFAULTS.spatialReference,
        includeRampSystem: UGRC_REVERSE_MILEPOST_DEFAULTS.includeRampSystem,
        suggest: UGRC_REVERSE_MILEPOST_DEFAULTS.suggest
    });

    if (outcome.ok) {
        const label = formatRouteMilepostLabel(outcome.result);
        const message = formatRouteMilepostMessage(outcome.result);
        try {
            await copyText(label);
            showToast(message, 'success');
        } catch {
            showToast(message, 'info');
        }
        return 'success';
    }

    if (outcome.reason === 'no_match') {
        showToast(noStateRouteMessage(), 'warning');
        return 'no_match';
    }

    if (outcome.reason === 'http' && (outcome.status === 401 || outcome.status === 403)) {
        showToast(LOOKUP_FAILED, 'error');
        return 'error';
    }

    const detail = outcome.error?.message || LOOKUP_FAILED;
    showToast(detail, 'error');
    return 'error';
}
