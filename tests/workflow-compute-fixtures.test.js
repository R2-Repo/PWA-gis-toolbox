/**
 * Fixture goldens for js/tools/compute as used by the workflow worker (post shared-compute migration).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import * as spatialOps from '../js/tools/compute/spatial-operations.js';
import * as transformOps from '../js/tools/compute/transform-operations.js';
import { computeFilterRows } from '../js/tools/compute/filter-rows.js';
import { computeDeduplicate } from '../js/tools/compute/deduplicate.js';
import { computeSimplify } from '../js/tools/compute/simplify.js';

const goldens = JSON.parse(
    readFileSync(new URL('./fixtures/workflow-compute-goldens.json', import.meta.url), 'utf8')
);

beforeAll(() => {
    globalThis.turf = turf;
});

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

function stripMeta(obj) {
    const out = JSON.parse(JSON.stringify(obj));
    if (out && typeof out === 'object') {
        delete out.id;
        delete out.created;
    }
    return out;
}

function tableFrom(rows, name = 'table') {
    return {
        type: 'table',
        name,
        rows: structuredClone(rows),
        schema: {
            fields: [
                { name: 'id', type: 'integer' },
                { name: 'val', type: 'number' },
                { name: 'name', type: 'string' },
                { name: 'group', type: 'string' }
            ]
        }
    };
}

function spatialFrom(features, name = 'layer') {
    return createSpatialDataset(
        name,
        { type: 'FeatureCollection', features },
        {
            format: 'derived',
            schema: {
                featureCount: features.length,
                fields: [
                    { name: 'id', type: 'integer' },
                    { name: 'val', type: 'number' },
                    { name: 'name', type: 'string' },
                    { name: 'group', type: 'string' }
                ]
            }
        }
    );
}

const TABLE_ROWS = [
    { id: 0, val: 30, name: 'n0', group: 'a' },
    { id: 1, val: 10, name: 'n1', group: 'b' },
    { id: 2, val: 20, name: 'n2', group: 'a' },
    { id: 3, val: 20, name: 'n3', group: 'c' }
];
const table = tableFrom(TABLE_ROWS);
const spatialLayer = spatialFrom([
    {
        type: 'Feature',
        properties: { id: 1, val: 10, name: 'a', group: 'x' },
        geometry: sampleGeojson.features[0].geometry
    },
    {
        type: 'Feature',
        properties: { id: 2, val: 20, name: 'b', group: 'y' },
        geometry: { type: 'Point', coordinates: [-111.88, 40.72] }
    }
]);

function expectGolden(label, actual) {
    expect(stripMeta(actual)).toEqual(goldens[label]);
}

describe('workflow worker shared compute fixture goldens', () => {
    it('table + simplify handlers match stored outputs', () => {
        expectGolden(
            'filter-rows',
            computeFilterRows(
                [table],
                { rules: [{ field: 'group', operator: 'equals', value: 'a' }], logic: 'AND' },
                null
            )
        );
        expectGolden('deduplicate', computeDeduplicate([table], { fields: ['val'] }, null));
        expectGolden(
            'simplify',
            computeSimplify([spatialLayer], { tolerance: 0.001, highQuality: false }, null)
        );
    });

    it('transform compute* handlers match stored outputs', () => {
        const cases = [
            ['computeRenameFields', { mappings: [{ from: 'name', to: 'label' }] }, [table]],
            ['computeDeleteFields', { fields: ['group'] }, [table]],
            ['computeSort', { field: 'val', direction: 'asc' }, [table]],
            ['computeFindReplace', { field: 'name', find: 'n', replace: 'x' }, [table]],
            ['computeAddUniqueId', { fieldName: 'uid', prefix: 'T' }, [table]],
            ['computeCombineFields', { fields: ['id', 'name'], separator: '-', outputField: 'combo' }, [table]],
            [
                'computeSplitColumn',
                { field: 'combo', delimiter: '-', outputNames: 'a,b' },
                [tableFrom([{ combo: '1-x' }])]
            ],
            ['computeTemplateBuilder', { template: '[id]:[name]', outputField: 'label' }, [table]],
            ['computeTypeConvert', { field: 'val', targetType: 'string' }, [table]],
            [
                'computeJoinLookup',
                { leftKey: 'group', rightKey: 'group', fieldsToJoin: ['name'] },
                [table, tableFrom([{ group: 'a', name: 'lookup-a' }], 'lookup')]
            ],
            ['computeCalculateField', { expression: '[val] * 2', outputField: 'doubled' }, [table]],
            [
                'computeConditionalValue',
                {
                    outputField: 'status',
                    rules: [{ field: 'val', operator: 'greater_than', value: '15', result: 'high' }],
                    defaultValue: 'low'
                },
                [table]
            ],
            [
                'computeUnitConvert',
                {
                    sourceField: 'val',
                    category: 'Length / Distance',
                    fromUnit: 'meters',
                    toUnit: 'feet',
                    outputField: 'val_ft',
                    precision: 2
                },
                [table]
            ],
            ['computeAddField', { fieldName: 'tag', fieldType: 'string', defaultValue: 'ok' }, [table]],
            [
                'computeRenameFields-spatial',
                { mappings: [{ from: 'name', to: 'label' }] },
                [spatialLayer]
            ]
        ];

        for (const [key, config, inputs] of cases) {
            const fnName = key.replace('-spatial', '');
            expectGolden(key, transformOps[fnName](inputs, config, null));
        }
    });

    it('spatial compute* handlers match stored outputs (union geometry only in goldens)', async () => {
        const p1 = turf.polygon(
            [
                [
                    [-112, 40],
                    [-111.9, 40],
                    [-111.9, 40.1],
                    [-112, 40.1],
                    [-112, 40]
                ]
            ],
            { g: 1 }
        );
        const p2 = turf.polygon(
            [
                [
                    [-111.95, 40.02],
                    [-111.85, 40.02],
                    [-111.85, 40.08],
                    [-111.95, 40.08],
                    [-111.95, 40.02]
                ]
            ],
            { g: 2 }
        );
        const pt = turf.point([-111.92, 40.05], { pid: 1 });
        const line = turf.lineString([[-112.05, 40.05], [-111.8, 40.05]], { id: 'L' });
        const clipPoly = turf.bboxPolygon([-111.93, 40.03, -111.86, 40.07]);
        const layer = spatialFrom([p1, p2]);
        const points = spatialFrom([pt]);
        const lines = spatialFrom([line]);
        const clipLayer = spatialFrom([clipPoly], 'clip');

        const cases = [
            ['computeBuffer', [[layer], { distance: 50, units: 'meters' }, null]],
            ['computeDissolve', [[layer], { field: 'g' }, null]],
            ['computeUnion', [[layer], {}, null]],
            ['computeCombine', [[layer], {}, null]],
            ['computeSpatialJoin', [[points, layer], { joinFields: 'g' }, null]],
            ['computeIntersect', [[layer, spatialFrom([p2])], {}, null]],
            ['computeMergeLayers', [[layer, spatialFrom([p2], 'b')], {}, null]],
            ['computeSample', [[layer], { num: 1 }, null]],
            ['computeExplode', [[layer], {}, null]],
            ['computeSplitByGeometry', [[spatialFrom([p1, pt, line])], {}, null]],
            ['computePolygonToLine', [[layer], {}, null]],
            ['computeReproject', [[layer], { toCrs: 'EPSG:3857' }, null]]
        ];

        for (const [key, args] of cases) {
            if (key === 'computeSample') {
                const sampleOut = await spatialOps.computeSample(...args);
                expect(sampleOut.geojson.features.length).toBe(goldens.computeSample.featureCount);
                continue;
            }
            expectGolden(key, await spatialOps[key](...args));
        }

        expectGolden('computeClip', spatialOps.computeClip([lines, clipLayer], {}, null));
        expect(goldens['computeClip'].geojson.features.length).toBe(0);
    });
});
