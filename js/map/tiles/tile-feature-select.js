/**
 * Select the features that belong in one tile, with bounded output:
 * bbox intersection, sub-pixel dropping at low zooms, and stride sampling
 * when candidates exceed the per-tile cap. Pure module.
 */
import { bboxIntersects, featureBBox, degreesPerPixel } from './tile-math.js';
import { MAX_TILE_FEATURES, MIN_FEATURE_PIXELS } from './tile-constants.js';

const POINTY = new Set(['Point', 'MultiPoint']);

/**
 * @param {Array<{ features: object[] }>} chunks parsed workspace chunks
 * @param {[number,number,number,number]} tileBbox padded tile bounds (lon/lat)
 * @param {number} z tile zoom
 * @param {{ maxFeatures?: number, minFeaturePixels?: number }} [opts]
 * @returns {{ features: object[], candidateCount: number, sampled: boolean }}
 */
export function selectTileFeatures(chunks, tileBbox, z, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? MAX_TILE_FEATURES;
    const minSpanDeg = degreesPerPixel(z) * (opts.minFeaturePixels ?? MIN_FEATURE_PIXELS);

    const candidates = [];
    for (const chunk of chunks) {
        for (const feature of chunk.features || []) {
            const bbox = featureBBox(feature);
            if (!bbox) continue;
            if (!bboxIntersects(bbox, tileBbox)) continue;
            if (!POINTY.has(feature.geometry.type)) {
                // Sub-pixel line/polygon at this zoom — invisible, skip.
                const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
                if (span < minSpanDeg) continue;
            }
            candidates.push(feature);
        }
    }

    if (candidates.length <= maxFeatures) {
        return { features: candidates, candidateCount: candidates.length, sampled: false };
    }

    // Even stride sampling keeps the spatial impression at overview zooms.
    const stride = candidates.length / maxFeatures;
    const sampled = new Array(maxFeatures);
    for (let i = 0; i < maxFeatures; i++) {
        sampled[i] = candidates[Math.floor(i * stride)];
    }
    return { features: sampled, candidateCount: candidates.length, sampled: true };
}

/**
 * Chunk-level sampling for overview tiles: when the tile intersects far more
 * data than one tile can show, load an evenly-strided subset of chunks.
 * @param {string[]} chunkIds spatially ordered chunk ids
 * @param {number} totalFeatureEstimate
 * @param {{ maxFeatures?: number, maxChunks?: number, avgChunkSize?: number }} [opts]
 * @returns {{ chunkIds: string[], sampled: boolean }}
 */
export function sampleChunksForTile(chunkIds, totalFeatureEstimate, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? MAX_TILE_FEATURES;
    const maxChunks = opts.maxChunks ?? 64;

    let ids = chunkIds;
    let sampled = false;

    // Everything fits in the tile budget — load all chunks (no data loss).
    if (totalFeatureEstimate <= maxFeatures) {
        return { chunkIds: ids, sampled };
    }

    // Load roughly 2× the feature cap so stride sampling has healthy input.
    if (totalFeatureEstimate > maxFeatures * 2 && chunkIds.length > 1) {
        const keepRatio = (maxFeatures * 2) / totalFeatureEstimate;
        const keepCount = Math.max(1, Math.round(chunkIds.length * keepRatio));
        if (keepCount < chunkIds.length) {
            const stride = chunkIds.length / keepCount;
            ids = new Array(keepCount);
            for (let i = 0; i < keepCount; i++) {
                ids[i] = chunkIds[Math.floor(i * stride)];
            }
            sampled = true;
        }
    }

    if (ids.length > maxChunks) {
        const stride = ids.length / maxChunks;
        const out = new Array(maxChunks);
        for (let i = 0; i < maxChunks; i++) {
            out[i] = ids[Math.floor(i * stride)];
        }
        ids = out;
        sampled = true;
    }

    return { chunkIds: ids, sampled };
}

export default { selectTileFeatures, sampleChunksForTile };
