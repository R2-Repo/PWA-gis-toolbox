/**
 * Plan Project service — shared entry points for plan-production widgets.
 */

import { createPlanProject, updatePlanProject, validatePlanProject } from './plan-project-model.js';
import { serializePlanProject, restorePlanProject, serializePlanProjectJson, parsePlanProjectJson } from './serialization.js';
import { createRevisionSnapshot, appendRevisionSnapshot } from './revision-snapshot.js';

/** @type {Map<string, object>} */
const projectStore = new Map();

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createPlanProjectRecord(input = {}) {
    const project = createPlanProject(input);
    projectStore.set(project.projectId, project);
    return project;
}

/**
 * @param {string} projectId
 * @returns {object|null}
 */
export function loadPlanProject(projectId) {
    return projectStore.get(projectId) || null;
}

/**
 * @param {object} project
 * @returns {object}
 */
export function savePlanProject(project) {
    const validation = validatePlanProject(project);
    if (!validation.valid) {
        throw new Error(validation.errors[0]);
    }
    const updated = updatePlanProject(project);
    projectStore.set(updated.projectId, updated);
    return updated;
}

/**
 * @param {string} projectId
 * @param {object} payload
 * @returns {object}
 */
export function serializeProjectBundle(projectId, payload = {}) {
    const project = loadPlanProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found.`);
    return serializePlanProject(project, payload);
}

/**
 * @param {object} bundle
 * @returns {object}
 */
export function restoreProjectBundle(bundle) {
    const restored = restorePlanProject(bundle);
    if (!restored.ok) {
        throw new Error(restored.errors[0]);
    }
    savePlanProject(restored.project);
    return restored;
}

/**
 * @param {string} projectId
 * @param {object} payload
 * @returns {object}
 */
export function createProjectRevisionSnapshot(projectId, payload = {}) {
    const project = loadPlanProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found.`);
    const snapshot = createRevisionSnapshot({
        project,
        design: payload.design,
        callouts: payload.callouts,
        sheets: payload.sheets,
        quantities: payload.quantities,
        label: payload.label,
        notes: payload.notes
    });
    const updated = appendRevisionSnapshot(project, snapshot);
    savePlanProject(updated);
    return snapshot;
}

export {
    serializePlanProjectJson,
    parsePlanProjectJson,
    validatePlanProject
};

/**
 * Clear in-memory store (tests only).
 */
export function clearPlanProjectStore() {
    projectStore.clear();
}
