/**
 * Authoritative import admission — shared limits and stored-feature unlock gate.
 *
 * End-user product max (both small + large import): STORED_FEATURE_LIMIT (250k
 * features that actually land in the app). Large path = stream → IndexedDB;
 * small path = in-memory. Same feature ceiling.
 *
 * Plumbing only (not product max — do not lead with these in answers):
 *   STREAM_STORAGE_FEATURE_LIMIT (1M) — worker runaway abort
 *   STREAM_MAX_BYTES (2 GB) — max source bytes readable for filter/import
 *
 * @see docs/IMPORT_LARGE_FILES.md (“End-user import gates”)
 * @see docs/IMPORT_HARDENING_PLAN.md
 */
import { MAX_IMPORT_FEATURES, TEXT_STRONG_BYTES } from './import-preflight.js';
import { STREAM_MAX_FEATURES, STREAM_MAX_BYTES } from './stream/stream-constants.js';
import { hasActiveFeatureFilter } from './import-feature-filter.js';

/** User-facing unlock: estimated stored features after reduction. */
export const STORED_FEATURE_LIMIT = MAX_IMPORT_FEATURES;

/** Worker abort ceiling for streaming imports (not the UI unlock). */
export const STREAM_STORAGE_FEATURE_LIMIT = STREAM_MAX_FEATURES;

/** Unchanged-import size guidance (standard path strong threshold). */
export const STORED_SIZE_GUIDANCE_BYTES = TEXT_STRONG_BYTES;

export { STREAM_MAX_BYTES };

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
 * @param {unknown} fenceBbox
 * @returns {boolean}
 */
export function isActiveFenceBbox(fenceBbox) {
    return Array.isArray(fenceBbox) && fenceBbox.length === 4
        && fenceBbox.every((n) => Number.isFinite(n));
}

/**
 * Whether large-file import may proceed given reduction + estimated stored count.
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
    const hasFence = input.hasFence === true || isActiveFenceBbox(input.fenceBbox);
    const hasFeatureReduction = input.hasFeatureReduction === true
        || hasActiveFeatureFilter(input.featureFilter);
    const hasFieldReduction = input.hasFieldReduction === true;
    const hasReduction = hasFieldReduction || hasFeatureReduction || hasFence;
    const underLimit = isUnderStoredFeatureLimit(input.estimatedFeatures, limit);
    return hasReduction && underLimit;
}

/**
 * Normalize an admission policy object for import orchestration.
 * @param {{
 *   route?: 'standard-memory'|'stream-workspace'|'unsupported'|'rejected',
 *   fileResults?: object[],
 *   maxStoredFeatures?: number,
 *   maxStreamFeatures?: number,
 *   maxFileBytes?: number,
 *   useWorkspace?: boolean,
 *   requiresReduction?: boolean,
 *   selectedFields?: string[]|null,
 *   featureFilter?: object|null,
 *   fenceBbox?: number[]|null,
 *   reasons?: string[]
 * }} [partial]
 */
export function createAdmissionPolicy(partial = {}) {
    return {
        route: partial.route || 'standard-memory',
        fileResults: Array.isArray(partial.fileResults) ? partial.fileResults : [],
        maxStoredFeatures: partial.maxStoredFeatures ?? STORED_FEATURE_LIMIT,
        maxStreamFeatures: partial.maxStreamFeatures ?? STREAM_STORAGE_FEATURE_LIMIT,
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
    STREAM_STORAGE_FEATURE_LIMIT,
    STORED_SIZE_GUIDANCE_BYTES,
    STREAM_MAX_BYTES,
    isUnderStoredFeatureLimit,
    isActiveFenceBbox,
    canAdmitStoredImport,
    createAdmissionPolicy
};
