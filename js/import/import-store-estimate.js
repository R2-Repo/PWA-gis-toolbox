/**
 * Estimate stored size / feature count after field + feature-filter reduction.
 * Source file bytes on disk do not change — this is what would be kept.
 *
 * Product unlock = estimated features ≤ STORED_FEATURE_LIMIT (250k).
 * Estimated bytes vs TEXT_STRONG_BYTES is soft guidance only (not unlock).
 */
import {
    formatBytes,
    TEXT_STRONG_BYTES
} from './import-preflight.js';
import { hasActiveFeatureFilter } from './import-feature-filter.js';
import {
    canAdmitStoredImport,
    needsFeatureCut,
    STORED_FEATURE_LIMIT
} from './import-admission.js';

/** Fraction of GeoJSON/KML mass treated as geometry (not shrunk by field picks). */
export const GEOMETRY_SIZE_WEIGHT = 0.7;

/** Soft size guidance (Gate A threshold) — not the Gate B unlock. */
export const IMPORT_LIMIT_BYTES = TEXT_STRONG_BYTES;
export const IMPORT_LIMIT_FEATURES = STORED_FEATURE_LIMIT;

/**
 * @param {{
 *   sourceBytes?: number,
 *   totalFeatures?: number|null,
 *   matchedFeatures?: number|null,
 *   fieldNames?: string[],
 *   selectedFields?: string[],
 *   featureFilter?: object|null,
 *   hasFence?: boolean,
 *   geometryWeight?: number,
 *   waitingOnRecount?: boolean
 * }} input
 * @returns {{
 *   sourceBytes: number,
 *   estimatedBytes: number,
 *   totalFeatures: number|null,
 *   estimatedFeatures: number|null,
 *   fieldRatio: number,
 *   featureRatio: number,
 *   hasFieldReduction: boolean,
 *   hasFeatureReduction: boolean,
 *   hasReduction: boolean,
 *   underFeatureLimit: boolean,
 *   underSizeLimit: boolean,
 *   needsFeatureCut: boolean,
 *   status: 'red'|'amber'|'green'|'idle',
 *   canImport: boolean,
 *   limitBytes: number,
 *   limitFeatures: number,
 *   estimatedBytesLabel: string,
 *   limitBytesLabel: string
 * }}
 */
export function estimateStoredImport(input = {}) {
    const sourceBytes = Math.max(0, Number(input.sourceBytes) || 0);
    const totalFeatures = input.totalFeatures == null || !Number.isFinite(input.totalFeatures)
        ? null
        : Math.max(0, Math.round(input.totalFeatures));
    const matchedFeatures = input.matchedFeatures == null || !Number.isFinite(input.matchedFeatures)
        ? null
        : Math.max(0, Math.round(input.matchedFeatures));

    const fieldNames = Array.isArray(input.fieldNames) ? input.fieldNames : [];
    const selectedFields = Array.isArray(input.selectedFields) ? input.selectedFields : fieldNames;
    const geometryWeight = Math.min(0.95, Math.max(0.05, input.geometryWeight ?? GEOMETRY_SIZE_WEIGHT));
    const attrWeight = 1 - geometryWeight;

    const hasFieldReduction = fieldNames.length > 0
        && selectedFields.length > 0
        && selectedFields.length < fieldNames.length;
    const hasFeatureReduction = hasActiveFeatureFilter(input.featureFilter) || input.hasFence === true;
    const hasReduction = hasFieldReduction || hasFeatureReduction;

    const fieldRatio = fieldNames.length === 0
        ? 1
        : Math.min(1, Math.max(0, selectedFields.length / fieldNames.length));

    let featureRatio = 1;
    let estimatedFeatures = totalFeatures;
    if (matchedFeatures != null) {
        estimatedFeatures = matchedFeatures;
        if (totalFeatures != null && totalFeatures > 0) {
            featureRatio = Math.min(1, matchedFeatures / totalFeatures);
        }
    } else if (hasFeatureReduction && totalFeatures != null) {
        // Filter/fence active but recount not finished — keep full count until known.
        estimatedFeatures = totalFeatures;
        featureRatio = 1;
    }

    const sizeFactor = (geometryWeight + attrWeight * fieldRatio) * featureRatio;
    const estimatedBytes = Math.round(sourceBytes * sizeFactor);

    const underFeatureLimit = estimatedFeatures == null
        ? false
        : estimatedFeatures <= IMPORT_LIMIT_FEATURES;
    const underSizeLimit = estimatedBytes <= IMPORT_LIMIT_BYTES;
    const mustCut = needsFeatureCut(estimatedFeatures, IMPORT_LIMIT_FEATURES)
        || (estimatedFeatures == null && needsFeatureCut(totalFeatures, IMPORT_LIMIT_FEATURES));

    const waitingOnRecount = input.waitingOnRecount === true;

    /** @type {'red'|'amber'|'green'|'idle'} */
    let status = 'idle';
    if (waitingOnRecount) {
        status = 'amber';
    } else if (estimatedFeatures == null && totalFeatures == null) {
        status = sourceBytes > IMPORT_LIMIT_BYTES ? 'amber' : 'idle';
    } else if (!underFeatureLimit) {
        status = 'red';
    } else if (sourceBytes > IMPORT_LIMIT_BYTES) {
        // Large source that still fits the feature cap — stream is fine.
        status = 'green';
    } else {
        status = 'green';
    }

    const canImport = canAdmitStoredImport({
        estimatedFeatures,
        limitFeatures: IMPORT_LIMIT_FEATURES
    });

    return {
        sourceBytes,
        estimatedBytes,
        totalFeatures,
        estimatedFeatures,
        fieldRatio,
        featureRatio,
        hasFieldReduction,
        hasFeatureReduction,
        hasReduction,
        underFeatureLimit,
        underSizeLimit,
        needsFeatureCut: mustCut,
        status,
        canImport,
        limitBytes: IMPORT_LIMIT_BYTES,
        limitFeatures: IMPORT_LIMIT_FEATURES,
        estimatedBytesLabel: formatBytes(estimatedBytes),
        limitBytesLabel: formatBytes(IMPORT_LIMIT_BYTES)
    };
}

export default {
    GEOMETRY_SIZE_WEIGHT,
    IMPORT_LIMIT_BYTES,
    IMPORT_LIMIT_FEATURES,
    estimateStoredImport
};
