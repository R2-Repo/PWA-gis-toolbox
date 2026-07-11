/**
 * Plan Set Callouts — shared engine foundation (Phase 4).
 */

import { createStableId } from '../../plan-project/id-utils.js';
import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import {
    DEFAULT_PROFILE_ID,
    BUILT_IN_CALLOUT_DEFINITIONS_RAW,
    BUILT_IN_CALLOUT_RULES_RAW
} from './callout-profile.js';
import { buildCalloutExportPackage } from './export-builder.js';
import {
    generateSheetAwarePlacements,
    parseSheetsFromLayerFeatures,
    parseRouteFromLayerFeatures,
    validateSheetAwarePlacements,
    buildPerSheetCalloutTables
} from './sheet-placement-engine.js';
import { restoreSheetSession } from '../sheet-cutting/engine.js';

/**
 * @returns {object}
 */
export function createDefaultCalloutProfile() {
    return {
        profileId: DEFAULT_PROFILE_ID,
        profileName: 'Standard Fiber Plan Callouts',
        definitions: BUILT_IN_CALLOUT_DEFINITIONS_RAW.map((entry) => createCalloutDefinition(entry)),
        rules: BUILT_IN_CALLOUT_RULES_RAW.map((entry) => createCalloutRule(entry))
    };
}

export const CALLOUT_SHAPES = {
    TRIANGLE: 'triangle',
    SQUARE: 'square',
    OCTAGON: 'octagon',
    CIRCLE: 'circle',
    DIAMOND: 'diamond',
    HEXAGON: 'hexagon'
};

/**
 * @param {object} input
 * @returns {object}
 */
