import { describe, it, expect } from 'vitest';
import {
    featureRepresentativePoint,
    spatialCellKey,
    featureSpatialCellKey,
    createSpatialChunkWriter,
    NULL_GEOMETRY_CELL_KEY,
    SPATIAL_CHUNK_CELL_SIZE_DEG,
    SPATIAL_CHUNK_MAX_OPEN_CELLS
} from '../js/workspace/spatial-chunk-writer.js';
import { bboxFromFeatures } from '../js/workspace/spatial-index.js';

function point(lon, lat, id) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
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

        // Different cell — stays buffered until flush()
        await writer.add(point(-110.1, 41.1, 'd'));
        expect(writer.bufferedCount).toBe(1);
        await writer.flush();
        expect(flushes).toHaveLength(2);
        expect(flushes[1].startIndex).toBe(3);
        expect(flushes[1].ids).toEqual(['d']);
        expect(writer.writtenCount).toBe(4);
        expect(writer.openCellCount).toBe(0);
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

        await writer.add(point(-111.1, 40.1, 'c0')); // cell -112? floor(-111.1)=-112 for size 1? 
        // Math.floor(-111.1 / 1) = -112
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
