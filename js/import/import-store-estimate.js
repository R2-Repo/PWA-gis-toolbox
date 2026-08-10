/**
 * Estimate stored size / feature count after field + feature-filter reduction.
 * Source file bytes on disk do not change — this is what would be kept.
 *
 * Gate B unlock = estimated features ≤ STORED_FEATURE_LIMIT (~1M).
 * MATERIALIZE_FEATURE_LIMIT (250k) is an OPERATION hint, not unlock.
 */
import {
    formatBytes,
    TEXT_STRONG_BYTES
} from './import-preflight.js';
import { hasActiveFeatureFilter } from './import-feature-filter.js';
import {
    canAdmitStoredImport,
    needsFeatureCut,
    exceedsMaterializeLimit,
    STORED_FEATURE_LIMIT,
    MATERIALIZE_FEATURE_LIMIT
} from './import-admission.js';

/** Fraction of GeoJSON/KML mass treated as geometry (not shrunk by field picks). */
export const GEOMETRY_SIZE_WEIGHT = 0.7;

/** Soft size guidance (Gate A threshold) — not the Gate B unlock. */
export const IMPORT_LIMIT_BYTES = TEXT_STRONG_BYTES;
/** Gate B stored-feature unlock ceiling. */
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
 *   waitingOnRecount?: boolean,
 *   limitFeatures?: number,
 *   materializeLimit?: number
 * }} input
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
    const limitFeatures = Number.isFinite(Number(input.limitFeatures)) && Number(input.limitFeatures) > 0
        ? Math.floor(Number(input.limitFeatures))
        : IMPORT_LIMIT_FEATURES;
    const materializeLimit = Number.isFinite(Number(input.materializeLimit)) && Number(input.materializeLimit) > 0
        ? Math.floor(Number(input.materializeLimit))
        : MATERIALIZE_FEATURE_LIMIT;

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
        estimatedFeatures = totalFeatures;
        featureRatio = 1;
    }

    const sizeFactor = (geometryWeight + attrWeight * fieldRatio) * featureRatio;
    const estimatedBytes = Math.round(sourceBytes * sizeFactor);

    const underFeatureLimit = estimatedFeatures == null
        ? false
        : estimatedFeatures <= limitFeatures;
    const underSizeLimit = estimatedBytes <= IMPORT_LIMIT_BYTES;
    const mustCut = needsFeatureCut(estimatedFeatures, limitFeatures)
        || (estimatedFeatures == null && needsFeatureCut(totalFeatures, limitFeatures));
    const aboveMaterialize = exceedsMaterializeLimit(estimatedFeatures, materializeLimit);

    const waitingOnRecount = input.waitingOnRecount === true;

    /** @type {'red'|'amber'|'green'|'idle'} */
    let status = 'idle';
    if (waitingOnRecount) {
        status = 'amber';
    } else if (estimatedFeatures == null && totalFeatures == null) {
        status = sourceBytes > IMPORT_LIMIT_BYTES ? 'amber' : 'idle';
    } else if (!underFeatureLimit) {
        status = 'red';
    } else if (aboveMaterialize) {
        // Import OK; whole-layer tools will be restricted.
        status = 'amber';
    } else {
        status = 'green';
    }

    const canImport = canAdmitStoredImport({
        estimatedFeatures,
        limitFeatures
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
        exceedsMaterializeLimit: aboveMaterialize,
        materializeLimit,
        status,
        canImport,
        limitBytes: IMPORT_LIMIT_BYTES,
        limitFeatures,
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
