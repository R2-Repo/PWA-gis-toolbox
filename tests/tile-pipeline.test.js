import { describe, expect, it } from 'vitest';
import Protobuf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import {
    tileToBBox,
    padBBox,
    bboxIntersects,
    featureBBox,
    degreesPerPixel,
    geometryIntersectsBBox,
    segmentIntersectsBBox
} from '../js/map/tiles/tile-math.js';
import {
    selectTileFeatures,
    sampleChunksForTile,
    bboxOverlapRatio,
    selectChunksForTile,
    chunkLoadBudgetForZoom,
    shouldContinueChunkScan,
    preferLocalFeatures,
    preferCrossingThenLocalFeatures,
    featureBelongsInTile
} from '../js/map/tiles/tile-feature-select.js';
import {
    buildTileFromFeatures,
    TILE_SOURCE_LAYER,
    simplifyToleranceForZoom
} from '../js/map/tiles/tile-builder.js';

function decodeTile(bytes) {
    const tile = new VectorTile(new Protobuf(bytes));
    const layer = tile.layers[TILE_SOURCE_LAYER];
    if (!layer) return [];
    const out = [];
    for (let i = 0; i < layer.length; i++) out.push(layer.feature(i));
    return out;
}

function pt(lon, lat, props = {}) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props };
}

describe('tile-math', () => {
    it('computes the world tile at z0', () => {
        const [w, s, e, n] = tileToBBox(0, 0, 0);
        expect(w).toBe(-180);
        expect(e).toBe(180);
        expect(n).toBeCloseTo(85.051128, 4);
        expect(s).toBeCloseTo(-85.051128, 4);
    });

    it('computes z1 quadrants', () => {
        const nw = tileToBBox(1, 0, 0);
        expect(nw[0]).toBe(-180);
        expect(nw[2]).toBe(0);
        expect(nw[1]).toBeCloseTo(0, 6);
        const se = tileToBBox(1, 1, 1);
        expect(se[0]).toBe(0);
        expect(se[3]).toBeCloseTo(0, 6);
    });

    it('locates Salt Lake City in the right z12 tile', () => {
        // SLC ~ (-111.89, 40.76) → z12 tile x=774, y=1539
        const bbox = tileToBBox(12, 774, 1539);
        expect(bboxIntersects(bbox, [-111.9, 40.75, -111.88, 40.77])).toBe(true);
    });

    it('padBBox expands symmetrically', () => {
        const padded = padBBox([0, 0, 10, 10], 0.1);
        expect(padded).toEqual([-1, -1, 11, 11]);
    });

    it('featureBBox computes and caches', () => {
        const f = pt(5, 6);
        expect(featureBBox(f)).toEqual([5, 6, 5, 6]);
        expect(f.__bbox).toEqual([5, 6, 5, 6]);
        expect(featureBBox({ type: 'Feature', geometry: null, properties: {} })).toBeNull();
    });

    it('degreesPerPixel halves per zoom', () => {
        expect(degreesPerPixel(1)).toBeCloseTo(degreesPerPixel(0) / 2);
    });
});

describe('selectTileFeatures', () => {
    const tileBbox = [-112, 40, -111, 41];

    it('keeps features inside and drops features outside', () => {
        const chunks = [{ features: [pt(-111.5, 40.5, { id: 1 }), pt(-100, 30, { id: 2 })] }];
        const { features } = selectTileFeatures(chunks, tileBbox, 12);
        expect(features.map((f) => f.properties.id)).toEqual([1]);
    });

    it('drops sub-pixel polygons at low zoom but keeps them at high zoom', () => {
        const tinyPoly = {
            type: 'Feature',
            properties: { id: 'tiny' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[-111.5, 40.5], [-111.4999, 40.5], [-111.4999, 40.5001], [-111.5, 40.5]]]
            }
        };
        const low = selectTileFeatures([{ features: [tinyPoly] }], tileBbox, 4);
        expect(low.features).toHaveLength(0);
        const high = selectTileFeatures([{ features: [tinyPoly] }], tileBbox, 16);
        expect(high.features).toHaveLength(1);
    });

    it('always keeps points regardless of zoom', () => {
        const { features } = selectTileFeatures([{ features: [pt(-111.5, 40.5)] }], tileBbox, 0);
        expect(features).toHaveLength(1);
    });

    it('stride-samples evenly above the cap', () => {
        const many = [];
        for (let i = 0; i < 1000; i++) many.push(pt(-111.5, 40.5, { i }));
        const { features, sampled, candidateCount } = selectTileFeatures(
            [{ features: many }], tileBbox, 10, { maxFeatures: 100 }
        );
        expect(sampled).toBe(true);
        expect(candidateCount).toBe(1000);
        expect(features).toHaveLength(100);
        // Even spread: first from the head, last from the tail.
        expect(features[0].properties.i).toBe(0);
        expect(features[99].properties.i).toBeGreaterThan(950);
    });
});

