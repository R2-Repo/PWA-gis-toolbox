/**
 * Store-backed selection helpers for workspace / tiled layers.
 * Box-select and highlights must not depend on the empty in-memory GeoJSON
 * FeatureCollection used by vector-tile map entries.
 */
import { buildViewportGeoJSON } from '../workspace/viewport-loader.js';
import { getWorkspaceFeaturesByIndices, getWorkspaceFeatureByIndex } from '../workspace/workspace-store.js';
import { featureIntersectsGeographicBbox } from './map-interaction-utils.js';

/** Max features collected from IndexedDB for one box-select. */
export const WORKSPACE_BOX_SELECT_MAX_FEATURES = 50_000;

/** Max geometries drawn in the cyan selection overlay. */
export const SELECTION_HIGHLIGHT_MAX_FEATURES = 5_000;

/**
 * @param {object|null|undefined} mapEntry dataLayers entry
 * @returns {boolean}
 */
export function mapEntryNeedsStoreSelection(mapEntry) {
    if (!mapEntry) return false;
    if (mapEntry.tiled) return true;
    if (mapEntry.workspace && !(mapEntry.geojson?.features?.length > 0)) return true;
    return false;
}

/**
 * Query workspace features intersecting a geographic bbox (for box-select).
 *
 * @param {string} workspaceLayerId
 * @param {[number, number, number, number]} bbox [west,south,east,north]
 * @param {{ maxFeatures?: number, turfLib?: object|null }} [opts]
 * @returns {Promise<{ indices: number[], features: object[], truncated: boolean }>}
 */
export async function queryWorkspaceIndicesInBbox(workspaceLayerId, bbox, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? WORKSPACE_BOX_SELECT_MAX_FEATURES;
    const turfLib = opts.turfLib ?? (typeof globalThis !== 'undefined' ? globalThis.turf : null);

    const packet = await buildViewportGeoJSON(workspaceLayerId, bbox, {
        maxFeatures,
        maxVertices: Number.POSITIVE_INFINITY,
        padFraction: 0,
        prioritizeCenter: false
    });

    const indices = [];
    const features = [];
    const seen = new Set();
    for (const f of packet.features || []) {
        if (!f?.geometry) continue;
        const idx = Number(f.properties?._featureIndex);
        if (!Number.isFinite(idx) || seen.has(idx)) continue;
        // buildViewportGeoJSON already geometry-filters; keep a turf parity check
        // when available so box-select matches memory-layer behavior.
        if (turfLib && !featureIntersectsGeographicBbox(f, bbox, turfLib)) continue;
        seen.add(idx);
        indices.push(idx);
        features.push(f);
    }

    return {
        indices,
        features,
        truncated: !!packet.truncated || (packet.candidateCount || 0) > features.length
    };
}

/**
 * Load geometries for selection highlight overlays.
 *
 * @param {string} workspaceLayerId
 * @param {Iterable<number>|number[]} indices
 * @param {{ maxFeatures?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function loadWorkspaceSelectionFeatures(workspaceLayerId, indices, opts = {}) {
    const maxFeatures = opts.maxFeatures ?? SELECTION_HIGHLIGHT_MAX_FEATURES;
    const list = [...indices].map(Number).filter(Number.isFinite);
    if (!list.length) return [];
    const capped = list.length > maxFeatures ? list.slice(0, maxFeatures) : list;
    return getWorkspaceFeaturesByIndices(workspaceLayerId, capped, { includeCold: false });
}

/**
 * Resolve one feature for click highlight when the map entry has no GeoJSON.
 *
 * @param {string} workspaceLayerId
 * @param {number} featureIndex
 * @param {object|null} [geometryHint] geometry from the clicked vector-tile feature
 * @returns {Promise<object|null>}
 */
export async function resolveWorkspaceHighlightFeature(workspaceLayerId, featureIndex, geometryHint = null) {
    const idx = Number(featureIndex);
    if (!Number.isFinite(idx)) return null;
    try {
        const feature = await getWorkspaceFeatureByIndex(workspaceLayerId, idx, { includeCold: false });
        if (feature?.geometry) return feature;
    } catch { /* fall through to hint */ }
    if (geometryHint) {
        return {
            type: 'Feature',
            geometry: geometryHint,
            properties: { _featureIndex: idx }
        };
    }
    return null;
}

export default {
    WORKSPACE_BOX_SELECT_MAX_FEATURES,
    SELECTION_HIGHLIGHT_MAX_FEATURES,
    mapEntryNeedsStoreSelection,
    queryWorkspaceIndicesInBbox,
    loadWorkspaceSelectionFeatures,
    resolveWorkspaceHighlightFeature
};
