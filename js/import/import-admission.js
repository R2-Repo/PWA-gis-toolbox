/**
 * Authoritative import admission — stored-feature unlock, route selection, materialize budget.
 *
 * @see docs/IMPORT_LARGE_FILES.md (“End-user import gates”)
 * @see js/import/import-limits.js
 */
import {
    LIMITS,
    STREAM_ADMISSION_FORMATS,
    aggregateImportFiles,
    classifyPreflightSize,
    preflightByteBands
} from './import-limits.js';
import { formatBytes } from './import-preflight.js';
import { hasActiveFeatureFilter } from './import-feature-filter.js';

export { LIMITS } from './import-limits.js';

export const STORED_FEATURE_LIMIT = LIMITS.storedFeatureSoftLimit;
export const STREAM_STORAGE_FEATURE_LIMIT = LIMITS.storedFeatureSoftLimit;
export const MATERIALIZE_FEATURE_LIMIT = LIMITS.maxImportFeatures;
export const STORED_FEATURE_SOFT_LIMIT = LIMITS.storedFeatureSoftLimit;
export const STORED_SIZE_GUIDANCE_BYTES = LIMITS.textStrongBytes;
export const STREAM_MAX_BYTES = LIMITS.streamMaxBytes;
export const MAX_IMPORT_FEATURES = LIMITS.maxImportFeatures;

/** @typedef {'in-memory'|'chunked'|'streamed'|'refused'} AdmissionRoute */

export const ADMISSION_REASON = Object.freeze({
    SOURCE_OPEN_LIMIT: 'source_open_limit',
    STORED_FEATURE_LIMIT: 'stored_feature_limit',
    FEATURE_CAP: 'feature_cap',
    PREFLIGHT_REJECT: 'preflight_reject',
    STREAM_INELIGIBLE: 'stream_ineligible',
    FEATURE_COUNT: 'feature_count',
    SPATIAL_FILTER: 'spatial_filter',
    FORCE_WORKSPACE: 'force_workspace'
});

/**
 * Pure admission decision — only place that chooses in-memory, chunked, streamed, or refused.
 *
 * @param {{
 *   entry?: 'file'|'arcgis-rest',
 *   format?: string|null,
 *   files?: Array<{ name?: string, format?: string|null, bytes?: number|null, featureEstimate?: number|null }>,
 *   totalBytes?: number|null,
 *   featureCount?: number|null,
 *   overPreflightReject?: boolean|null,
 *   streamEligible?: boolean|null,
 *   allowLargeDownload?: boolean,
 *   spatialFilter?: unknown,
 *   returnGeometry?: boolean,
 *   forceWorkspace?: boolean,
 *   forceStream?: boolean
 * }} input
 * @param {typeof LIMITS} [limits]
 * @returns {{
 *   route: AdmissionRoute,
 *   useWorkspace: boolean,
 *   reasons: string[],
 *   refusedMessage?: string,
 *   totalBytes: number|null,
 *   featureCount: number|null
 * }}
 */