describe('sampleChunksForTile', () => {
    it('keeps all chunks when the tile budget already fits', () => {
        const ids = Array.from({ length: 100 }, (_, i) => `c${i}`);
        const { chunkIds, sampled } = sampleChunksForTile(ids, 10_000, { maxFeatures: 20_000, maxChunks: 64 });
        expect(chunkIds).toHaveLength(100);
        expect(sampled).toBe(false);
    });

    it('strides chunks for massive overview tiles', () => {
        // 1M features across 1000 chunks (1000 each) — a z0 tile.
        const ids = Array.from({ length: 1000 }, (_, i) => `c${i}`);
        const { chunkIds, sampled } = sampleChunksForTile(ids, 1_000_000, { maxFeatures: 20_000, maxChunks: 64 });
        expect(sampled).toBe(true);
        expect(chunkIds.length).toBeLessThanOrEqual(64);
        expect(chunkIds[0]).toBe('c0');
        // Spread across the whole range, not just the head.
        expect(Number(chunkIds[chunkIds.length - 1].slice(1))).toBeGreaterThan(900);
    });
});

describe('selectChunksForTile (overlap ranking)', () => {
    const tileBbox = [-111.1, 40.0, -111.0, 40.1];

    it('scores local chunks far above statewide long-line chunks', () => {
        const local = bboxOverlapRatio([-111.08, 40.02, -111.02, 40.08], tileBbox);
        const statewide = bboxOverlapRatio([-120, 36, -108, 42], tileBbox);
        expect(local).toBeGreaterThan(0.2);
        expect(statewide).toBeLessThan(0.01);
        expect(local).toBeGreaterThan(statewide * 20);
    });

    it('prefers local chunks over huge long-line chunk bboxes when the budget is tight', () => {
        const records = [];
        // Many statewide chunks listed first (old insertion/query order).
        for (let i = 0; i < 40; i++) {
            records.push({
                chunkId: `wide-${i}`,
                bbox: [-120, 36, -108, 42],
                featureCount: 1000
            });
        }
        records.push({
            chunkId: 'local-streets',
            bbox: [-111.08, 40.02, -111.02, 40.08],
            featureCount: 800
        });

        const { chunkIds, sampled } = selectChunksForTile(records, tileBbox, {
            maxFeatures: 20_000,
            maxChunks: 8
        });
        expect(sampled).toBe(true);
        expect(chunkIds[0]).toBe('local-streets');
        expect(chunkIds).toContain('local-streets');
    });

    it('keeps a line that crosses the tile even when endpoints are outside', () => {
        const line = {
            type: 'Feature',
            properties: { id: 'cross' },
            geometry: {
                type: 'LineString',
                coordinates: [[-112, 40.05], [-110, 40.05]]
            }
        };
        const { features } = selectTileFeatures([{ features: [line] }], tileBbox, 14);
        expect(features.map((f) => f.properties.id)).toEqual(['cross']);
    });

    it('drops long lines whose envelope covers the tile but miss it geometrically', () => {
        // Envelope overlaps the tile; the diagonal segment itself stays west/south.
        const miss = {
            type: 'Feature',
            properties: { id: 'miss' },
            geometry: {
                type: 'LineString',
                coordinates: [[-112, 40.05], [-110, 39.5]]
            }
        };
        expect(bboxIntersects(featureBBox(miss), tileBbox)).toBe(true);
        expect(geometryIntersectsBBox(miss.geometry, tileBbox)).toBe(false);
        expect(featureBelongsInTile(miss, tileBbox, 14)).toBe(false);
        const { features } = selectTileFeatures([{ features: [miss] }], tileBbox, 14);
        expect(features).toHaveLength(0);
    });

    it('disables mass early-stop and raises chunk cap at close zoom', () => {
        const low = chunkLoadBudgetForZoom(8, 400);
        expect(low.highZoom).toBe(false);
        expect(low.useMassBudget).toBe(true);
        expect(low.maxChunks).toBe(64);
        expect(low.hardMaxChunks).toBe(64);

        const high = chunkLoadBudgetForZoom(14, 400);
        expect(high.highZoom).toBe(true);
        expect(high.useMassBudget).toBe(false);
        expect(high.maxChunks).toBe(400);
        expect(high.hardMaxChunks).toBe(400);
        expect(high.localOverlapFloor).toBeGreaterThan(0);
        expect(high.lowOverlapBudget).toBe(256);

        const capped = chunkLoadBudgetForZoom(16, 8000);
        expect(capped.maxChunks).toBe(512);
        expect(capped.hardMaxChunks).toBe(2048);
        expect(capped.sparseCandidateFloor).toBe(64);
    });

    it('at close zoom finishes local chunks then caps low-overlap fan-out', () => {
        // Still on high-overlap (local) chunk — always continue.
        expect(shouldContinueChunkScan({
            highZoom: true,
            loadedCount: 10,
            rankedCount: 8000,
            candidateCount: 80,
            maxChunks: 512,
            hardMaxChunks: 2048,
            nextChunkScore: 0.5,
            localOverlapFloor: 0.02,
            lowOverlapLoaded: 0,
            lowOverlapBudget: 256
        })).toBe(true);

        // Low-overlap remaining under budget — continue (crossing lines).
        expect(shouldContinueChunkScan({
            highZoom: true,
            loadedCount: 100,
            rankedCount: 8000,
            candidateCount: 80,
            maxChunks: 512,
            hardMaxChunks: 2048,
            nextChunkScore: 0.001,
            localOverlapFloor: 0.02,
            lowOverlapLoaded: 100,
            lowOverlapBudget: 256
        })).toBe(true);

        // Low-overlap budget exhausted — stop (do not scan thousands of statewide chunks).
        expect(shouldContinueChunkScan({
            highZoom: true,
            loadedCount: 400,
            rankedCount: 8000,
            candidateCount: 80,
            maxChunks: 512,
            hardMaxChunks: 2048,
            nextChunkScore: 0.001,
            localOverlapFloor: 0.02,
            lowOverlapLoaded: 256,
            lowOverlapBudget: 256
        })).toBe(false);

        // Ranked list exhausted.
        expect(shouldContinueChunkScan({
            highZoom: true,
            loadedCount: 8000,
            rankedCount: 8000,
            candidateCount: 80,
            maxChunks: 512,
            hardMaxChunks: 8000
        })).toBe(false);
    });

    it('dedupes multi-cell copies of the same _featureIndex', () => {
        const tileBbox = [-111.1, 40.0, -111.0, 40.1];
        const line = {
            type: 'Feature',
            properties: { id: 'road', _featureIndex: 42 },
            geometry: {
                type: 'LineString',
                coordinates: [[-111.08, 40.05], [-111.02, 40.05]]
            }
        };
        const { features, candidateCount } = selectTileFeatures(
            [{ features: [line] }, { features: [{ ...line }] }],
            tileBbox,
            14
        );
        expect(candidateCount).toBe(1);
        expect(features).toHaveLength(1);
    });

    it('keeps multi-tile spanning lines when truncating an oversized tile', () => {
        const tileBbox = [-111.1, 40.0, -111.0, 40.1];
        const features = [];
        for (let i = 0; i < 50; i++) {
            features.push({
                type: 'Feature',
                properties: { id: `local-${i}` },
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [-111.08, 40.02 + i * 0.001],
                        [-111.02, 40.03 + i * 0.001]
                    ]
                }
            });
        }
        // Long lines that cross the tile E–W / N–S.
        for (let i = 0; i < 10; i++) {
            features.push({
                type: 'Feature',
                properties: { id: `span-${i}` },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-112, 40.05 + i * 0.002], [-110, 40.05 + i * 0.002]]
                }
            });
        }
        const kept = preferCrossingThenLocalFeatures(features, tileBbox, 20);
        const ids = kept.map((f) => f.properties.id);
        expect(ids.filter((id) => id.startsWith('span-'))).toHaveLength(10);
        expect(kept).toHaveLength(20);
    });

    it('selectChunksForTile can ignore mass budget so late local chunks are reached', () => {
        const records = [];
        for (let i = 0; i < 80; i++) {
            records.push({
                chunkId: `wide-${String(i).padStart(3, '0')}`,
                bbox: [-120, 36, -108, 42],
                featureCount: 1000
            });
        }
        // Same overlap score as the statewide chunks; sorts after wide-* by id.
        records.push({
            chunkId: 'wide-zzz-needle',
            bbox: [-120, 36, -108, 42],
            featureCount: 5
        });

        const withMass = selectChunksForTile(records, tileBbox, {
            maxFeatures: 20_000,
            maxChunks: 64,
            useMassBudget: true
        });
        // 40 chunks × 1000 features hits the mass stop before the needle.
        expect(withMass.chunkIds).not.toContain('wide-zzz-needle');

        const noMass = selectChunksForTile(records, tileBbox, {
            maxFeatures: 20_000,
            maxChunks: 512,
            useMassBudget: false
        });
        expect(noMass.chunkIds).toContain('wide-zzz-needle');
    });

    it('prefers compact local features when the candidate set is over the cap', () => {
        const local = {
            type: 'Feature',
            properties: { id: 'local' },
            geometry: {
                type: 'LineString',
                coordinates: [[-111.05, 40.05], [-111.04, 40.05]]
            }
        };
        const wide = [];
        for (let i = 0; i < 50; i++) {
            wide.push({
                type: 'Feature',
                properties: { id: `wide-${i}` },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-112, 40.05], [-110, 40.05]]
                }
            });
        }
        const picked = preferLocalFeatures([...wide, local], 5);
        expect(picked.some((f) => f.properties.id === 'local')).toBe(true);
    });
});

