/**
 * Select the features that belong in one tile, with bounded output:
 * bbox intersection, sub-pixel dropping at low zooms, and stride sampling
 * when candidates exceed the per-tile cap. Pure module.
 *
 * Chunk selection ranks by overlap with the tile so huge long-line chunk
 * bboxes do not starve chunks that actually contain local geometry.
 * Feature membership uses geometry∩tile (not just envelope) so long lines
 * whose bbox covers a tile but miss it do not crowd out real hits.
 */
import { bboxIntersects, featureBBox, degreesPerPixel, geometryIntersectsBBox } from './tile-math.js';
import {
    MAX_TILE_FEATURES,
    MIN_FEATURE_PIXELS,
    MAX_CHUNKS_PER_TILE,
    HIGH_ZOOM_CHUNK_SCAN_ZOOM,
    MAX_CHUNKS_PER_TILE_HIGH_ZOOM,
    HIGH_ZOOM_SPARSE_CANDIDATE_FLOOR,
    MAX_CHUNKS_PER_TILE_HIGH_ZOOM_HARD
} from './tile-constants.js';

const POINTY = new Set(['Point', 'MultiPoint']);

/**
 * Intersection-area / chunk-area. Statewide long-line chunks score near 0 for
 * a small tile; local street chunks score near 1.
 * @param {[number,number,number,number]} chunkBbox
 * @param {[number,number,number,number]} tileBbox
 * @returns {number}
 */
export function bboxOverlapRatio(chunkBbox, tileBbox) {
    if (!chunkBbox || !tileBbox) return 0;
    const [cw, cs, ce, cn] = chunkBbox;
    const [tw, ts, te, tn] = tileBbox;
    const iw = Math.max(0, Math.min(ce, te) - Math.max(cw, tw));
    const ih = Math.max(0, Math.min(cn, tn) - Math.max(cs, ts));
    const inter = iw * ih;
    if (inter <= 0) return 0;
    const chunkArea = Math.max(1e-18, (ce - cw) * (cn - cs));
    return inter / chunkArea;
}

/**
 * @param {Array<{ chunkId: string, bbox: number[], featureCount?: number }>} chunkRecords
 * @param {[number,number,number,number]} tileBbox
 * @returns {Array<{ chunkId: string, bbox: number[], featureCount: number, score: number }>}
 */
export function rankChunksByOverlap(chunkRecords, tileBbox) {
    return (chunkRecords || [])
        .map((rec) => ({
            chunkId: rec.chunkId,
            bbox: rec.bbox,
            featureCount: rec.featureCount || 0,
            score: bboxOverlapRatio(rec.bbox, tileBbox)
        }))
        .filter((rec) => rec.score > 0 && rec.chunkId)
        .sort((a, b) => b.score - a.score || String(a.chunkId).localeCompare(String(b.chunkId)));
}

/**
 * Chunk-load budget for a tile zoom. High zooms scan far more chunks and skip
 * feature-mass early-stop (mass is a bad proxy when every chunk bbox is huge).
 *
 * @param {number} z
 * @param {number} rankedCount
 * @param {{ maxChunks?: number, maxChunksHighZoom?: number, highZoomScanZoom?: number }} [opts]
 */
export function chunkLoadBudgetForZoom(z, rankedCount, opts = {}) {
    const highZoomScanZoom = opts.highZoomScanZoom ?? HIGH_ZOOM_CHUNK_SCAN_ZOOM;
    const highZoom = z >= highZoomScanZoom;
    const maxChunksCap = highZoom
        ? (opts.maxChunksHighZoom ?? MAX_CHUNKS_PER_TILE_HIGH_ZOOM)
        : (opts.maxChunks ?? MAX_CHUNKS_PER_TILE);
    // Close zoom: always allow exhausting the ranked list. A fixed hard cap
    // (even 4k) still misses Build-11 long-line layers with huge bbox fan-out.
    const hardMaxChunksCap = highZoom
        ? (opts.maxChunksHighZoomHard ?? rankedCount)
        : maxChunksCap;
    return {
        highZoom,
        maxChunks: Math.min(Math.max(0, rankedCount), maxChunksCap),
        hardMaxChunks: Math.min(Math.max(0, rankedCount), Math.max(0, hardMaxChunksCap)),
        sparseCandidateFloor: opts.sparseCandidateFloor ?? HIGH_ZOOM_SPARSE_CANDIDATE_FLOOR,
        useMassBudget: !highZoom
    };
}