export function decideAdmission(input = {}, limits = LIMITS) {
    const reasons = [];
    const agg = input.files?.length
        ? aggregateImportFiles(input.files)
        : {
            totalBytes: Number.isFinite(input.totalBytes) ? input.totalBytes : null,
            totalFeatures: Number.isFinite(input.featureCount) ? input.featureCount : null,
            bytesUnknown: input.totalBytes == null || !Number.isFinite(input.totalBytes),
            featuresUnknown: input.featureCount == null || !Number.isFinite(input.featureCount)
        };

    let totalBytes = agg.totalBytes;
    let featureCount = agg.totalFeatures;
    if (featureCount == null && Number.isFinite(input.featureCount)) {
        featureCount = input.featureCount;
    }

    const primaryFormat = input.format
        ?? input.files?.[0]?.format
        ?? null;
    const entry = input.entry || 'file';

    if (!agg.bytesUnknown && totalBytes != null && totalBytes > limits.streamMaxBytes) {
        const name = input.files?.[0]?.name || 'Import';
        return {
            route: 'refused',
            useWorkspace: false,
            reasons: [ADMISSION_REASON.SOURCE_OPEN_LIMIT],
            refusedMessage: `"${name}" is ${formatBytes(totalBytes)} — source file exceeds the ${formatBytes(limits.streamMaxBytes)} open limit. Split or export a smaller subset externally before importing.`,
            totalBytes,
            featureCount
        };
    }

    if (featureCount != null && featureCount > limits.storedFeatureSoftLimit) {
        return {
            route: 'refused',
            useWorkspace: false,
            reasons: [ADMISSION_REASON.STORED_FEATURE_LIMIT],
            refusedMessage: `Estimated ${featureCount.toLocaleString()} stored features exceeds the ${limits.storedFeatureSoftLimit.toLocaleString()} storage ceiling. Apply a filter, fence, or field subset before importing.`,
            totalBytes,
            featureCount
        };
    }

    if (entry === 'arcgis-rest') {
        if (
            featureCount != null
            && featureCount > limits.arcgisMaxFeatures
            && !input.allowLargeDownload
            && !input.spatialFilter
        ) {
            return {
                route: 'refused',
                useWorkspace: false,
                reasons: [ADMISSION_REASON.FEATURE_CAP],
                refusedMessage: `This layer has ${featureCount.toLocaleString()} features — exceeds the ${limits.arcgisMaxFeatures.toLocaleString()} feature limit. Apply a filter or use a smaller layer.`,
                totalBytes,
                featureCount
            };
        }

        const useWorkspace = input.forceWorkspace === true
            || Boolean(input.spatialFilter)
            || (featureCount != null && featureCount >= limits.workspaceFeatureThreshold);

        if (input.spatialFilter) reasons.push(ADMISSION_REASON.SPATIAL_FILTER);
        if (featureCount != null && featureCount >= limits.workspaceFeatureThreshold) {
            reasons.push(ADMISSION_REASON.FEATURE_COUNT);
        }

        if (!input.returnGeometry) {
            return {
                route: 'in-memory',
                useWorkspace: false,
                reasons,
                totalBytes,
                featureCount
            };
        }

        return {
            route: useWorkspace ? 'chunked' : 'in-memory',
            useWorkspace,
            reasons,
            totalBytes,
            featureCount
        };
    }

    let overReject = input.overPreflightReject;
    if (overReject == null && !agg.bytesUnknown && totalBytes != null) {
        overReject = classifyPreflightSize(totalBytes, primaryFormat, limits) === 'reject';
    }
    if (overReject == null && agg.bytesUnknown) {
        // Unknown size — fail closed toward streaming when format allows, else refuse.
        overReject = false;
    }

    let streamEligible = input.streamEligible;
    if (streamEligible == null && primaryFormat) {
        streamEligible = STREAM_ADMISSION_FORMATS.has(primaryFormat);
    }

    if (overReject) {
        if (input.forceStream === true || streamEligible === true) {
            reasons.push(ADMISSION_REASON.PREFLIGHT_REJECT);
            return {
                route: 'streamed',
                useWorkspace: true,
                reasons,
                totalBytes,
                featureCount
            };
        }
        const bands = preflightByteBands(primaryFormat, limits);
        const name = input.files?.[0]?.name || 'File';
        return {
            route: 'refused',
            useWorkspace: false,
            reasons: [ADMISSION_REASON.PREFLIGHT_REJECT, ADMISSION_REASON.STREAM_INELIGIBLE],
            refusedMessage: `"${name}" is ${formatBytes(totalBytes ?? 0)} — too large to import safely in the browser (limit ~${formatBytes(bands.strong)}). Split or simplify externally.`,
            totalBytes,
            featureCount
        };
    }

    const useWorkspace = input.forceWorkspace === true
        || input.forceStream === true
        || (featureCount != null && featureCount >= limits.workspaceFeatureThreshold);

    if (input.forceWorkspace) reasons.push(ADMISSION_REASON.FORCE_WORKSPACE);
    if (featureCount != null && featureCount >= limits.workspaceFeatureThreshold) {
        reasons.push(ADMISSION_REASON.FEATURE_COUNT);
    }

    if (input.forceStream === true) {
        return {
            route: 'streamed',
            useWorkspace: true,
            reasons,
            totalBytes,
            featureCount
        };
    }

    if (useWorkspace) {
        return {
            route: 'chunked',
            useWorkspace: true,
            reasons,
            totalBytes,
            featureCount
        };
    }

    return {
        route: 'in-memory',
        useWorkspace: false,
        reasons,
        totalBytes,
        featureCount
    };
}

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

