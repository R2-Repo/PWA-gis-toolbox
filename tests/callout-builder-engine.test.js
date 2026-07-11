import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    BOUNDARY_MODES,
    HIGH_CALLOUT_WARNING_THRESHOLD,
    LEGEND_MODES,
    NUMBERING_MODES,
    assignCalloutNumbers,
    buildLegendText,
    calculateFeatureAnchor,
    createLeaderLines,
    createLegendRows,
    extractCalloutItemsFromFeature,
    getFeaturesForBoundary,
    groupCalloutsBySourceFeature,
    isBlankValue,
    normalizeBoundaryInput,
    placeCalloutGroup,
    runCalloutBuilder,
    sortCalloutItems,
    validateCalloutBuilderInput
} from '../js/widgets/callout-builder/engine.js';

globalThis.turf = turf;

const sheetA = turf.polygon([[
    [-112.0, 40.75],
    [-111.99, 40.75],
    [-111.99, 40.76],
    [-112.0, 40.76],
    [-112.0, 40.75]
]], { sheet_id: 'C-101', sheet_name: 'C-101', sequence: 1 });

const sheetB = turf.polygon([[
    [-111.99, 40.75],
    [-111.98, 40.75],
    [-111.98, 40.76],
    [-111.99, 40.76],
    [-111.99, 40.75]
]], { sheet_id: 'C-102', sheet_name: 'C-102', sequence: 2 });

const culvertFeature = turf.point([-111.995, 40.755], {
    removal_note: 'Remove existing 18 inch CMP',
    install_note: 'Install 24 inch RCP',
    erosion_note: '',
    traffic_note: 'Maintain one lane open'
}, { id: 'culvert-22' });

const poleFeature = turf.point([-111.992, 40.755], {
    note: 'Replace damaged pole'
}, { id: 'pole-1' });

const lineFeature = turf.lineString([
    [-112.0, 40.751],
    [-111.985, 40.751]
], { work_note: 'Relocate conduit' }, { id: 'line-1' });

const polygonFeature = turf.polygon([[
    [-111.994, 40.754],
    [-111.993, 40.754],
    [-111.993, 40.755],
    [-111.994, 40.755],
    [-111.994, 40.754]
]], { issue_note: 'ROW conflict' }, { id: 'parcel-1' });

function baseLayerConfig(overrides = {}) {
    return {
        layerId: 'culverts',
        layerName: 'Culverts',
        features: [culvertFeature],
        availableFields: ['removal_note', 'install_note', 'erosion_note', 'traffic_note'],
        calloutFields: [
            { field: 'removal_note', label: 'Removal', enabled: true },
            { field: 'install_note', label: 'Install', enabled: true },
            { field: 'erosion_note', label: 'Erosion Control', enabled: true },
            { field: 'traffic_note', label: 'Traffic', enabled: true }
        ],
        ...overrides
    };
}

describe('callout-builder engine validation', () => {
    it('validates missing source layer', () => {
        const result = validateCalloutBuilderInput({ sourceLayers: [] });
        expect(result.errors).toContain('Select at least one source layer.');
    });

    it('validates missing callout fields', () => {
        const result = validateCalloutBuilderInput({
            sourceLayers: [{
                layerId: 'culverts',
                layerName: 'Culverts',
                features: [culvertFeature],
                calloutFields: []
            }]
        });
        expect(result.errors.some((msg) => msg.includes('callout field'))).toBe(true);
    });
});

describe('callout-builder extraction', () => {
    it('skips blank field values', () => {
        expect(isBlankValue(null)).toBe(true);
        expect(isBlankValue(undefined)).toBe(true);
        expect(isBlankValue('')).toBe(true);
        expect(isBlankValue('   ')).toBe(true);
        expect(isBlankValue('note')).toBe(false);
    });

    it('creates one callout for one non-empty field', () => {
        const boundary = { boundaryId: 'global', boundaryName: 'All', sheetId: '', sheetName: '', sequence: 0 };
        const items = extractCalloutItemsFromFeature(
            turf.point([0, 0], { note: 'Hello' }),
            0,
            {
                layerId: 'points',
                layerName: 'Points',
                calloutFields: [{ field: 'note', label: 'Note', enabled: true }]
            },
            boundary
        );
        expect(items).toHaveLength(1);
        expect(items[0].sourceValue).toBe('Hello');
    });

    it('creates multiple callouts from one feature', () => {
        const boundary = { boundaryId: 'global', boundaryName: 'All', sheetId: '', sheetName: '', sequence: 0 };
        const items = extractCalloutItemsFromFeature(culvertFeature, 0, baseLayerConfig(), boundary);
        expect(items).toHaveLength(3);
        expect(items.map((item) => item.sourceField)).toEqual([
            'removal_note',
            'install_note',
            'traffic_note'
        ]);
    });

    it('preserves source layer and feature references', () => {
        const boundary = { boundaryId: 'global', boundaryName: 'All', sheetId: '', sheetName: '', sequence: 0 };
        const items = extractCalloutItemsFromFeature(culvertFeature, 0, baseLayerConfig(), boundary);
        expect(items[0].sourceLayerId).toBe('culverts');
        expect(items[0].sourceFeatureId).toBe('culvert-22');
        expect(items[0].sourceField).toBe('removal_note');
    });
});

