import { describe, expect, it } from 'vitest';
import { GridSpatialIndex, bboxFromFeatures } from '../js/workspace/spatial-index.js';

describe('GridSpatialIndex', () => {
    it('queries chunks by bounds and layer', () => {
        const idx = new GridSpatialIndex();
        idx.insert('a:c:0', 'a', [-112, 40, -111, 41], 10);
        idx.insert('b:c:0', 'b', [-112, 40, -111, 41], 10);

        expect(idx.query([-112, 40, -111, 41], 'a')).toEqual(['a:c:0']);
        expect(idx.query([-112, 40, -111, 41])).toHaveLength(2);
        expect(idx.query([10, 10, 11, 11], 'a')).toHaveLength(0);
    });

    it('removeLayer keeps other layers queryable (regression)', () => {
        const idx = new GridSpatialIndex();
        idx.insert('a:c:0', 'a', [-112, 40, -111, 41], 10);
        idx.insert('b:c:0', 'b', [-112, 40, -111, 41], 10);

        idx.removeLayer('a');

        expect(idx.query([-112, 40, -111, 41], 'a')).toHaveLength(0);
        // Before the fix, removing layer "a" also wiped layer "b" cell entries.
        expect(idx.query([-112, 40, -111, 41], 'b')).toEqual(['b:c:0']);
    });

    it('bboxFromFeatures skips null geometry', () => {
        const bbox = bboxFromFeatures([
            { type: 'Feature', geometry: null, properties: {} },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-111.5, 40.5] }, properties: {} }
        ]);
        expect(bbox).toEqual([-111.5, 40.5, -111.5, 40.5]);
    });
});
