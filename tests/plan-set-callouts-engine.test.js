import { describe, expect, it } from 'vitest';
import {
    evaluateCalloutRule,
    generateFeatureAssignments,
    buildSheetCalloutTable
} from '../js/widgets/plan-set-callouts/engine.js';

describe('plan set callouts engine', () => {
    const definitions = [
        {
            calloutId: 'c1',
            code: '1',
            shape: 'triangle',
            shortDescription: 'Install 6-count single-mode fiber'
        },
        {
            calloutId: 'c2',
            code: '22',
            shape: 'square',
            shortDescription: 'Install Type 3 junction box'
        }
    ];

    const rules = [
        {
            ruleId: 'r1',
            calloutId: 'c1',
            matchMode: 'all',
            active: true,
            conditions: [{ operator: 'equals', field: 'strand_count', value: '6' }]
        },
        {
            ruleId: 'r2',
            calloutId: 'c2',
            matchMode: 'all',
            active: true,
            conditions: [{ operator: 'equals', field: 'asset_type', value: 'junction_box' }]
        }
    ];

    it('evaluates AND rule conditions', () => {
        const feature = { properties: { strand_count: '6', status: 'proposed' } };
        expect(evaluateCalloutRule(feature, rules[0])).toBe(true);
    });

    it('assigns multiple callouts to one feature', () => {
        const features = [{
            id: 'f1',
            properties: { strand_count: '6', asset_type: 'junction_box', status: 'proposed' }
        }];
        const assignments = generateFeatureAssignments(features, rules, definitions);
        expect(assignments[0].calloutIds).toEqual(['c1', 'c2']);
    });

    it('deduplicates callout table entries per sheet', () => {
        const placements = [
            { callouts: [definitions[0], definitions[0], definitions[1]] },
            { callouts: [definitions[1]] }
        ];
        const table = buildSheetCalloutTable(placements);
        expect(table).toHaveLength(2);
    });
});
