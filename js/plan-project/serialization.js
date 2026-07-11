/**
 * Plan project serialization and restoration.
 */

import { createPlanProject, validatePlanProject } from './plan-project-model.js';

export const PLAN_PROJECT_SCHEMA_VERSION = 1;

/**
 * @param {object} project
 * @param {object} [payload]
 * @returns {object}
 */
export function serializePlanProject(project, payload = {}) {
    return {
        schemaVersion: PLAN_PROJECT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        project: JSON.parse(JSON.stringify(project)),
        design: JSON.parse(JSON.stringify(payload.design || {})),
        callouts: JSON.parse(JSON.stringify(payload.callouts || {})),
        sheets: JSON.parse(JSON.stringify(payload.sheets || {})),
        quantities: JSON.parse(JSON.stringify(payload.quantities || {})),
        metadata: JSON.parse(JSON.stringify(payload.metadata || {}))
    };
}

/**
 * @param {object} bundle
 * @returns {{ ok: true, project: object, design: object, callouts: object, sheets: object, quantities: object } | { ok: false, errors: string[] }}
 */
export function restorePlanProject(bundle) {
    const errors = [];
    if (!bundle?.project) {
        return { ok: false, errors: ['Missing project payload.'] };
    }

    const project = createPlanProject(bundle.project);
    const validation = validatePlanProject(project);
    if (!validation.valid) {
        errors.push(...validation.errors);
    }

    if (errors.length) {
        return { ok: false, errors };
    }

    return {
        ok: true,
        project,
        design: bundle.design || {},
        callouts: bundle.callouts || {},
        sheets: bundle.sheets || {},
        quantities: bundle.quantities || {},
        metadata: bundle.metadata || {}
    };
}

/**
 * @param {object} bundle
 * @returns {string}
 */
export function serializePlanProjectJson(bundle) {
    return JSON.stringify(bundle, null, 2);
}

/**
 * @param {string} json
 * @returns {{ ok: true, bundle: object } | { ok: false, errors: string[] }}
 */
export function parsePlanProjectJson(json) {
    try {
        const bundle = JSON.parse(json);
        const restored = restorePlanProject(bundle);
        if (!restored.ok) return restored;
        return { ok: true, bundle };
    } catch (err) {
        return { ok: false, errors: [err?.message || 'Invalid project JSON.'] };
    }
}