/**
 * Progressive chunk scan stop condition.
 *
 * High zoom: keep loading until every ranked chunk is tried or the per-tile
 * feature cap is full. Do NOT stop just because a few local features were
 * found — that hid long multi-tile lines sitting later in the ranked list.
 *
 * Overview: soft chunk + feature-mass budgets (unchanged).
 *
 * @param {{
 *   highZoom?: boolean,
 *   loadedCount: number,
 *   rankedCount: number,
 *   candidateCount: number,
 *   maxChunks: number,
 *   hardMaxChunks?: number,
 *   maxFeatures?: number,
 *   sparseCandidateFloor?: number,
 *   useMassBudget?: boolean,
 *   estimatedFeatureMass?: number,
 *   targetMass?: number
 * }} state
 * @returns {boolean}
 */
export function shouldContinueChunkScan(state = {}) {
    const loadedCount = state.loadedCount || 0;
    const rankedCount = state.rankedCount || 0;
    const candidateCount = state.candidateCount || 0;
    const maxChunks = state.maxChunks ?? MAX_CHUNKS_PER_TILE;
    const hardMaxChunks = state.hardMaxChunks ?? maxChunks;
    const maxFeatures = state.maxFeatures ?? MAX_TILE_FEATURES;

    if (loadedCount >= rankedCount) return false;
    if (loadedCount >= hardMaxChunks) return false;

    if (state.highZoom) {
        // Do not stop when candidateCount hits maxFeatures mid-scan — later
        // ranked chunks often hold the multi-tile spanning lines. Truncate
        // after the full scan with preferCrossingThenLocalFeatures.
        return true;
    }

    if (candidateCount >= maxFeatures) return false;
    if (loadedCount >= maxChunks) return false;
    if (state.useMassBudget
        && (state.estimatedFeatureMass || 0) >= (state.targetMass ?? maxFeatures * 2)
        && loadedCount > 0) {
        return false;
    }
    return true;
}

/**
 * Decide which chunks to load for a tile. Prefers high tile-overlap chunks and
 * stops once enough feature mass is queued for the per-tile cap (overview only).
 *
 * @param {Array<{ chunkId: string, bbox: number[], featureCount?: number }>} chunkRecords
 * @param {[number,number,number,number]} tileBbox
 * @param {{ maxFeatures?: number, maxChunks?: number, useMassBudget?: boolean }} [opts]
 * @returns {{ chunkIds: string[], sampled: boolean, rankedCount: number }}
 */
export function selectChunksForTile(chunkRecords, tileBbox, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? MAX_TILE_FEATURES;
    const maxChunks = opts.maxChunks ?? MAX_CHUNKS_PER_TILE;
    const useMassBudget = opts.useMassBudget !== false;
    const ranked = rankChunksByOverlap(chunkRecords, tileBbox);
    if (!ranked.length) {
        return { chunkIds: [], sampled: false, rankedCount: 0 };
    }

    const totalEstimate = ranked.reduce((sum, rec) => sum + rec.featureCount, 0);
    if (totalEstimate <= maxFeatures && ranked.length <= maxChunks) {
        return {
            chunkIds: ranked.map((rec) => rec.chunkId),
            sampled: false,
            rankedCount: ranked.length
        };
    }

    const selected = [];
    let estimate = 0;
    const targetMass = maxFeatures * 2;
    for (const rec of ranked) {
        if (selected.length >= maxChunks) break;
        if (useMassBudget && estimate >= targetMass && selected.length > 0) break;
        selected.push(rec.chunkId);
        estimate += rec.featureCount;
    }

    // Long-line layers: every chunk can score similarly low. Still take the
    // top-ranked maxChunks so crossing lines have a chance to appear.
    if (!selected.length) {
        selected.push(...ranked.slice(0, Math.min(maxChunks, ranked.length)).map((r) => r.chunkId));
    }

    return {
        chunkIds: selected,
        sampled: selected.length < ranked.length,
        rankedCount: ranked.length
    };
}

/**
 * @param {object} feature
 * @param {[number,number,number,number]} tileBbox
 * @param {number} z
 * @param {number} minSpanDeg
 * @returns {boolean}
 */
export function featureBelongsInTile(feature, tileBbox, z, minSpanDeg = null) {
    const bbox = featureBBox(feature);
    if (!bbox) return false;
    // Fast reject on envelope, then require real geometry∩tile so long lines
    // whose envelope covers the tile but miss it do not crowd the budget.
    if (!bboxIntersects(bbox, tileBbox)) return false;
    if (!geometryIntersectsBBox(feature.geometry, tileBbox)) return false;
    const spanMin = minSpanDeg ?? (degreesPerPixel(z) * MIN_FEATURE_PIXELS);
    if (!POINTY.has(feature.geometry?.type)) {
        const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
        if (span < spanMin) return false;
    }
    return true;
}

/**
 * Prefer compact (local) features when stride-sampling an oversized candidate
 * set — statewide long-line envelopes otherwise dominate and geojson-vt clips
 * them all away, leaving an empty tile.
 * @param {object[]} features
 * @param {number} maxFeatures
 */