describe('callout-builder numbering and legend', () => {
    it('assigns global numbering correctly', () => {
        const items = [
            { boundaryId: 'A', layerOrder: 0, featureOrder: 0, fieldOrder: 0 },
            { boundaryId: 'B', layerOrder: 0, featureOrder: 1, fieldOrder: 0 }
        ];
        const numbered = assignCalloutNumbers(items, { mode: NUMBERING_MODES.GLOBAL, startNumber: 1 });
        expect(numbered.map((item) => item.calloutNo)).toEqual([1, 2]);
    });

    it('restarts numbering per boundary', () => {
        const items = [
            { boundaryId: 'A', boundarySequence: 0, layerOrder: 0, featureOrder: 0, fieldOrder: 0 },
            { boundaryId: 'B', boundarySequence: 1, layerOrder: 0, featureOrder: 0, fieldOrder: 0 },
            { boundaryId: 'B', boundarySequence: 1, layerOrder: 0, featureOrder: 1, fieldOrder: 0 }
        ];
        const numbered = assignCalloutNumbers(items, { mode: NUMBERING_MODES.PER_BOUNDARY, startNumber: 1 });
        expect(numbered.map((item) => item.calloutNo)).toEqual([1, 1, 2]);
    });

    it('sorts callouts predictably', () => {
        const sorted = sortCalloutItems([
            { boundarySequence: 1, layerOrder: 0, featureOrder: 0, fieldOrder: 1 },
            { boundarySequence: 0, layerOrder: 1, featureOrder: 0, fieldOrder: 0 },
            { boundarySequence: 0, layerOrder: 0, featureOrder: 1, fieldOrder: 0 }
        ]);
        expect(sorted.map((item) => item.boundarySequence)).toEqual([0, 0, 1]);
        expect(sorted[0].layerOrder).toBe(0);
        expect(sorted[0].featureOrder).toBe(1);
        expect(sorted[1].layerOrder).toBe(1);
    });

    it('generates legend rows', () => {
        const rows = createLegendRows([
            {
                boundaryId: 'C-101',
                boundaryName: 'C-101',
                sheetId: 'C-101',
                sheetName: 'C-101',
                calloutNo: 1,
                calloutLabel: '1',
                legendText: 'Install 24 inch RCP',
                sourceLayerName: 'Culverts',
                sourceFeatureId: 'culvert-22',
                sourceField: 'install_note',
                category: 'Drainage',
                priority: 'High'
            }
        ]);
        expect(rows[0].legend_text).toBe('Install 24 inch RCP');
        expect(rows[0].callout_no).toBe(1);
    });

    it('builds field-label legend text', () => {
        const text = buildLegendText(
            { sourceValue: 'Install 24 inch RCP', sourceFieldLabel: 'Install' },
            { mode: LEGEND_MODES.FIELD_LABEL }
        );
        expect(text).toBe('Install: Install 24 inch RCP');
    });
});

describe('callout-builder boundaries', () => {
    const boundary = {
        boundaryId: 'C-101',
        boundaryName: 'C-101',
        sheetId: 'C-101',
        sheetName: 'C-101',
        sequence: 1,
        geometry: sheetA.geometry
    };

    it('includes point feature inside polygon boundary', () => {
        const { features } = getFeaturesForBoundary(boundary, [poleFeature]);
        expect(features).toHaveLength(1);
    });

    it('includes line feature crossing polygon boundary', () => {
        const { features } = getFeaturesForBoundary(boundary, [lineFeature]);
        expect(features).toHaveLength(1);
    });

    it('includes polygon feature intersecting polygon boundary', () => {
        const { features } = getFeaturesForBoundary(boundary, [polygonFeature]);
        expect(features).toHaveLength(1);
    });

    it('handles whole layer mode', () => {
        const result = runCalloutBuilder({
            boundary: { mode: BOUNDARY_MODES.WHOLE_LAYER },
            sourceLayers: [baseLayerConfig()]
        });
        expect(result.calloutBubbleFeatures).toHaveLength(3);
        expect(result.summary.boundaryCount).toBe(1);
    });

    it('handles sheet layer mode', () => {
        const result = runCalloutBuilder({
            boundary: {
                mode: BOUNDARY_MODES.SHEET_LAYER,
                sheetLayerId: 'sheets',
                sheetIdField: 'sheet_id',
                sheetNameField: 'sheet_name',
                sequenceField: 'sequence'
            },
            sheetFeatures: [sheetA, sheetB],
            sourceLayers: [baseLayerConfig()]
        });
        expect(result.summary.boundaryCount).toBe(2);
        expect(result.calloutBubbleFeatures.length).toBeGreaterThan(0);
    });

    it('includes feature in multiple sheets when it intersects multiple boundaries', () => {
        const spanningFeature = turf.lineString([
            [-112.0, 40.755],
            [-111.98, 40.755]
        ], {
            install_note: 'Spanning work'
        }, { id: 'span-1' });

        const result = runCalloutBuilder({
            boundary: {
                mode: BOUNDARY_MODES.SHEET_LAYER,
                sheetLayerId: 'sheets',
                sheetIdField: 'sheet_id',
                sheetNameField: 'sheet_name',
                sequenceField: 'sequence'
            },
            sheetFeatures: [sheetA, sheetB],
            sourceLayers: [baseLayerConfig({
                features: [spanningFeature],
                calloutFields: [{ field: 'install_note', label: 'Install', enabled: true }]
            })]
        });

        const boundaryIds = new Set(result.calloutBubbleFeatures.map((feature) => feature.properties.boundary_id));
        expect(boundaryIds.has('C-101')).toBe(true);
        expect(boundaryIds.has('C-102')).toBe(true);
        expect(result.warnings.some((msg) => msg.includes('intersect multiple sheets'))).toBe(true);
    });
});

