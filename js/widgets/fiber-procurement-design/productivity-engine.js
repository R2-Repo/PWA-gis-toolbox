/**
 * Productivity automation — last-used values, inheritance, copy, and bulk edit.
 */

import { resolveInheritedValue, formatInheritanceHint, INHERITANCE_SOURCES } from '../../plan-project/inheritance.js';
import { buildFeatureLabel } from '../../plan-project/symbology-registry.js';
import { createConduitComponent } from './design-model.js';
import { expandAssemblyToSegmentDefaults, getActiveAssembly, getAssemblyById } from './assembly-engine.js';

export const LAST_USED_KEYS = {
    INSTALLATION_METHOD: 'installationMethod',
    SURFACE_TYPE: 'surfaceType',
    DUCT_COUNT: 'ductCount',
    DIAMETER: 'diameter',
    PRODUCT_TYPE: 'productType',
    STRAND_COUNT: 'strandCount',
    CABLE_TYPE: 'cableType',
    SPLICE_MODE: 'spliceMode'
};

const COPYABLE_CONDUIT_FIELDS = [
    'installationMethod',
    'surfaceType',
    'existingOrProposed',
    'conduitComponents',
    'procurementItemIds',
    'assemblyId',
    'symbolKey',
    'notes'
];

/**
 * @param {object} design
 * @param {Record<string, unknown>} values
 * @returns {object}
 */
export function recordLastUsedValues(design, values = {}) {
    return {
        ...(design.lastUsed || {}),
        ...values,
        updatedAt: new Date().toISOString()
    };
}

/**
 * @param {object} design
 * @param {string} key
 * @returns {unknown}
 */
export function getLastUsedValue(design, key) {
    return design?.lastUsed?.[key];
}

/**
 * @param {object} session
 * @param {string} [parentSegmentId]
 * @returns {object}
 */
export function resolveConduitDrawingDefaults(session, parentSegmentId = '') {
    const project = session.project || {};
    const design = session.design || {};
    const parentSegment = parentSegmentId
        ? (design.conduitSegments || []).find((segment) => segment.segmentId === parentSegmentId)
        : null;
    const activeAssembly = getActiveAssembly(project, design);
    const assemblyDefaults = expandAssemblyToSegmentDefaults(
        activeAssembly,
        project,
        session.catalog?.items || []
    );

    const installationMethod = resolveInheritedValue({
        manualOverride: null,
        parentValue: parentSegment?.installationMethod,
        parentLabel: parentSegment ? `Segment ${parentSegment.segmentId}` : '',
        assemblyValue: assemblyDefaults.installationMethod,
        assemblyLabel: activeAssembly?.assemblyName || 'Active assembly',
        projectDefault: project.defaultInstallationMethod,
        lastUsedValue: getLastUsedValue(design, LAST_USED_KEYS.INSTALLATION_METHOD)
    });

    const productType = resolveInheritedValue({
        parentValue: parentSegment?.conduitComponents?.[0]?.productType,
        parentLabel: parentSegment ? `Segment ${parentSegment.segmentId}` : '',
        assemblyValue: assemblyDefaults.conduitComponents?.[0]?.productType,
        assemblyLabel: activeAssembly?.assemblyName || 'Active assembly',
        lastUsedValue: getLastUsedValue(design, LAST_USED_KEYS.PRODUCT_TYPE),
        projectDefault: 'HDPE'
    });

    return {
        defaults: assemblyDefaults,
        installationMethod,
        productType,
        inheritance: {
            installationMethod: formatInheritanceHint(installationMethod),
            productType: formatInheritanceHint(productType)
        }
    };
}

/**
 * @param {object} sourceSegment
 * @returns {object}
 */
export function continueFromConduitSegment(sourceSegment) {
    if (!sourceSegment) {
        throw new Error('Select a source conduit segment to continue from.');
    }

    return {
        installationMethod: sourceSegment.installationMethod,
        surfaceType: sourceSegment.surfaceType,
        existingOrProposed: sourceSegment.existingOrProposed,
        assemblyId: sourceSegment.assemblyId,
        procurementItemIds: [...(sourceSegment.procurementItemIds || [])],
        conduitComponents: (sourceSegment.conduitComponents || []).map((component) =>
            createConduitComponent({
                ...component,
                componentId: undefined,
                parentSegmentId: undefined
            })
        ),
        symbolKey: sourceSegment.symbolKey,
        notes: sourceSegment.notes || ''
    };
}

/**
 * @param {object} source
 * @param {string[]} [fields]
 * @returns {object}
 */