export function preferLocalFeatures(features, maxFeatures) {
    if (features.length <= maxFeatures) return features;
    const ranked = features
        .map((feature, index) => {
            const bbox = featureBBox(feature);
            // Use max span (not area): pure E–W / N–S lines have zero area.
            const span = bbox
                ? Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1])
                : Number.POSITIVE_INFINITY;
            return { feature, index, span };
        })
        .sort((a, b) => a.span - b.span || a.index - b.index);
    return ranked.slice(0, maxFeatures).map((row) => row.feature);
}

/**
 * True when a feature's envelope clearly spans across the tile (typical of
 * long lines that cross multiple tiles).
 * @param {object} feature
 * @param {[number,number,number,number]} tileBbox
 */
export function featureCrossesTile(feature, tileBbox) {
    const bbox = featureBBox(feature);
    if (!bbox || !tileBbox) return false;
    const [cw, cs, ce, cn] = bbox;
    const [tw, ts, te, tn] = tileBbox;
    const crossesEW = cw < tw && ce > te;
    const crossesNS = cs < ts && cn > tn;
    return crossesEW || crossesNS;
}

/**
 * Close-zoom truncation: keep multi-tile-spanning lines first, then fill with
 * compact local features. `preferLocalFeatures` alone demoted long lines and
 * dropped them when the per-tile cap was hit.
 *
 * @param {object[]} features
 * @param {[number,number,number,number]} tileBbox
 * @param {number} maxFeatures
 */
export function preferCrossingThenLocalFeatures(features, tileBbox, maxFeatures) {
    if (features.length <= maxFeatures) return features;
    const crossing = [];
    const local = [];
    for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        if (featureCrossesTile(feature, tileBbox)) crossing.push(feature);
        else local.push(feature);
    }
    if (crossing.length >= maxFeatures) {
        // Still too many spanning lines — keep a stable prefix.
        return crossing.slice(0, maxFeatures);
    }
    const room = maxFeatures - crossing.length;
    return crossing.concat(preferLocalFeatures(local, room));
}

/**
 * @param {Array<{ features: object[] }>} chunks parsed workspace chunks
 * @param {[number,number,number,number]} tileBbox padded tile bounds (lon/lat)
 * @param {number} z tile zoom
 * @param {{ maxFeatures?: number, minFeaturePixels?: number, preferLocal?: boolean, preferCrossing?: boolean }} [opts]
 * @returns {{ features: object[], candidateCount: number, sampled: boolean }}
 */
export function selectTileFeatures(chunks, tileBbox, z, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? MAX_TILE_FEATURES;
    const minSpanDeg = degreesPerPixel(z) * (opts.minFeaturePixels ?? MIN_FEATURE_PIXELS);
    const highZoom = z >= HIGH_ZOOM_CHUNK_SCAN_ZOOM;
    const preferCrossing = opts.preferCrossing ?? highZoom;
    const preferLocal = opts.preferLocal ?? (!preferCrossing && highZoom);

    const candidates = [];
    for (const chunk of chunks) {
        for (const feature of chunk.features || []) {
            if (!featureBelongsInTile(feature, tileBbox, z, minSpanDeg)) continue;
            candidates.push(feature);
        }
    }

    if (candidates.length <= maxFeatures) {
        return { features: candidates, candidateCount: candidates.length, sampled: false };
    }

    if (preferCrossing) {
        return {
            features: preferCrossingThenLocalFeatures(candidates, tileBbox, maxFeatures),
            candidateCount: candidates.length,
            sampled: true
        };
    }

    if (preferLocal) {
        return {
            features: preferLocalFeatures(candidates, maxFeatures),
            candidateCount: candidates.length,
            sampled: true
        };
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
 * Legacy even-stride chunk sampler (kept for tests / callers). Prefer
 * {@link selectChunksForTile} which ranks by spatial overlap.
 * @param {string[]} chunkIds
 * @param {number} totalFeatureEstimate
 * @param {{ maxFeatures?: number, maxChunks?: number }} [opts]
 */
export function sampleChunksForTile(chunkIds, totalFeatureEstimate, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? MAX_TILE_FEATURES;
    const maxChunks = opts.maxChunks ?? MAX_CHUNKS_PER_TILE;

    let ids = chunkIds;
    let sampled = false;

    if (totalFeatureEstimate <= maxFeatures) {
        return { chunkIds: ids, sampled };
    }

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

export default {
    bboxOverlapRatio,
    rankChunksByOverlap,
    chunkLoadBudgetForZoom,
    shouldContinueChunkScan,
    selectChunksForTile,
    featureBelongsInTile,
    featureCrossesTile,
    preferLocalFeatures,
    preferCrossingThenLocalFeatures,
    selectTileFeatures,
    sampleChunksForTile
};
