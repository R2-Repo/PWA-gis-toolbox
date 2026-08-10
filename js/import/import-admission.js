/**
 * Authoritative import admission — stored-feature unlock + materialize budget.
 *
 * Phase 1 adaptive import:
 *   STORED_FEATURE_LIMIT (1M)     — Gate B unlock: features that may land in IndexedDB
 *   MATERIALIZE_FEATURE_LIMIT (250k) — whole-layer RAM / heavy GIS tools
 *   MAX_IMPORT_FEATURES (250k)    — Gate A in-memory import (unchanged)
 *
 * Unlock rule (Gate B): estimated stored features ≤ STORED_FEATURE_LIMIT.
 * Field / filter / fence are tools — not required tokens.
 *
 * SAFETY plumbing:
 *   STREAM_MAX_BYTES (2 GB) — max source bytes readable
 *   storage quota — checked before/during stream import
 *
 * @see docs/IMPORT_LARGE_FILES.md (“End-user import gates”)
 * @see js/import/import-limit-taxonomy.js
 */
import { MAX_IMPORT_FEATURES, TEXT_STRONG_BYTES } from './import-preflight.js';
import { STREAM_MAX_FEATURES, STREAM_MAX_BYTES } from './stream/stream-constants.js';
import { hasActiveFeatureFilter } from './import-feature-filter.js';
import {
    MATERIALIZE_FEATURE_LIMIT,
    STORED_FEATURE_SOFT_LIMIT
} from './import-limit-taxonomy.js';

/**
 * Gate B unlock / stream abort: soft stored-feature ceiling (~1M).
 * Prefer this name over STREAM_STORAGE_FEATURE_LIMIT in new code.
 */
export const STORED_FEATURE_LIMIT = STORED_FEATURE_SOFT_LIMIT;

/** @deprecated alias — same as STORED_FEATURE_LIMIT (1M soft stored ceiling) */
export const STREAM_STORAGE_FEATURE_LIMIT = STREAM_MAX_FEATURES;

/** Standard-path size reject / Gate B entry guidance (ROUTING, not unlock). */
export const STORED_SIZE_GUIDANCE_BYTES = TEXT_STRONG_BYTES;

export {
    MATERIALIZE_FEATURE_LIMIT,
    STORED_FEATURE_SOFT_LIMIT,
    STREAM_MAX_BYTES,
    MAX_IMPORT_FEATURES
};

/**
 * @param {number|null|undefined} featureCount
 * @param {number} [limit]
 * @returns {boolean}
 */
export function isUnderStoredFeatureLimit(featureCount, limit = STORED_FEATURE_LIMIT) {
    return featureCount != null
        && Number.isFinite(featureCount)
        && featureCount <= limit;
}

/**
 * True when stored estimate exceeds the Gate B soft ceiling (must cut to import).
 * @param {number|null|undefined} featureCount
 * @param {number} [limit]
 * @returns {boolean}
 */
export function needsFeatureCut(featureCount, limit = STORED_FEATURE_LIMIT) {
    return featureCount != null
        && Number.isFinite(featureCount)
        && featureCount > limit;
}

/**
 * True when stored estimate exceeds the materialize / heavy-tool budget.
 * Import may still proceed; some whole-layer tools will need a working set.
 * @param {number|null|undefined} featureCount
 * @param {number} [limit]
 * @returns {boolean}
 */
export function exceedsMaterializeLimit(featureCount, limit = MATERIALIZE_FEATURE_LIMIT) {
    return featureCount != null
        && Number.isFinite(featureCount)
        && featureCount > limit;
}

/**
 * @param {unknown} fenceBbox
 * @returns {boolean}
 */
export function isActiveFenceBbox(fenceBbox) {
    return Array.isArray(fenceBbox) && fenceBbox.length === 4
        && fenceBbox.every((n) => Number.isFinite(n));
}

/**
 * Whether Gate B import may proceed given estimated stored feature count.
 * @param {{
 *   estimatedFeatures?: number|null,
 *   hasFieldReduction?: boolean,
 *   hasFeatureReduction?: boolean,
 *   hasFence?: boolean,
 *   featureFilter?: object|null,
 *   fenceBbox?: number[]|null,
 *   limitFeatures?: number
 * }} input
 */
export function canAdmitStoredImport(input = {}) {
    const limit = input.limitFeatures ?? STORED_FEATURE_LIMIT;
    return isUnderStoredFeatureLimit(input.estimatedFeatures, limit);
}

/**
 * Whether the user has applied a real cut (subset fields, filter, or fence).
 * Hint-only — not required for admission when already ≤ stored limit.
 */
export function hasImportReduction(input = {}) {
    const hasFence = input.hasFence === true || isActiveFenceBbox(input.fenceBbox);
    const hasFeatureReduction = input.hasFeatureReduction === true
        || hasActiveFeatureFilter(input.featureFilter);
    const hasFieldReduction = input.hasFieldReduction === true;
    return hasFieldReduction || hasFeatureReduction || hasFence;
}

/**
 * Normalize an admission policy object for import orchestration.
 */
export function createAdmissionPolicy(partial = {}) {
    return {
        route: partial.route || 'standard-memory',
        fileResults: Array.isArray(partial.fileResults) ? partial.fileResults : [],
        maxStoredFeatures: partial.maxStoredFeatures ?? STORED_FEATURE_LIMIT,
        maxStreamFeatures: partial.maxStreamFeatures ?? STREAM_STORAGE_FEATURE_LIMIT,
        maxMaterializeFeatures: partial.maxMaterializeFeatures ?? MATERIALIZE_FEATURE_LIMIT,
        maxFileBytes: partial.maxFileBytes ?? STREAM_MAX_BYTES,
        useWorkspace: partial.useWorkspace === true,
        requiresReduction: partial.requiresReduction === true,
        selectedFields: partial.selectedFields ?? null,
        featureFilter: partial.featureFilter ?? null,
        fenceBbox: isActiveFenceBbox(partial.fenceBbox) ? partial.fenceBbox : null,
        reasons: Array.isArray(partial.reasons) ? partial.reasons : []
    };
}

export default {
    STORED_FEATURE_LIMIT,
    STORED_FEATURE_SOFT_LIMIT,
    STREAM_STORAGE_FEATURE_LIMIT,
    MATERIALIZE_FEATURE_LIMIT,
    STORED_SIZE_GUIDANCE_BYTES,
    STREAM_MAX_BYTES,
    MAX_IMPORT_FEATURES,
    isUnderStoredFeatureLimit,
    needsFeatureCut,
    exceedsMaterializeLimit,
    isActiveFenceBbox,
    canAdmitStoredImport,
    hasImportReduction,
    createAdmissionPolicy
};
