/**
 * Pure finding status helpers (no platform / DOM imports).
 */

const FINDING_STATUSES = new Set(['Open', 'Reviewed', 'Ignored', 'Resolved']);

/**
 * @param {string} status
 */
export function isFindingStatus(status) {
    return FINDING_STATUSES.has(status);
}

/**
 * Pure patch for bulk/single status updates (testable).
 * @param {Array<object>} findings
 * @param {string[]} findingIds
 * @param {string} status
 * @param {string} [resolvedAt]
 */
export function applyFindingStatusPatch(findings, findingIds, status, resolvedAt = new Date().toISOString()) {
    if (!isFindingStatus(status)) return findings || [];
    const idSet = new Set((findingIds || []).filter(Boolean));
    if (!idSet.size) return findings || [];
    return (findings || []).map((f) =>
        idSet.has(f.id)
            ? {
                ...f,
                status,
                resolvedAt: status === 'Resolved' ? resolvedAt : f.resolvedAt
            }
            : f);
}
