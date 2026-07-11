import { describe, expect, it } from 'vitest';
import {
    calculateRouteLinearQuantity,
    calculateRepeatedLinearQuantity,
    calculateFiberQuantity,
    calculatePointAssetCount,
    calculateAreaRestorationQuantity,
    applyManualQuantityOverride,
    buildQuantityRecord,
    mergeQuantityOverrides,
    CALCULATION_TYPES
} from '../js/widgets/fiber-procurement-design/quantity-rules.js';

describe('fiber procurement quantity rules', () => {
    it('calculates route linear quantity', () => {
        expect(calculateRouteLinearQuantity({ measuredLength: 1000, multiplier: 1, wasteFactor: 0 })).toBe(1000);
    });

    it('calculates repeated linear component quantity', () => {
        expect(calculateRepeatedLinearQuantity({
            measuredLength: 1000,
            ductCount: 2,
            lengthMultiplier: 1,
            wasteFactor: 0
        })).toBe(2000);
    });

    it('calculates fiber slack quantity', () => {
        const qty = calculateFiberQuantity({
            measuredRouteLength: 1000,
            slackFactor: 0.03,
            fixedSlack: 50,
            additionalLength: 0,
            wasteFactor: 0
        });
        expect(qty).toBeCloseTo(1080, 5);
    });

    it('calculates fixed slack', () => {
        const qty = calculateFiberQuantity({
            measuredRouteLength: 500,
            slackFactor: 0,
            fixedSlack: 100
        });
        expect(qty).toBe(600);
    });

    it('counts point assets', () => {
        expect(calculatePointAssetCount(4)).toBe(4);
    });

    it('calculates restoration area quantity', () => {
        expect(calculateAreaRestorationQuantity({
            measuredLength: 100,
            restorationWidthFt: 4
        })).toBe(400);
    });

    it('preserves manual quantity overrides', () => {
        const record = buildQuantityRecord({
            projectId: 'proj',
            catalogItem: { catalogItemId: 'cat1', measurementRule: CALCULATION_TYPES.MANUAL, unit: 'each' },
            manualQuantity: 10
        });
        const overridden = applyManualQuantityOverride(record, 12, 'Field adjustment');
        const merged = mergeQuantityOverrides([overridden], [record]);
        expect(merged[0].finalQuantity).toBe(12);
        expect(merged[0].manuallyOverridden).toBe(true);
    });
});