describe('callout-builder placement and output', () => {
    it('creates grouped placement for multiple callouts from one feature', () => {
        const boundary = normalizeBoundaryInput({ mode: BOUNDARY_MODES.WHOLE_LAYER })[0];
        const items = extractCalloutItemsFromFeature(culvertFeature, 0, baseLayerConfig(), boundary);
        const numbered = assignCalloutNumbers(items, { mode: NUMBERING_MODES.GLOBAL });
        const groups = groupCalloutsBySourceFeature(numbered);
        const placed = placeCalloutGroup([...groups.values()][0], culvertFeature, boundary, {
            stackMultipleFromSameFeature: true,
            bubbleSpacing: 20
        });
        expect(placed).toHaveLength(3);
        const coords = placed.map((item) => item.bubbleCoordinates.join(','));
        expect(new Set(coords).size).toBe(3);
    });

    it('creates leader line features', () => {
        const boundary = normalizeBoundaryInput({ mode: BOUNDARY_MODES.WHOLE_LAYER })[0];
        const items = extractCalloutItemsFromFeature(culvertFeature, 0, baseLayerConfig(), boundary);
        const numbered = assignCalloutNumbers(items, { mode: NUMBERING_MODES.GLOBAL }).map((item) => ({
            ...item,
            calloutId: `callout-${item.calloutNo}`,
            calloutLabel: String(item.calloutNo)
        }));
        const placed = placeCalloutGroup(numbered, culvertFeature, boundary, {});
        const leaders = createLeaderLines(placed);
        expect(leaders).toHaveLength(3);
        expect(leaders[0].geometry.type).toBe('LineString');
        expect(leaders[0].properties.leader_target_type).toBeTruthy();
    });

    it('calculates anchors for different geometry types', () => {
        expect(calculateFeatureAnchor(culvertFeature)?.targetType).toBe('point');
        expect(calculateFeatureAnchor(lineFeature)?.targetType).toBe('line-midpoint');
        expect(calculateFeatureAnchor(polygonFeature)?.targetType).toMatch(/polygon/);
    });
});

describe('callout-builder run', () => {
    it('creates callouts from multiple features and layers', () => {
        const result = runCalloutBuilder({
            boundary: { mode: BOUNDARY_MODES.WHOLE_LAYER },
            sourceLayers: [
                baseLayerConfig(),
                {
                    layerId: 'poles',
                    layerName: 'Poles',
                    features: [poleFeature],
                    calloutFields: [{ field: 'note', label: 'Note', enabled: true }]
                }
            ]
        });
        expect(result.calloutBubbleFeatures.length).toBe(4);
        expect(result.legendRows.length).toBe(4);
    });

    it('returns warning when no callouts are created', () => {
        const emptyFeature = turf.point([0, 0], { removal_note: '', install_note: '' });
        const result = runCalloutBuilder({
            boundary: { mode: BOUNDARY_MODES.WHOLE_LAYER },
            sourceLayers: [baseLayerConfig({
                features: [emptyFeature]
            })]
        });
        expect(result.calloutBubbleFeatures).toHaveLength(0);
        expect(result.warnings.some((msg) => msg.includes('No callouts were created'))).toBe(true);
    });

    it('returns warning for high callout count', () => {
        const features = Array.from({ length: HIGH_CALLOUT_WARNING_THRESHOLD }, (_, index) =>
            turf.point([0, index * 0.00001], { note: `Note ${index}` }, { id: `f-${index}` })
        );
        const result = runCalloutBuilder({
            boundary: { mode: BOUNDARY_MODES.WHOLE_LAYER },
            sourceLayers: [{
                layerId: 'points',
                layerName: 'Points',
                features,
                calloutFields: [{ field: 'note', label: 'Note', enabled: true }]
            }]
        });
        expect(result.warnings.some((msg) => msg.includes('Large callout layers'))).toBe(true);
    });

    it('handles invalid geometry gracefully', () => {
        const result = runCalloutBuilder({
            boundary: { mode: BOUNDARY_MODES.WHOLE_LAYER },
            sourceLayers: [baseLayerConfig({
                features: [{ type: 'Feature', properties: { removal_note: 'Bad' }, geometry: null }]
            })]
        });
        expect(result.warnings.some((msg) => msg.includes('invalid geometry'))).toBe(true);
    });
});