export function needsFeatureCut(featureCount, limit = STORED_FEATURE_LIMIT) {
    return featureCount != null
        && Number.isFinite(featureCount)
        && featureCount > limit;
}

export function exceedsMaterializeLimit(featureCount, limit = MATERIALIZE_FEATURE_LIMIT) {
    return featureCount != null
        && Number.isFinite(featureCount)
        && featureCount > limit;
}

export function isActiveFenceBbox(fenceBbox) {
    return Array.isArray(fenceBbox) && fenceBbox.length === 4
        && fenceBbox.every((n) => Number.isFinite(n));
}

export function canAdmitStoredImport(input = {}) {
    const limit = input.limitFeatures ?? STORED_FEATURE_LIMIT;
    if (input.estimatedFeatures == null || !Number.isFinite(input.estimatedFeatures)) {
        return true;
    }
    return isUnderStoredFeatureLimit(input.estimatedFeatures, limit);
}

export function hasImportReduction(input = {}) {
    const hasFence = input.hasFence === true || isActiveFenceBbox(input.fenceBbox);
    const hasFeatureReduction = input.hasFeatureReduction === true
        || hasActiveFeatureFilter(input.featureFilter);
    const hasFieldReduction = input.hasFieldReduction === true;
    return hasFieldReduction || hasFeatureReduction || hasFence;
}

export function createAdmissionPolicy(partial = {}) {
    const decided = partial.route && ['in-memory', 'chunked', 'streamed', 'refused'].includes(partial.route)
        ? partial
        : decideAdmission({
            entry: partial.entry,
            format: partial.format,
            files: partial.files,
            featureCount: partial.estimatedFeatures ?? partial.featureCount,
            forceWorkspace: partial.useWorkspace,
            forceStream: partial.route === 'streamed',
            overPreflightReject: partial.overPreflightReject,
            streamEligible: partial.streamEligible,
            allowLargeDownload: partial.allowLargeDownload,
            spatialFilter: partial.spatialFilter,
            returnGeometry: partial.returnGeometry
        });

    const legacyRoute = decided.route === 'streamed'
        ? 'stream-workspace'
        : decided.route === 'chunked'
            ? 'standard-memory'
            : decided.route === 'refused'
                ? 'rejected'
                : 'standard-memory';

    return {
        route: legacyRoute,
        admissionRoute: decided.route,
        fileResults: Array.isArray(partial.fileResults) ? partial.fileResults : [],
        maxStoredFeatures: partial.maxStoredFeatures ?? STORED_FEATURE_LIMIT,
        maxStreamFeatures: partial.maxStreamFeatures ?? STREAM_STORAGE_FEATURE_LIMIT,
        maxMaterializeFeatures: partial.maxMaterializeFeatures ?? MATERIALIZE_FEATURE_LIMIT,
        maxFileBytes: partial.maxFileBytes ?? STREAM_MAX_BYTES,
        useWorkspace: decided.useWorkspace,
        requiresReduction: partial.requiresReduction === true,
        selectedFields: partial.selectedFields ?? null,
        featureFilter: partial.featureFilter ?? null,
        fenceBbox: isActiveFenceBbox(partial.fenceBbox) ? partial.fenceBbox : null,
        reasons: [...(decided.reasons || []), ...(partial.reasons || [])],
        refusedMessage: decided.refusedMessage
    };
}

export default {
    LIMITS,
    STORED_FEATURE_LIMIT,
    STORED_FEATURE_SOFT_LIMIT,
    STREAM_STORAGE_FEATURE_LIMIT,
    MATERIALIZE_FEATURE_LIMIT,
    STORED_SIZE_GUIDANCE_BYTES,
    STREAM_MAX_BYTES,
    MAX_IMPORT_FEATURES,
    ADMISSION_REASON,
    decideAdmission,
    isUnderStoredFeatureLimit,
    needsFeatureCut,
    exceedsMaterializeLimit,
    isActiveFenceBbox,
    canAdmitStoredImport,
    hasImportReduction,
    createAdmissionPolicy
};
