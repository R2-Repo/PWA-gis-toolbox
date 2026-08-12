import { UGRC_REVERSE_MILEPOST_DEFAULTS } from './config.js';
import {
    formatRouteMilepostLabel,
    formatRouteMilepostMessage,
    reverseMilepost
} from './client.js';
import { hasResolvedUgrcApiKey, resolveUgrcApiKey } from './keys.js';

/**
 * @param {number} [bufferMeters]
 * @returns {string}
 */
export function noStateRouteMessage(bufferMeters = UGRC_REVERSE_MILEPOST_DEFAULTS.buffer) {
    return `No UDOT state route within ${bufferMeters} m. This lookup only works near Utah state routes and interstates, not local streets.`;
}

/**
 * Run reverse milepost lookup and report via toast / clipboard / settings callback.
 *
 * @param {{ lat: number, lng: number }} latlng
 * @param {{
 *   showToast?: (message: string, type?: string) => void,
 *   openSettings?: () => void|Promise<void>,
 *   copyText?: (text: string) => Promise<void>,
 *   requireUserKey?: boolean
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
        // Optional personal-key dialog when a host provides openSettings; otherwise toast.
        if (typeof deps.openSettings === 'function') {
            showToast('UGRC API key required. Paste your personal key to continue.', 'warning');
            await deps.openSettings();
        } else {
            showToast(
                'UGRC is not configured for this build. Set VITE_UGRC_API_KEY in Cloudflare Pages env vars and redeploy.',
                'warning'
            );
        }
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
        if (typeof deps.openSettings === 'function') {
            showToast('UGRC API key was rejected. Check the key in Settings.', 'error');
            await deps.openSettings();
        } else {
            showToast(
                'UGRC API key was rejected. Check Cloudflare env VITE_UGRC_API_KEY and browser-key referrer patterns, then redeploy.',
                'error'
            );
        }
        return 'error';
    }

    const detail = outcome.error?.message || 'UGRC lookup failed';
    showToast(detail, 'error');
    return 'error';
}