describe('geometryIntersectsBBox', () => {
    const tileBbox = [-111.1, 40.0, -111.0, 40.1];

    it('detects segment crossings of the tile edge', () => {
        expect(segmentIntersectsBBox(-111.2, 40.05, -110.9, 40.05, tileBbox)).toBe(true);
        expect(segmentIntersectsBBox(-111.2, 39.0, -110.9, 39.0, tileBbox)).toBe(false);
    });

    it('keeps polygons that fully contain the tile', () => {
        const poly = {
            type: 'Polygon',
            coordinates: [[
                [-112, 39], [-110, 39], [-110, 41], [-112, 41], [-112, 39]
            ]]
        };
        expect(geometryIntersectsBBox(poly, tileBbox)).toBe(true);
    });
});

describe('simplifyToleranceForZoom', () => {
    it('disables simplification at high detail zooms', () => {
        expect(simplifyToleranceForZoom(10)).toBe(3);
        expect(simplifyToleranceForZoom(14)).toBe(0);
        expect(simplifyToleranceForZoom(16)).toBe(0);
    });
});

describe('buildTileFromFeatures', () => {
    it('encodes a point with properties into a decodable MVT', () => {
        const bytes = buildTileFromFeatures(
            [pt(-111.89, 40.76, { name: 'SLC', _featureIndex: 7, _datasetId: 'ds_1' })],
            12, 774, 1539
        );
        expect(bytes).toBeInstanceOf(Uint8Array);
        const features = decodeTile(bytes);
        expect(features).toHaveLength(1);
        expect(features[0].properties.name).toBe('SLC');
        expect(features[0].properties._featureIndex).toBe(7);
        expect(features[0].properties._datasetId).toBe('ds_1');
        // Geometry round-trip
        const geo = features[0].toGeoJSON(774, 1539, 12);
        expect(geo.geometry.coordinates[0]).toBeCloseTo(-111.89, 2);
        expect(geo.geometry.coordinates[1]).toBeCloseTo(40.76, 2);
    });

    it('returns null for empty input and for tiles with no intersecting features', () => {
        expect(buildTileFromFeatures([], 5, 1, 1)).toBeNull();
        expect(buildTileFromFeatures([pt(-111.89, 40.76)], 12, 0, 0)).toBeNull();
    });

    it('clips polygons that straddle the tile edge', () => {
        // Polygon spanning two z12 tiles — each tile gets a clipped piece.
        const poly = {
            type: 'Feature',
            properties: { id: 'p' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-111.95, 40.74], [-111.80, 40.74], [-111.80, 40.78], [-111.95, 40.78], [-111.95, 40.74]
                ]]
            }
        };
        const a = buildTileFromFeatures([poly], 12, 774, 1539);
        const b = buildTileFromFeatures([poly], 12, 775, 1539);
        expect(a).toBeInstanceOf(Uint8Array);
        expect(b).toBeInstanceOf(Uint8Array);
        expect(decodeTile(a)[0].properties.id).toBe('p');
        expect(decodeTile(b)[0].properties.id).toBe('p');
    });

    it('handles many features quickly', () => {
        const many = [];
        for (let i = 0; i < 20_000; i++) {
            many.push(pt(-112 + (i % 200) * 0.005, 40 + Math.floor(i / 200) * 0.005, { i }));
        }
        const start = Date.now();
        const bytes = buildTileFromFeatures(many, 8, 48, 96);
        const elapsed = Date.now() - start;
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(decodeTile(bytes).length).toBeGreaterThan(1000);
        expect(elapsed).toBeLessThan(3000);
    });
});
