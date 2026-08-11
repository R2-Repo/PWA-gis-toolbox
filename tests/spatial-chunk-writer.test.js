import { describe, it, expect } from 'vitest';
import {
    featureRepresentativePoint,
    spatialCellKey,
    featureSpatialCellKey,
    featureSpatialCellKeys,
    createSpatialChunkWriter,
    NULL_GEOMETRY_CELL_KEY,
    SPATIAL_CHUNK_CELL_SIZE_DEG,
    SPATIAL_CHUNK_MAX_OPEN_CELLS,
    SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE
} from '../js/workspace/spatial-chunk-writer.js';
import { bboxFromFeatures } from '../js/workspace/spatial-index.js';

function point(lon, lat, id) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { id }
    };
}

function line(coords, id) {
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { id }
    };
}

describe('spatial-chunk-writer', () => {
    it('buckets by representative point / null geometry', () => {
        expect(featureRepresentativePoint(point(-111.2, 40.5, 1))).toEqual([-111.2, 40.5]);
        expect(featureSpatialCellKey(point(-111.2, 40.5, 1), 1)).toBe(spatialCellKey(-111.2, 40.5, 1));
        expect(featureSpatialCellKey({ geometry: null }, 1)).toBe(NULL_GEOMETRY_CELL_KEY);
        expect(SPATIAL_CHUNK_CELL_SIZE_DEG).toBe(1);
        expect(SPATIAL_CHUNK_MAX_OPEN_CELLS).toBe(32);
        expect(SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE).toBe(64);
    });

    it('places long lines into every cell they cross, not only the first vertex', () => {
        // Starts in cell floor(-120)=-120, crosses through -111 / 40.
        const f = line([[-120.5, 40.2], [-111.2, 40.2], [-110.5, 40.2]], 'cross');
        const keys = featureSpatialCellKeys(f, 1);
        expect(keys).toContain(spatialCellKey(-120.5, 40.2, 1));
        expect(keys).toContain(spatialCellKey(-111.2, 40.2, 1));
        expect(keys).toContain(spatialCellKey(-110.5, 40.2, 1));
        expect(keys.length).toBeGreaterThan(3);
        // First-vertex-only key would miss the far cell.
        expect(featureSpatialCellKey(f, 1)).toBe(spatialCellKey(-120.5, 40.2, 1));
        expect(keys).not.toEqual([featureSpatialCellKey(f, 1)]);
    });

    it('caps extreme envelopes with strided coverage', () => {
        const f = line([[-180, 0], [180, 0]], 'world');
        const keys = featureSpatialCellKeys(f, 1, 16);
        expect(keys.length).toBeLessThanOrEqual(16);
        expect(keys.length).toBeGreaterThan(1);
    });

    it('flushes full cells and keeps sequential feature indexes', async () => {
        const flushes = [];
        const writer = createSpatialChunkWriter({
            chunkSize: 3,
            cellSizeDeg: 1,
            maxOpenCells: 8,
            onFlush: async (features, startIndex) => {
                flushes.push({
                    startIndex,
                    ids: features.map((f) => f.properties.id),
                    indexes: features.map((f) => f.__featureIndex),
                    cell: featureSpatialCellKey(features[0], 1)
                });
            }
        });

        // Three points in the same 1° cell → one flush
        await writer.add(point(-111.1, 40.1, 'a'));
        await writer.add(point(-111.2, 40.2, 'b'));
        await writer.add(point(-111.3, 40.3, 'c'));
        expect(flushes).toHaveLength(1);
        expect(flushes[0].startIndex).toBe(0);
        expect(flushes[0].ids).toEqual(['a', 'b', 'c']);
        expect(flushes[0].indexes).toEqual([0, 1, 2]);

        // Different cell — stays buffered until flush()
        await writer.add(point(-110.1, 41.1, 'd'));
        expect(writer.bufferedCount).toBe(1);
        await writer.flush();
        expect(flushes).toHaveLength(2);
        expect(flushes[1].ids).toEqual(['d']);
        expect(flushes[1].indexes).toEqual([3]);
        expect(writer.writtenCount).toBe(4);
        expect(writer.openCellCount).toBe(0);
    });

    it('multi-cell lines share one logical index across cell flushes', async () => {
        const flushes = [];
        const writer = createSpatialChunkWriter({
            chunkSize: 100,
            cellSizeDeg: 1,
            maxOpenCells: 64,
            onFlush: async (features, startIndex) => {
                flushes.push({
                    startIndex,
                    id: features[0].properties.id,
                    index: features[0].__featureIndex,
                    bbox: bboxFromFeatures(features)
                });
            }
        });

        await writer.add(line([[-112.5, 40.1], [-110.5, 40.1]], 'span'));
        await writer.flush();

        expect(writer.writtenCount).toBe(1);
        expect(flushes.length).toBeGreaterThan(1);
        expect(flushes.every((f) => f.index === 0)).toBe(true);
        // Each cell flush should stay locally bounded (not statewide).
        for (const f of flushes) {
            expect(f.bbox[2] - f.bbox[0]).toBeLessThanOrEqual(3);
        }
    });

    it('LRU-evicts oldest open cells when over the cap', async () => {
        const flushes = [];
        const writer = createSpatialChunkWriter({
            chunkSize: 100,
            cellSizeDeg: 1,
            maxOpenCells: 2,
            onFlush: async (features, startIndex) => {
                flushes.push({ startIndex, ids: features.map((f) => f.properties.id) });
            }
        });

        await writer.add(point(-111.1, 40.1, 'c0'));
        await writer.add(point(-110.1, 40.1, 'c1'));
        expect(writer.openCellCount).toBe(2);
        await writer.add(point(-109.1, 40.1, 'c2')); // should flush oldest (c0)
        expect(writer.openCellCount).toBe(2);
        expect(flushes.some((f) => f.ids.includes('c0'))).toBe(true);
        await writer.flush();
        expect(writer.writtenCount).toBe(3);
    });

    it('produces tighter chunk bboxes than source-order mixing distant points', async () => {
        const spatialChunks = [];
        const writer = createSpatialChunkWriter({
            chunkSize: 2,
            cellSizeDeg: 1,
            maxOpenCells: 16,
            onFlush: async (features) => {
                spatialChunks.push(bboxFromFeatures(features));
            }
        });

        // Interleave far-apart points (would mix in source-order chunking)
        const mixed = [
            point(-120, 35, 1),
            point(-70, 42, 2),
            point(-120.1, 35.1, 3),
            point(-70.1, 42.1, 4)
        ];
        for (const f of mixed) await writer.add(f);
        await writer.flush();

        // Source-order chunks of size 2 would mix coasts; spatial chunks should not.
        expect(spatialChunks.length).toBeGreaterThanOrEqual(2);
        for (const bbox of spatialChunks) {
            const lonSpan = bbox[2] - bbox[0];
            expect(lonSpan).toBeLessThan(5);
        }
    });
});
