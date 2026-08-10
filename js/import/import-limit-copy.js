/**
 * Shared Gate A / Gate B import limit copy — keep Flow, Optimizer, and gauge aligned.
 * Product max that lands in the app: STORED_FEATURE_LIMIT (250k features).
 */
import { formatBytes } from './import-preflight.js';
import { STORED_FEATURE_LIMIT, STORED_SIZE_GUIDANCE_BYTES } from './import-admission.js';

export function largeFileBannerText({
    fileName = null,
    fileCount = 1,
    sourceBytes = 0,
    featureEstimate = null
} = {}) {
    const sizeBit = sourceBytes > 0 ? ` (${formatBytes(sourceBytes)})` : '';
    const featBit = featureEstimate != null && Number.isFinite(featureEstimate)
        ? ` Roughly ${featureEstimate.toLocaleString()} features in the source.`
        : '';
    const who = fileCount > 1
        ? `${fileCount} files are too large for a simple import${sizeBit ? '' : ''}.`
        : `"${fileName || 'This file'}" is too large for a simple import${sizeBit}.`;
    return `${who}${featBit} Choose what to keep — you can store up to ${STORED_FEATURE_LIMIT.toLocaleString()} features on the map. Attributes, filters, and an import fence only help if they bring the stored count under that limit.`;
}

export function kmlGisModeNote(hasKml = false) {
    return hasKml
        ? ' KML/KMZ imports as a simplified GIS layer (presentation content is not kept).'
        : '';
}

export function describeImportBlockReason({
    readyToImport = false,
    waitingOnRecount = false,
    estimateState = 'idle',
    estimatedFeatures = null,
    limitFeatures = STORED_FEATURE_LIMIT,
    estimateMessage = null
} = {}) {
    if (readyToImport) return null;
    if (waitingOnRecount || estimateState === 'scanning') {
        return 'Updating estimate…';
    }
    if (estimateState === 'error' || estimateState === 'unsupported') {
        return estimateMessage || 'Estimate unavailable — adjust filters or try again.';
    }
    if (estimatedFeatures != null && Number.isFinite(estimatedFeatures) && estimatedFeatures > limitFeatures) {
        return `Still ~${estimatedFeatures.toLocaleString()} features — filter or fence until ≤ ${limitFeatures.toLocaleString()}.`;
    }
    if (estimatedFeatures == null) {
        return `Need a feature estimate under ${limitFeatures.toLocaleString()} before import.`;
    }
    return `Import unlocks at ≤ ${limitFeatures.toLocaleString()} stored features.`;
}

export function gateASizeGuidanceLabel() {
    return formatBytes(STORED_SIZE_GUIDANCE_BYTES);
}

export { STORED_FEATURE_LIMIT, STORED_SIZE_GUIDANCE_BYTES };
