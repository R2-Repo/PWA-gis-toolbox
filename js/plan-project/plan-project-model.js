/**
 * Shared Plan Project model consumed by plan-production widgets.
 */

import { createStableId } from './id-utils.js';

export const PROJECT_STATUS = {
    DRAFT: 'draft',
    IN_PROGRESS: 'in_progress',
    REVIEW: 'review',
    FINAL: 'final',
    ARCHIVED: 'archived'
};

export const DEFAULT_PROJECT_DEFAULTS = {
    defaultUnits: 'feet',
    defaultSlackFactor: 0.03,
    defaultWasteFactor: 0.05,
    defaultInstallationMethod: 'directional_bore',
    defaultStatus: 'proposed'
};

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createPlanProject(input = {}) {
    const now = new Date().toISOString();
    return {
        projectId: input.projectId || createStableId('proj'),
        projectName: input.projectName || 'Untitled Plan Project',
        projectNumber: input.projectNumber || '',
        projectDescription: input.projectDescription || '',
        designer: input.designer || '',
        createdDate: input.createdDate || now,
        modifiedDate: input.modifiedDate || now,
        revision: input.revision || '0',
        projectStatus: input.projectStatus || PROJECT_STATUS.DRAFT,
        stationingProjectId: input.stationingProjectId || '',
        stationingRouteLayerId: input.stationingRouteLayerId || '',
        procurementCatalogId: input.procurementCatalogId || '',
        procurementCatalogVersion: input.procurementCatalogVersion || '',
        calloutProfileId: input.calloutProfileId || '',
        sheetSetIds: Array.isArray(input.sheetSetIds) ? [...input.sheetSetIds] : [],
        designLayerIds: Array.isArray(input.designLayerIds) ? [...input.designLayerIds] : [],
        defaultUnits: input.defaultUnits || DEFAULT_PROJECT_DEFAULTS.defaultUnits,
        defaultSlackFactor: input.defaultSlackFactor ?? DEFAULT_PROJECT_DEFAULTS.defaultSlackFactor,
        defaultWasteFactor: input.defaultWasteFactor ?? DEFAULT_PROJECT_DEFAULTS.defaultWasteFactor,
        defaultInstallationMethod: input.defaultInstallationMethod || DEFAULT_PROJECT_DEFAULTS.defaultInstallationMethod,
        defaultStatus: input.defaultStatus || DEFAULT_PROJECT_DEFAULTS.defaultStatus,
        activeAssemblyId: input.activeAssemblyId || '',
        assumptions: input.assumptions || {},
        notes: input.notes || '',
        relationships: Array.isArray(input.relationships) ? [...input.relationships] : [],
        revisions: Array.isArray(input.revisions) ? [...input.revisions] : []
    };
}

/**
 * @param {object} project
 * @param {object} patch
 * @returns {object}
 */
export function updatePlanProject(project, patch = {}) {
    return {
        ...project,
        ...patch,
        modifiedDate: new Date().toISOString(),
        sheetSetIds: patch.sheetSetIds ? [...patch.sheetSetIds] : [...(project.sheetSetIds || [])],
        designLayerIds: patch.designLayerIds ? [...patch.designLayerIds] : [...(project.designLayerIds || [])],
        relationships: patch.relationships ? [...patch.relationships] : [...(project.relationships || [])],
        revisions: patch.revisions ? [...patch.revisions] : [...(project.revisions || [])]
    };
}

/**
 * @param {object} project
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlanProject(project) {
    const errors = [];
    if (!project?.projectId) errors.push('Project ID is required.');
    if (!project?.projectName?.trim()) errors.push('Project name is required.');
    return { valid: errors.length === 0, errors };
}
