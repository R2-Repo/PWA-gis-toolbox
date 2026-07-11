/**
 * Design validation and quantity traceability checks.
 */

import { validateRelationships } from '../../plan-project/relationship-model.js';
import { indexDesignFeatures } from './design-model.js';
import { validateSpliceConfiguration } from './splice-engine.js';

/**
 * @param {object} session
 * @returns {object[]}
 */
export function runDesignReadinessCheck(session = {}) {
    const findings = [];
    const design = session.design || {};
    const project = session.project || {};
    const featuresById = indexDesignFeatures(design);

    if (!session.stationingRoute) {
        findings.push({
            severity: 'warning',
            code: 'missing_stationing',
            message: 'No stationing source selected.',
            featureId: null,
            step: 'Stationing'
        });
    }

    if (!(design.alignments || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_alignment',
            message: 'No planning alignment drawn.',
            featureId: null,
            step: 'Alignment'
        });
    }

    for (const segment of design.conduitSegments || []) {
        if (!segment.measuredLength || segment.measuredLength <= 0) {
            findings.push({
                severity: 'error',
                code: 'zero_length_segment',
                message: 'Conduit segment has zero length.',
                featureId: segment.segmentId,
                step: 'Conduit'
            });
        }
        if (!segment.installationMethod) {
            findings.push({
                severity: 'warning',
                code: 'missing_installation_method',
                message: 'Conduit segment is missing an installation method.',
                featureId: segment.segmentId,
                step: 'Conduit'
            });
        }
        if (!(segment.conduitComponents || []).length) {
            findings.push({
                severity: 'warning',
                code: 'missing_procurement_mapping',
                message: 'Conduit segment has no conduit components configured.',
                featureId: segment.segmentId,
                step: 'Conduit'
            });
        }
    }

    for (const fiber of design.fibers || []) {
        if (!fiber.sourceSegmentIds?.length) {
            findings.push({
                severity: 'warning',
                code: 'fiber_without_conduit',
                message: 'Fiber route has no source conduit segments.',
                featureId: fiber.fiberId,
                step: 'Fiber'
            });
        }
    }

    for (const warning of validateSpliceConfiguration(design)) {
        findings.push({
            severity: 'warning',
            code: 'splice_configuration',
            message: warning,
            featureId: null,
            step: 'Splicing'
        });
    }

    const relationshipValidation = validateRelationships(project.relationships || [], featuresById);
    for (const message of relationshipValidation.errors || []) {
        findings.push({
            severity: 'warning',
            code: 'broken_relationship',
            message,
            featureId: null,
            step: 'Design'
        });
    }

    for (const quantity of design.quantities || []) {
        if (quantity.manuallyOverridden) {
            findings.push({
                severity: 'info',
                code: 'manual_quantity_override',
                message: `Manual quantity override on ${quantity.catalogItemId}: ${quantity.overrideReason || 'No reason provided.'}`,
                featureId: (quantity.designFeatureIds || [])[0] || null,
                step: 'Quantities'
            });
        }
        if (!(quantity.designFeatureIds || []).length) {
            findings.push({
                severity: 'warning',
                code: 'orphaned_quantity',
                message: `Quantity ${quantity.quantityId} is not linked to design features.`,
                featureId: null,
                step: 'Quantities'
            });
        }
    }

    return findings;
}

/**
 * @param {object} design
 * @param {object[]} catalogItems
 * @returns {object[]}
 */
export function buildQuantityTraceabilityReport(design = {}, catalogItems = []) {
    return (design.quantities || []).map((record) => {
        const catalogItem = catalogItems.find((item) => item.catalogItemId === record.catalogItemId);
        const linkedFeatures = (record.designFeatureIds || [])
            .map((featureId) => {
                const features = indexDesignFeatures(design);
                const feature = features[featureId];
                return feature
                    ? {
                        featureId,
                        featureType: feature.segmentId ? 'conduit_segment'
                            : feature.fiberId ? 'fiber'
                                : feature.structureId ? 'structure'
                                    : feature.enclosureId ? 'splice'
                                        : 'other'
                    }
                    : { featureId, featureType: 'missing' };
            });

        return {
            quantityId: record.quantityId,
            catalogItemId: record.catalogItemId,
            description: catalogItem?.description || '',
            calculationType: record.calculationType,
            measuredValue: record.measuredValue,
            calculatedQuantity: record.calculatedQuantity,
            finalQuantity: record.finalQuantity,
            manuallyOverridden: record.manuallyOverridden,
            calculationExplanation: record.calculationExplanation,
            linkedFeatures
        };
    });
}

/**
 * @param {object} session
 * @returns {{ valid: boolean, errors: string[], warnings: string[], findings: object[] }}
 */
export function validateDesignSessionDetailed(session) {
    const findings = runDesignReadinessCheck(session);
    const errors = findings.filter((entry) => entry.severity === 'error').map((entry) => entry.message);
    const warnings = findings.filter((entry) => entry.severity === 'warning').map((entry) => entry.message);

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        findings
    };
}
