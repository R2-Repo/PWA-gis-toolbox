/**
 * Quantity calculation rules for fiber procurement design.
 */

import { createStableId } from '../../plan-project/id-utils.js';
import { MEASUREMENT_RULES } from './catalog-adapter.js';

export const CALCULATION_TYPES = { ...MEASUREMENT_RULES };

/**
 * @param {object} input
 * @returns {object}
 */
export function createQuantityRecord(input = {}) {
    return {
        quantityId: input.quantityId || createStableId('qty'),
        projectId: input.projectId,
        catalogItemId: input.catalogItemId,
        designFeatureIds: Array.isArray(input.designFeatureIds) ? [...input.designFeatureIds] : [],
        calculationType: input.calculationType || CALCULATION_TYPES.MANUAL,
        measuredValue: Number(input.measuredValue ?? 0),
        measurementUnit: input.measurementUnit || 'linear_feet',
        multiplier: Number(input.multiplier ?? 1),
        wasteFactor: Number(input.wasteFactor ?? 0),
        slackFactor: Number(input.slackFactor ?? 0),
        manualAdjustment: Number(input.manualAdjustment ?? 0),
        calculatedQuantity: Number(input.calculatedQuantity ?? 0),
        finalQuantity: Number(input.finalQuantity ?? 0),
        calculationExplanation: input.calculationExplanation || '',
        manuallyOverridden: !!input.manuallyOverridden,
        overrideReason: input.overrideReason || '',
        lastCalculated: input.lastCalculated || new Date().toISOString()
    };
}

/**
 * @param {object} input
 * @returns {number}
 */
export function calculateRouteLinearQuantity({ measuredLength = 0, multiplier = 1, wasteFactor = 0, manualAdjustment = 0 }) {
    const base = Number(measuredLength) * Number(multiplier);
    const withWaste = base * (1 + Number(wasteFactor || 0));
    return withWaste + Number(manualAdjustment || 0);
}

/**
 * @param {object} input
 * @returns {number}
 */
export function calculateRepeatedLinearQuantity({
    measuredLength = 0,
    ductCount = 1,
    lengthMultiplier = 1,
    wasteFactor = 0,
    manualAdjustment = 0
}) {
    return calculateRouteLinearQuantity({
        measuredLength,
        multiplier: Number(ductCount) * Number(lengthMultiplier),
        wasteFactor,
        manualAdjustment
    });
}

/**
 * @param {object} input
 * @returns {number}
 */
export function calculateFiberQuantity({
    measuredRouteLength = 0,
    slackFactor = 0,
    fixedSlack = 0,
    additionalLength = 0,
    wasteFactor = 0,
    manualAdjustment = 0
}) {
    const base = Number(measuredRouteLength);
    const withSlack = base * (1 + Number(slackFactor || 0)) + Number(fixedSlack || 0) + Number(additionalLength || 0);
    const withWaste = withSlack * (1 + Number(wasteFactor || 0));
    return withWaste + Number(manualAdjustment || 0);
}

/**
 * @param {number} count
 * @returns {number}
 */
export function calculatePointAssetCount(count = 0) {
    return Number(count) || 0;
}

/**
 * @param {object} input
 * @returns {number}
 */
export function calculateAreaRestorationQuantity({
    measuredLength = 0,
    restorationWidthFt = 0,
    wasteFactor = 0,
    manualAdjustment = 0
}) {
    const area = Number(measuredLength) * Number(restorationWidthFt);
    const withWaste = area * (1 + Number(wasteFactor || 0));
    return withWaste + Number(manualAdjustment || 0);
}

/**
 * @param {object} record
 * @param {number} finalQuantity
 * @param {string} reason
 * @returns {object}
 */
