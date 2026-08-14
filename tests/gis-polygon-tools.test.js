import { describe, expect, it, beforeAll } from 'vitest';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import {
    polygonsToLineFeatures,
    fillHoleFeatures,
    splitPolygonFeaturesByLines,
    splitPolygonFeaturesByPolygons
} from '../js/tools/polygon-ops.js';
import { collectEditableVertices, applyVertexMove } from '../js/map/editable-vertices.js';
import {
    polygonToLineFeatures,
    fillHolesFeatures,
    splitPolygonsByLine,
    splitPolygonsByPolygon
} from '../js/tools/gis-tools.js';

beforeAll(() => {
    globalThis.turf = turf;
});

function square(west, south, east, north, props = {}) {
    return turf.polygon([[
        [west, south], [east, south], [east, north], [west, north], [west, south]
    ]], props);
}

function datasetFrom(name, features) {
    return createSpatialDataset(name, { type: 'FeatureCollection', features }, { format: 'derived' });
}

describe('polygon to line', () => {
    it('converts a polygon ring to a line', () => {
        const poly = square(-111.5, 40.5, -111.4, 40.6, { name: 'block' });
        const lines = polygonsToLineFeatures([poly]);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines[0].geometry.type).toBe('LineString');
        expect(lines[0].properties.name).toBe('block');
        expect(lines[0].geometry.coordinates.length).toBeGreaterThanOrEqual(4);
    });

    it('emits a line for a hole as well as the outer ring', () => {
        const outer = [
            [-111.5, 40.5], [-111.4, 40.5], [-111.4, 40.6], [-111.5, 40.6], [-111.5, 40.5]
        ];
        const hole = [
            [-111.47, 40.53], [-111.43, 40.53], [-111.43, 40.57], [-111.47, 40.57], [-111.47, 40.53]
        ];
        const poly = turf.polygon([outer, hole], { id: 1 });
        const lines = polygonsToLineFeatures([poly]);
        expect(lines.length).toBeGreaterThanOrEqual(2);
    });
});

describe('fill holes', () => {
    it('drops interior rings and reports how many were removed', () => {
        const outer = [
            [-111.5, 40.5], [-111.4, 40.5], [-111.4, 40.6], [-111.5, 40.6], [-111.5, 40.5]
        ];
        const hole = [
            [-111.47, 40.53], [-111.43, 40.53], [-111.43, 40.57], [-111.47, 40.57], [-111.47, 40.53]
        ];
        const poly = turf.polygon([outer, hole], { id: 1 });
        const { features, holesRemoved } = fillHoleFeatures([poly]);
        expect(holesRemoved).toBe(1);
        expect(features[0].geometry.coordinates).toHaveLength(1);
        expect(features[0].properties.id).toBe(1);
    });

    it('leaves solid polygons unchanged', () => {
        const poly = square(-111.5, 40.5, -111.4, 40.6);
        const { features, holesRemoved } = fillHoleFeatures([poly]);
        expect(holesRemoved).toBe(0);
        expect(features[0].geometry.coordinates).toHaveLength(1);
    });
});

describe('split polygon by line', () => {
    it('cuts a square into two pieces with a through-line', () => {
        const poly = square(-111.5, 40.5, -111.4, 40.6, { name: 'sq' });
        const line = turf.lineString([[-111.45, 40.4], [-111.45, 40.7]]);
        const pieces = splitPolygonFeaturesByLines([poly], [line]);
        expect(pieces.length).toBe(2);
        const originalArea = turf.area(poly);
        const splitArea = pieces.reduce((sum, f) => sum + turf.area(f), 0);
        expect(Math.abs(splitArea - originalArea) / originalArea).toBeLessThan(0.05);
        expect(pieces.every((f) => f.properties.name === 'sq')).toBe(true);
    });

    it('keeps the polygon when the line misses it', () => {
        const poly = square(-111.5, 40.5, -111.4, 40.6);
        const line = turf.lineString([[-111.8, 40.4], [-111.8, 40.7]]);
        const pieces = splitPolygonFeaturesByLines([poly], [line]);
        expect(pieces).toHaveLength(1);
    });
});