export function copyConduitProperties(source, fields = COPYABLE_CONDUIT_FIELDS) {
    const patch = {};
    for (const field of fields) {
        if (field === 'conduitComponents') {
            patch.conduitComponents = (source.conduitComponents || []).map((component) =>
                createConduitComponent({
                    ...component,
                    componentId: undefined,
                    parentSegmentId: undefined
                })
            );
        } else if (field === 'procurementItemIds') {
            patch.procurementItemIds = [...(source.procurementItemIds || [])];
        } else if (source[field] !== undefined) {
            patch[field] = source[field];
        }
    }
    return patch;
}

/**
 * @param {object[]} segments
 * @param {string[]} segmentIds
 * @param {object} patch
 * @returns {object[]}
 */
export function bulkUpdateConduitSegments(segments = [], segmentIds = [], patch = {}) {
    if (!segmentIds.length) {
        throw new Error('Select at least one conduit segment for bulk update.');
    }

    const idSet = new Set(segmentIds);
    return segments.map((segment) => {
        if (!idSet.has(segment.segmentId)) return segment;
        return {
            ...segment,
            ...patch,
            conduitComponents: patch.conduitComponents
                ? patch.conduitComponents.map((component) =>
                    createConduitComponent({ ...component, parentSegmentId: segment.segmentId })
                )
                : segment.conduitComponents
        };
    });
}

/**
 * @param {object} segment
 * @param {object} context
 * @returns {string}
 */
export function buildConduitSegmentLabel(segment, context = {}) {
    const primary = segment.conduitComponents?.[0] || {};
    const label = buildFeatureLabel(segment.symbolKey || 'conduit-proposed', {
        ductCount: primary.ductCount,
        diameter: primary.diameter,
        productType: primary.productType,
        installationMethod: segment.installationMethod,
        routeName: context.routeName || ''
    });
    return label || segment.installationMethod || 'Conduit segment';
}

/**
 * @param {object} fiber
 * @returns {string}
 */
export function buildFiberRouteLabel(fiber) {
    return buildFeatureLabel(fiber.symbolKey || 'fiber-proposed', fiber)
        || fiber.cableName
        || `${fiber.strandCount || 0}F ${fiber.cableType || 'SM'}`;
}

/**
 * @param {object} design
 * @returns {object}
 */
export function applyAutomaticLabels(design = {}) {
    const alignments = (design.alignments || []).map((alignment) => ({
        ...alignment,
        displayLabel: alignment.alignmentName || alignment.routeName || 'Planning alignment'
    }));

    const conduitSegments = (design.conduitSegments || []).map((segment) => ({
        ...segment,
        displayLabel: buildConduitSegmentLabel(segment, {
            routeName: alignments.find((alignment) => alignment.alignmentId === segment.parentAlignmentId)?.routeName
        })
    }));

    const fibers = (design.fibers || []).map((fiber) => ({
        ...fiber,
        displayLabel: buildFiberRouteLabel(fiber),
        cableName: fiber.cableName || buildFiberRouteLabel(fiber)
    }));

    return {
        ...design,
        alignments,
        conduitSegments,
        fibers
    };
}

/**
 * @param {object} session
 * @param {object} configuredValues
 * @returns {object}
 */
export function captureLastUsedFromConfiguration(session, configuredValues = {}) {
    const lastUsed = recordLastUsedValues(session.design, {
        [LAST_USED_KEYS.INSTALLATION_METHOD]: configuredValues.installationMethod,
        [LAST_USED_KEYS.SURFACE_TYPE]: configuredValues.surfaceType,
        [LAST_USED_KEYS.DUCT_COUNT]: configuredValues.conduitComponents?.[0]?.ductCount,
        [LAST_USED_KEYS.DIAMETER]: configuredValues.conduitComponents?.[0]?.diameter,
        [LAST_USED_KEYS.PRODUCT_TYPE]: configuredValues.conduitComponents?.[0]?.productType,
        [LAST_USED_KEYS.STRAND_COUNT]: configuredValues.strandCount,
        [LAST_USED_KEYS.CABLE_TYPE]: configuredValues.cableType,
        [LAST_USED_KEYS.SPLICE_MODE]: configuredValues.spliceMode
    });

    return {
        ...session.design,
        lastUsed
    };
}

/**
 * @param {object} segment
 * @param {object} session
 * @returns {object}
 */
export function summarizeSegmentInheritance(segment, session) {
    const resolved = resolveConduitDrawingDefaults(session, segment.parentAlignmentId);
    return {
        segmentId: segment.segmentId,
        installationMethod: {
            value: segment.installationMethod,
            hint: segment.installationMethod === resolved.installationMethod.value
                ? resolved.inheritance.installationMethod
                : 'Manual override'
        },
        assemblyId: segment.assemblyId || session.project?.activeAssemblyId || '',
        source: segment.assemblyId ? INHERITANCE_SOURCES.ASSEMBLY : INHERITANCE_SOURCES.PROJECT_DEFAULT
    };
}