export function applyManualQuantityOverride(record, finalQuantity, reason = '') {
    return {
        ...record,
        finalQuantity: Number(finalQuantity),
        manuallyOverridden: true,
        overrideReason: reason,
        lastCalculated: new Date().toISOString()
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function buildQuantityRecord(input) {
    const {
        projectId,
        catalogItem,
        designFeatureIds = [],
        measuredValue = 0,
        ductCount = 1,
        lengthMultiplier = 1,
        slackFactor = 0,
        fixedSlack = 0,
        additionalLength = 0,
        wasteFactor = 0,
        manualAdjustment = 0,
        restorationWidthFt = 0,
        pointCount = 0,
        manualQuantity = null
    } = input;

    const calculationType = catalogItem?.measurementRule || CALCULATION_TYPES.MANUAL;
    let calculatedQuantity = 0;
    let explanation = '';

    switch (calculationType) {
        case CALCULATION_TYPES.ROUTE_LINEAR:
            calculatedQuantity = calculateRouteLinearQuantity({ measuredLength: measuredValue, wasteFactor, manualAdjustment });
            explanation = `${measuredValue} ft route length`;
            break;
        case CALCULATION_TYPES.REPEATED_LINEAR:
            calculatedQuantity = calculateRepeatedLinearQuantity({
                measuredLength: measuredValue,
                ductCount,
                lengthMultiplier,
                wasteFactor,
                manualAdjustment
            });
            explanation = `${measuredValue} ft × ${ductCount} ducts`;
            break;
        case CALCULATION_TYPES.FIBER_LENGTH:
            calculatedQuantity = calculateFiberQuantity({
                measuredRouteLength: measuredValue,
                slackFactor,
                fixedSlack,
                additionalLength,
                wasteFactor,
                manualAdjustment
            });
            explanation = `${measuredValue} ft route + slack ${slackFactor || 0} + fixed ${fixedSlack || 0} ft`;
            break;
        case CALCULATION_TYPES.POINT_COUNT:
            calculatedQuantity = calculatePointAssetCount(pointCount);
            explanation = `${pointCount} point assets`;
            break;
        case CALCULATION_TYPES.AREA_RESTORATION:
            calculatedQuantity = calculateAreaRestorationQuantity({
                measuredLength: measuredValue,
                restorationWidthFt,
                wasteFactor,
                manualAdjustment
            });
            explanation = `${measuredValue} ft × ${restorationWidthFt} ft restoration width`;
            break;
        case CALCULATION_TYPES.MANUAL:
        default:
            calculatedQuantity = manualQuantity != null ? Number(manualQuantity) : Number(manualAdjustment || 0);
            explanation = 'Manual quantity';
            break;
    }

    return createQuantityRecord({
        projectId,
        catalogItemId: catalogItem?.catalogItemId || '',
        designFeatureIds,
        calculationType,
        measuredValue,
        measurementUnit: catalogItem?.unit || 'each',
        multiplier: ductCount * lengthMultiplier,
        wasteFactor,
        slackFactor,
        manualAdjustment,
        calculatedQuantity,
        finalQuantity: calculatedQuantity,
        calculationExplanation: explanation
    });
}

/**
 * @param {object} design
 * @param {object[]} catalogItems
 * @param {object} project
 * @returns {object[]}
 */
export function recalculateDesignQuantities(design, catalogItems = [], project = {}) {
    const quantities = [];
    const wasteFactor = project.defaultWasteFactor ?? 0;
    const slackFactor = project.defaultSlackFactor ?? 0;

    const findByRule = (rule) => catalogItems.find((item) => item.measurementRule === rule);

    for (const segment of design.conduitSegments || []) {
        const installItem = catalogItems.find((item) =>
            item.installationMethod &&
            item.installationMethod.toLowerCase() === String(segment.installationMethod || '').toLowerCase()
        ) || findByRule(CALCULATION_TYPES.ROUTE_LINEAR);

        if (installItem && segment.installationMethod) {
            quantities.push(buildQuantityRecord({
                projectId: project.projectId,
                catalogItem: installItem,
                designFeatureIds: [segment.segmentId],
                measuredValue: segment.measuredLength,
                wasteFactor
            }));
        }

        for (const component of segment.conduitComponents || []) {
            const catalogItem = catalogItems.find((item) => item.catalogItemId === component.catalogItemId)
                || catalogItems.find((item) =>
                    item.productType &&
                    component.productType &&
                    item.productType.toLowerCase().includes(component.productType.toLowerCase())
                );
            if (!catalogItem) continue;
            quantities.push(buildQuantityRecord({
                projectId: project.projectId,
                catalogItem,
                designFeatureIds: [segment.segmentId, component.componentId],
                measuredValue: segment.measuredLength,
                ductCount: component.ductCount,
                lengthMultiplier: component.lengthMultiplier,
                wasteFactor: component.wasteFactor ?? wasteFactor
            }));
        }
    }

    for (const fiber of design.fibers || []) {
        const catalogItem = catalogItems.find((item) => item.catalogItemId === fiber.catalogItemId)
            || catalogItems.find((item) => item.measurementRule === CALCULATION_TYPES.FIBER_LENGTH);
        if (!catalogItem) continue;
        quantities.push(buildQuantityRecord({
            projectId: project.projectId,
            catalogItem,
            designFeatureIds: [fiber.fiberId, ...(fiber.sourceSegmentIds || [])],
            measuredValue: fiber.measuredRouteLength,
            slackFactor: fiber.slackFactor ?? slackFactor,
            fixedSlack: fiber.fixedSlack,
            additionalLength: fiber.additionalLength,
            wasteFactor
        }));
    }

    const structureCatalog = findByRule(CALCULATION_TYPES.POINT_COUNT);
    if (structureCatalog) {
        for (const structure of design.structures || []) {
            quantities.push(buildQuantityRecord({
                projectId: project.projectId,
                catalogItem: structureCatalog,
                designFeatureIds: [structure.structureId],
                pointCount: 1
            }));
        }
    }

    for (const item of design.nonSpatialItems || []) {
        const catalogItem = catalogItems.find((cat) => cat.catalogItemId === item.catalogItemId);
        if (!catalogItem) continue;
        quantities.push(buildQuantityRecord({
            projectId: project.projectId,
            catalogItem,
            designFeatureIds: [item.itemId],
            manualQuantity: item.quantity
        }));
    }

    return quantities;
}

/**
 * Preserve manual overrides when recalculating.
 * @param {object[]} previous
 * @param {object[]} next
 * @returns {object[]}
 */
export function mergeQuantityOverrides(previous = [], next = []) {
    const overrideMap = new Map();
    for (const record of previous) {
        if (!record.manuallyOverridden) continue;
        const key = `${record.catalogItemId}:${(record.designFeatureIds || []).join(',')}`;
        overrideMap.set(key, record);
    }

    return next.map((record) => {
        const key = `${record.catalogItemId}:${(record.designFeatureIds || []).join(',')}`;
        const override = overrideMap.get(key);
        if (!override) return record;
        return applyManualQuantityOverride(record, override.finalQuantity, override.overrideReason);
    });
}