describe('split polygon by polygon', () => {
    it('creates overlap and remainder pieces', () => {
        const target = square(-111.5, 40.5, -111.4, 40.6, { name: 'target' });
        const splitter = square(-111.48, 40.5, -111.4, 40.55, { name: 'cut' });
        const pieces = splitPolygonFeaturesByPolygons([target], [splitter]);
        expect(pieces.length).toBeGreaterThanOrEqual(2);
        const originalArea = turf.area(target);
        const splitArea = pieces.reduce((sum, f) => sum + turf.area(f), 0);
        expect(Math.abs(splitArea - originalArea) / originalArea).toBeLessThan(0.05);
        expect(pieces.every((f) => f.properties.name === 'target')).toBe(true);
    });

    it('keeps the target when the splitter does not overlap', () => {
        const target = square(-111.5, 40.5, -111.4, 40.6);
        const splitter = square(-111.2, 40.5, -111.1, 40.6);
        const pieces = splitPolygonFeaturesByPolygons([target], [splitter]);
        expect(pieces).toHaveLength(1);
    });
});

describe('gis-tools polygon wrappers', () => {
    it('polygonToLineFeatures builds a line dataset', async () => {
        const ds = datasetFrom('parcels', [square(-111.5, 40.5, -111.4, 40.6, { a: 1 })]);
        const result = await polygonToLineFeatures(ds);
        expect(result.geojson.features[0].geometry.type).toBe('LineString');
        expect(result.name).toContain('outlines');
    });

    it('fillHolesFeatures records holesRemoved on the source', async () => {
        const outer = [
            [-111.5, 40.5], [-111.4, 40.5], [-111.4, 40.6], [-111.5, 40.6], [-111.5, 40.5]
        ];
        const hole = [
            [-111.47, 40.53], [-111.43, 40.53], [-111.43, 40.57], [-111.47, 40.57], [-111.47, 40.53]
        ];
        const ds = datasetFrom('donut', [turf.polygon([outer, hole])]);
        const result = await fillHolesFeatures(ds);
        expect(result.source.holesRemoved).toBe(1);
        expect(result.geojson.features[0].geometry.coordinates).toHaveLength(1);
    });

    it('splitPolygonsByLine returns two pieces', async () => {
        const polys = datasetFrom('poly', [square(-111.5, 40.5, -111.4, 40.6)]);
        const lines = datasetFrom('cut', [turf.lineString([[-111.45, 40.4], [-111.45, 40.7]])]);
        const result = await splitPolygonsByLine(polys, lines);
        expect(result.geojson.features.length).toBe(2);
    });

    it('splitPolygonsByPolygon returns overlap and remainder', async () => {
        const polys = datasetFrom('poly', [square(-111.5, 40.5, -111.4, 40.6)]);
        const cut = datasetFrom('cut', [square(-111.48, 40.5, -111.4, 40.55)]);
        const result = await splitPolygonsByPolygon(polys, cut);
        expect(result.geojson.features.length).toBeGreaterThanOrEqual(2);
    });
});

describe('editable vertices', () => {
    it('includes hole vertices on a polygon', () => {
        const geom = {
            type: 'Polygon',
            coordinates: [
                [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
                [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]
            ]
        };
        const verts = collectEditableVertices(geom);
        expect(verts).toHaveLength(8);
        applyVertexMove(geom, [1, 0], [1.5, 1.5]);
        expect(geom.coordinates[1][0]).toEqual([1.5, 1.5]);
        expect(geom.coordinates[1][4]).toEqual([1.5, 1.5]);
    });

    it('moves a MultiPolygon vertex by path', () => {
        const geom = {
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]
            ]
        };
        applyVertexMove(geom, [1, 0, 0], [2.2, 2.2]);
        expect(geom.coordinates[1][0][0]).toEqual([2.2, 2.2]);
        expect(geom.coordinates[1][0][4]).toEqual([2.2, 2.2]);
    });
});