export function createCalloutDefinition(input = {}) {
    return {
        calloutId: input.calloutId || createStableId('callout'),
        code: input.code || '',
        shape: input.shape || CALLOUT_SHAPES.TRIANGLE,
        category: input.category || '',
        shortDescription: input.shortDescription || '',
        fullDescription: input.fullDescription || '',
        symbolKey: input.symbolKey || '',
        displayOrder: Number(input.displayOrder ?? 0),
        defaultSize: Number(input.defaultSize ?? 1),
        defaultTextStyle: input.defaultTextStyle || {},
        optionalProcurementItemId: input.optionalProcurementItemId || '',
        optionalSpecificationReference: input.optionalSpecificationReference || '',
        active: input.active !== false,
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createCalloutRule(input = {}) {
    return {
        ruleId: input.ruleId || createStableId('rule'),
        calloutId: input.calloutId,
        conditions: Array.isArray(input.conditions) ? [...input.conditions] : [],
        matchMode: input.matchMode || 'all',
        active: input.active !== false
    };
}

/**
 * @param {object} feature
 * @param {object} condition
 * @returns {boolean}
 */
export function evaluateCalloutCondition(feature, condition = {}) {
    const props = feature?.properties || {};
    const fieldValue = props[condition.field];

    switch (condition.operator) {
        case 'equals':
            return String(fieldValue) === String(condition.value);
        case 'not_equals':
            return String(fieldValue) !== String(condition.value);
        case 'contains':
            return String(fieldValue || '').includes(String(condition.value || ''));
        case 'blank':
            return fieldValue == null || fieldValue === '';
        case 'populated':
            return fieldValue != null && fieldValue !== '';
        case 'geometry_type_equals':
            return feature?.geometry?.type === condition.value;
        case 'numeric_range': {
            const num = Number(fieldValue);
            const min = Number(condition.min);
            const max = Number(condition.max);
            if (!Number.isFinite(num)) return false;
            if (Number.isFinite(min) && num < min) return false;
            if (Number.isFinite(max) && num > max) return false;
            return true;
        }
        default:
            return false;
    }
}

/**
 * @param {object} feature
 * @param {object} rule
 * @returns {boolean}
 */
export function evaluateCalloutRule(feature, rule) {
    const conditions = rule?.conditions || [];
    if (!conditions.length) return false;
    if (rule.matchMode === 'any') {
        return conditions.some((condition) => evaluateCalloutCondition(feature, condition));
    }
    return conditions.every((condition) => evaluateCalloutCondition(feature, condition));
}

/**
 * @param {object[]} features
 * @param {object[]} rules
 * @param {object[]} definitions
 * @returns {object[]}
 */
export function generateFeatureAssignments(features = [], rules = [], definitions = []) {
    const definitionMap = new Map(definitions.map((def) => [def.calloutId, def]));
    const assignments = [];

    for (const feature of features) {
        const featureId = feature.id || feature.properties?.feature_id || feature.properties?.segment_id;
        const matchedCalloutIds = [];

        for (const rule of rules) {
            if (!rule.active) continue;
            if (evaluateCalloutRule(feature, rule)) {
                matchedCalloutIds.push(rule.calloutId);
            }
        }

        if (!matchedCalloutIds.length) continue;

        assignments.push({
            assignmentId: createStableId('assign'),
            featureId,
            calloutIds: [...new Set(matchedCalloutIds)],
            callouts: matchedCalloutIds
                .map((id) => definitionMap.get(id))
                .filter(Boolean)
        });
    }

    return assignments;
}

/**
 * @param {object[]} placements
 * @returns {object[]}
 */
export function buildSheetCalloutTable(placements = []) {
    const seen = new Map();
    for (const placement of placements) {
        for (const callout of placement.callouts || []) {
            if (!seen.has(callout.calloutId)) {
                seen.set(callout.calloutId, callout);
            }
        }
    }
    return [...seen.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

/**
 * @param {object[]} tables
 * @returns {object[]}
 */
export function buildMasterCalloutLegend(tables = []) {
    const legend = new Map();
    for (const table of tables) {
        for (const callout of table) {
            legend.set(callout.calloutId, callout);
        }
    }
    return [...legend.values()];
}

export const WIDGET_ID = 'plan-set-callouts';

export const CALLOUT_STEPS = [
    'Project',
    'Profile',
    'Rules',
    'Design Layers',
    'Assign',
    'Sheets',
    'Review',
    'Export'
];

export const RULE_OPERATORS = [
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Not equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'blank', label: 'Is blank' },
    { value: 'populated', label: 'Is populated' },
    { value: 'geometry_type_equals', label: 'Geometry type equals' },
    { value: 'numeric_range', label: 'Numeric range' }
];

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createCalloutState(input = {}) {
    const profile = input.profile || createDefaultCalloutProfile();
    return {
        profileId: profile.profileId,
        profileName: profile.profileName,
        definitions: profile.definitions || [],
        rules: profile.rules || [],
        designLayerIds: Array.isArray(input.designLayerIds) ? [...input.designLayerIds] : [],
        assignments: Array.isArray(input.assignments) ? [...input.assignments] : [],
        placements: Array.isArray(input.placements) ? [...input.placements] : [],
        sheetSetId: input.sheetSetId || '',
        sheetLayerIds: Array.isArray(input.sheetLayerIds) ? [...input.sheetLayerIds] : [],
        sheets: Array.isArray(input.sheets) ? [...input.sheets] : [],
        sheetPlacements: Array.isArray(input.sheetPlacements) ? [...input.sheetPlacements] : []
    };
}

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createCalloutSession(input = {}) {
    const project = createPlanProject({
        projectName: input.projectName || 'Plan Set Callouts',
        projectNumber: input.projectNumber || '',
        calloutProfileId: input.calloutProfileId || createDefaultCalloutProfile().profileId
    });

    return {
        project,
        callouts: createCalloutState(),
        designFeatures: [],
        stationingRoute: null,
        routeLine: null,
        sheetSource: null
    };
}

/**
 * @param {object} session
 * @param {object} patch
 * @returns {object}
 */
export function updateCalloutProject(session, patch = {}) {
    return {
        ...session,
        project: updatePlanProject(session.project, patch)
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function loadDefaultCalloutProfile(session) {
    const profile = createDefaultCalloutProfile();
    return {
        ...session,
        project: updatePlanProject(session.project, { calloutProfileId: profile.profileId }),
        callouts: createCalloutState({ profile })
    };
}

/**
 * @param {object} session
 * @param {object} definitionInput
 * @returns {object}
 */
export function addCalloutDefinition(session, definitionInput = {}) {
    const definition = createCalloutDefinition(definitionInput);
    return {
        ...session,
        callouts: {
            ...session.callouts,
            definitions: [...(session.callouts.definitions || []), definition]
        }
    };
}

/**
 * @param {object} session
 * @param {string} calloutId
 * @param {object} patch
 * @returns {object}
 */
export function updateCalloutDefinition(session, calloutId, patch = {}) {
    const definitions = (session.callouts.definitions || []).map((entry) =>
        entry.calloutId === calloutId ? { ...entry, ...patch } : entry
    );
    return {
        ...session,
        callouts: { ...session.callouts, definitions }
    };
}

/**
 * @param {object} session
 * @param {string} calloutId
 * @returns {object}
 */
export function removeCalloutDefinition(session, calloutId) {
    return {
        ...session,
        callouts: {
            ...session.callouts,
            definitions: (session.callouts.definitions || []).filter((entry) => entry.calloutId !== calloutId),
            rules: (session.callouts.rules || []).filter((entry) => entry.calloutId !== calloutId)
        }
    };
}

/**
 * @param {object} session
 * @param {object} ruleInput
 * @returns {object}
 */
export function addCalloutRule(session, ruleInput = {}) {
    if (!ruleInput.calloutId) {
        throw new Error('Select a callout for this rule.');
    }
    const rule = createCalloutRule(ruleInput);
    return {
        ...session,
        callouts: {
            ...session.callouts,
            rules: [...(session.callouts.rules || []), rule]
        }
    };
}

/**
 * @param {object} session
 * @param {string} ruleId
 * @param {object} patch
 * @returns {object}
 */
export function updateCalloutRule(session, ruleId, patch = {}) {
    const rules = (session.callouts.rules || []).map((entry) =>
        entry.ruleId === ruleId ? { ...entry, ...patch } : entry
    );
    return {
        ...session,
        callouts: { ...session.callouts, rules }
    };
}

/**
 * @param {object} session
 * @param {string} ruleId
 * @returns {object}
 */
export function removeCalloutRule(session, ruleId) {
    return {
        ...session,
        callouts: {
            ...session.callouts,
            rules: (session.callouts.rules || []).filter((entry) => entry.ruleId !== ruleId)
        }
    };
}

/**
 * @param {object} session
 * @param {string[]} layerIds
 * @returns {object}
 */
export function selectDesignLayers(session, layerIds = []) {
    return {
        ...session,
        callouts: {
            ...session.callouts,
            designLayerIds: [...layerIds]
        }
    };
}

/**
 * @param {object[]} features
 * @returns {object[]}
 */
export function normalizeDesignFeatures(features = []) {
    return features.map((feature, index) => {
        const featureId = feature.id
            || feature.properties?.feature_id
            || feature.properties?.segment_id
            || feature.properties?.fiber_id
            || `feature-${index}`;
        return {
            ...feature,
            id: featureId,
            properties: {
                ...(feature.properties || {}),
                feature_id: featureId
            }
        };
    });
}

/**
 * @param {object} session
 * @param {object[]} features
 * @returns {object}
 */
export function setDesignFeatures(session, features = []) {
    return {
        ...session,
        designFeatures: normalizeDesignFeatures(features)
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function runCalloutAssignment(session) {
    const features = session.designFeatures || [];
    if (!features.length) {
        throw new Error('Load design features from selected layers first.');
    }

    const assignments = generateFeatureAssignments(
        features,
        session.callouts.rules || [],
        session.callouts.definitions || []
    );

    const placements = assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        featureId: assignment.featureId,
        callouts: assignment.callouts || []
    }));

    return {
        ...session,
        callouts: {
            ...session.callouts,
            assignments,
            placements
        }
    };
}

/**
 * @param {object} session
 * @param {object} sheetBundle
 * @returns {object}
 */
export function linkSheetSetFromBundle(session, sheetBundle = {}) {
    const restored = restoreSheetSession(sheetBundle);
    const sheets = (restored.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');
    if (!sheets.length) {
        throw new Error('Sheet bundle does not contain detail sheets.');
    }

    return {
        ...session,
        project: updatePlanProject(session.project, {
            sheetSetIds: [...new Set([...(session.project.sheetSetIds || []), restored.sheets.sheetSetId])]
        }),
        routeLine: restored.routeLine || session.routeLine,
        stationingRoute: restored.stationingRoute || session.stationingRoute,
        sheetSource: 'bundle',
        callouts: {
            ...session.callouts,
            sheetSetId: restored.sheets.sheetSetId,
            sheets
        }
    };
}

/**
 * @param {object} session
 * @param {object[]} sheetLayerFeatures
 * @param {object} [routeLine]
 * @param {string[]} [sheetLayerIds]
 * @returns {object}
 */
export function linkSheetSetFromLayers(session, sheetLayerFeatures = [], routeLine = null, sheetLayerIds = []) {
    const sheets = parseSheetsFromLayerFeatures(sheetLayerFeatures);
    if (!sheets.length) {
        throw new Error('Selected layers do not contain sheet frame features.');
    }

    const resolvedRoute = routeLine || parseRouteFromLayerFeatures(sheetLayerFeatures);

    return {
        ...session,
        routeLine: resolvedRoute || session.routeLine,
        sheetSource: 'layers',
        callouts: {
            ...session.callouts,
            sheetSetId: session.callouts.sheetSetId || createStableId('sheetset'),
            sheetLayerIds: [...sheetLayerIds],
            sheets
        }
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function runSheetAwarePlacement(session) {
    const assignments = session.callouts?.assignments || [];
    const sheets = session.callouts?.sheets || [];

    if (!assignments.length) {
        throw new Error('Run callout assignment before sheet placement.');
    }
    if (!sheets.length) {
        throw new Error('Link a sheet set before running sheet-aware placement.');
    }
    if (!session.routeLine?.geometry) {
        throw new Error('Route centerline is required for sheet-aware placement.');
    }

    const sheetPlacements = generateSheetAwarePlacements({
        assignments,
        sheets,
        features: session.designFeatures || [],
        routeLine: session.routeLine
    });

    return {
        ...session,
        callouts: {
            ...session.callouts,
            sheetPlacements,
            perSheetTables: buildPerSheetCalloutTables(sheetPlacements)
        }
    };
}

/**
 * @param {object} session
 * @returns {object[]}
 */
export function getSheetPlacements(session) {
    return session.callouts?.sheetPlacements || [];
}

/**
 * @param {object} session
 * @returns {object[]}
 */
export function getCalloutLegend(session) {
    return buildMasterCalloutLegend([
        buildSheetCalloutTable(session.callouts?.placements || []),
        session.callouts?.definitions || []
    ]);
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildSessionExport(session) {
    return buildCalloutExportPackage(session);
}

/**
 * @param {object} session
 * @returns {object}
 */
export function serializeCalloutSession(session) {
    return serializePlanProject(session.project, {
        callouts: session.callouts,
        metadata: {
            widget: WIDGET_ID,
            designLayerIds: session.callouts?.designLayerIds || [],
            designFeatureCount: session.designFeatures?.length || 0,
            sheetSetId: session.callouts?.sheetSetId || '',
            sheetSource: session.sheetSource || '',
            hasRouteLine: Boolean(session.routeLine?.geometry),
            routeGeometry: session.routeLine?.geometry || null
        }
    });
}

/**
 * @param {object} bundle
 * @returns {object}
 */
export function restoreCalloutSession(bundle) {
    const restored = restorePlanProject(bundle);
    if (!restored.ok) {
        throw new Error(restored.errors[0]);
    }

    return {
        project: restored.project,
        callouts: createCalloutState(restored.callouts || {}),
        designFeatures: [],
        stationingRoute: null,
        routeLine: bundle.metadata?.routeGeometry
            ? { type: 'Feature', geometry: bundle.metadata.routeGeometry, properties: {} }
            : null,
        sheetSource: bundle.metadata?.sheetSource || null
    };
}

/**
 * @param {object} session
 * @returns {{ valid: boolean, errors: string[], warnings: string[], findings: object[] }}
 */
export function validateCalloutSession(session) {
    const findings = [];
    const callouts = session.callouts || {};

    if (!(callouts.definitions || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_definitions',
            message: 'No callout definitions in profile.',
            step: 'Profile'
        });
    }

    if (!(callouts.rules || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_rules',
            message: 'No assignment rules configured.',
            step: 'Rules'
        });
    }

    if (!(callouts.designLayerIds || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_design_layers',
            message: 'No design layers selected.',
            step: 'Design Layers'
        });
    }

    if (!(session.designFeatures || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_features',
            message: 'No design features loaded from layers.',
            step: 'Design Layers'
        });
    }

    if (!(callouts.assignments || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_assignments',
            message: 'Run callout assignment before export.',
            step: 'Assign'
        });
    }

    if (!(callouts.sheets || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_sheet_set',
            message: 'Link a sheet set for sheet-aware callouts.',
            step: 'Sheets'
        });
    }

    if ((callouts.sheets || []).length && !(callouts.sheetPlacements || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_sheet_placements',
            message: 'Run sheet-aware placement before export.',
            step: 'Sheets'
        });
    }

    if ((callouts.sheetPlacements || []).length) {
        const sheetValidation = validateSheetAwarePlacements(
            callouts.sheetPlacements,
            callouts.assignments || [],
            callouts.sheets || []
        );
        for (const finding of sheetValidation.findings || []) {
            findings.push({ ...finding, step: 'Sheets' });
        }
    }

    const errors = findings.filter((entry) => entry.severity === 'error').map((entry) => entry.message);
    const warnings = findings.filter((entry) => entry.severity === 'warning').map((entry) => entry.message);

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        findings
    };
}
