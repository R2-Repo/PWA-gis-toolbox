/**
 * Plan Production Export widget engine — readiness and professional export.
 */

import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import { restoreDesignSession } from '../fiber-procurement-design/engine.js';
import { restoreCalloutSession } from '../plan-set-callouts/engine.js';
import { restoreSheetSession } from '../sheet-cutting/engine.js';
import { runPlanReadinessCheck } from './readiness-engine.js';
import {
    EXPORT_PROFILES,
    enrichAssemblyForExport,
    buildProfessionalPlanExport
} from './export-builder.js';

export const WIDGET_ID = 'plan-production-export';

export const EXPORT_STEPS = [
    'Project',
    'Link Sessions',
    'Readiness',
    'Export Profile',
    'Export'
];

export const LINKABLE_WIDGETS = [
    { id: 'fiber-procurement-design', label: 'Fiber Procurement Design' },
    { id: 'plan-set-callouts', label: 'Plan Set Callouts' },
    { id: 'sheet-cutting', label: 'Sheet Cutter' }
];

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createPlanProductionSession(input = {}) {
    return {
        project: createPlanProject({
            projectName: input.projectName || 'Plan Production Export',
            projectNumber: input.projectNumber || ''
        }),
        assembly: {
            sources: {},
            fiberSession: null,
            calloutSession: null,
            sheetSession: null
        },
        readiness: null,
        exportProfileId: input.exportProfileId || 'procurement',
        lastExport: null
    };
}

/**
 * @param {object} session
 * @param {object} patch
 * @returns {object}
 */
export function updateProductionProject(session, patch = {}) {
    return {
        ...session,
        project: updatePlanProject(session.project, patch)
    };
}

/**
 * @param {object} bundle
 * @param {string} widgetType
 * @returns {object|null}
 */
export function restoreWidgetBundle(bundle, widgetType) {
    if (!bundle) return null;

    switch (widgetType) {
        case 'fiber-procurement-design':
            return restoreDesignSession(bundle);
        case 'plan-set-callouts':
            return restoreCalloutSession(bundle);
        case 'sheet-cutting':
            return restoreSheetSession(bundle);
        default:
            return null;
    }
}

/**
 * @param {object[]} widgetEntries
 * @returns {object}
 */
export function assembleFromWidgetEntries(widgetEntries = []) {
    const sources = {};
    let fiberSession = null;
    let calloutSession = null;
    let sheetSession = null;

    for (const entry of widgetEntries) {
        if (!entry?.state) continue;
        const restored = restoreWidgetBundle(entry.state, entry.type);
        if (!restored) continue;

        sources[entry.type] = true;
        if (entry.type === 'fiber-procurement-design') fiberSession = restored;
        if (entry.type === 'plan-set-callouts') calloutSession = restored;
        if (entry.type === 'sheet-cutting') sheetSession = restored;
    }

    const project = fiberSession?.project
        || calloutSession?.project
        || sheetSession?.project
        || createPlanProject({ projectName: 'Plan Production Export' });

    return {
        project,
        sources,
        fiberSession,
        calloutSession,
        sheetSession
    };
}

/**
 * @param {object} session
 * @param {object} assembly
 * @returns {object}
 */
export function linkWidgetAssembly(session, assembly = {}) {
    return {
        ...session,
        project: assembly.project || session.project,
        assembly: {
            sources: assembly.sources || {},
            fiberSession: assembly.fiberSession || null,
            calloutSession: assembly.calloutSession || null,
            sheetSession: assembly.sheetSession || null
        }
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function runReadinessCheck(session) {
    const readiness = runPlanReadinessCheck(session.assembly || {});
    return {
        ...session,
        readiness
    };
}

/**
 * @param {object} session
 * @param {string} profileId
 * @returns {object}
 */
export function setExportProfile(session, profileId = 'procurement') {
    if (!EXPORT_PROFILES[profileId]) {
        throw new Error('Unknown export profile.');
    }
    return {
        ...session,
        exportProfileId: profileId
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildProductionExport(session) {
    const enriched = enrichAssemblyForExport({
        ...(session.assembly || {}),
        project: session.project,
        readiness: session.readiness
    });

    const exportPackage = buildProfessionalPlanExport(enriched, session.exportProfileId || 'procurement');
    return {
        ...session,
        lastExport: exportPackage
    };
}

/**
 * @param {object} session
 * @returns {object[]}
 */
export function getExportProfileOptions() {
    return Object.values(EXPORT_PROFILES);
}

/**
 * @param {object} session
 * @returns {object}
 */
export function serializeProductionSession(session) {
    return serializePlanProject(session.project, {
        metadata: {
            widget: WIDGET_ID,
            exportProfileId: session.exportProfileId,
            sources: session.assembly?.sources || {},
            readinessScore: session.readiness?.score ?? null
        }
    });
}

/**
 * @param {object} bundle
 * @returns {object}
 */
export function restoreProductionSession(bundle) {
    const restored = restorePlanProject(bundle);
    if (!restored.ok) {
        throw new Error(restored.errors[0]);
    }

    return createPlanProductionSession({
        projectName: restored.project.projectName,
        projectNumber: restored.project.projectNumber,
        exportProfileId: bundle.metadata?.exportProfileId || 'procurement'
    });
}
