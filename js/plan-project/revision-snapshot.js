/**
 * Revision snapshot support for plan-production projects.
 */

import { createStableId } from './id-utils.js';
import { serializePlanProject } from './serialization.js';

/**
 * @param {object} input
 * @returns {object}
 */
export function createRevisionSnapshot({
    project,
    design = {},
    callouts = {},
    sheets = {},
    quantities = {},
    label = '',
    notes = ''
}) {
    const snapshotId = createStableId('rev');
    const bundle = serializePlanProject(project, { design, callouts, sheets, quantities });
    return {
        snapshotId,
        revision: project?.revision || '0',
        label: label || `Revision ${project?.revision || '0'}`,
        createdAt: new Date().toISOString(),
        notes: notes || '',
        bundle
    };
}

/**
 * @param {object} project
 * @param {object} snapshot
 * @returns {object}
 */
export function appendRevisionSnapshot(project, snapshot) {
    const revisions = [...(project.revisions || []), snapshot];
    return {
        ...project,
        revisions
    };
}

/**
 * Compare revision labels only — deep diff deferred to later phases.
 * @param {object} before
 * @param {object} after
 * @returns {string[]}
 */
export function summarizeRevisionChanges(before = {}, after = {}) {
    const changes = [];
    const fields = [
        'alignments',
        'structures',
        'conduitSegments',
        'fibers',
        'spliceEnclosures',
        'quantities',
        'calloutAssignments',
        'sheetBoxes'
    ];

    for (const field of fields) {
        const beforeCount = Array.isArray(before[field]) ? before[field].length : Object.keys(before[field] || {}).length;
        const afterCount = Array.isArray(after[field]) ? after[field].length : Object.keys(after[field] || {}).length;
        if (beforeCount !== afterCount) {
            changes.push(`${field}: ${beforeCount} → ${afterCount}`);
        }
    }

    return changes;
}
