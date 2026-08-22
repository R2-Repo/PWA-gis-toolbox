/**
 * Clip UDOT Fiber live features to sheet polygons for editable map layers.
 * Pure helpers — no DOM, no mapService.
 */

import { clipFeaturesToSheetFrame } from './export-builder.js';
import {
    matchUdotFiberLayerUrl,
    SHEET_FIBER_SNAPSHOT_FORMAT,
    UDOT_FIBER_LAYER_BY_KEY
} from '../../symbology/udot-fiber/constants.js';
import { filterUdotFiberDisplayFeatures } from '../../symbology/udot-fiber/display-filters.js';
import { isUdotFiberLiveDataset } from '../../symbology/udot-fiber/hover-fields.js';

export { SHEET_FIBER_SNAPSHOT_FORMAT };

const DROP_PROPS = new Set([
    '_datasetId',
    '_sourceLayerId',
    '_udotDisplayOffsetM',
    '_udotGlyph',
    '_udotEsriWidth',
    '_udotBoxLabel',
    '_udotFiberKey'
]);

/**
 * @param {object} feature
 * @param {number} [fallbackIndex]
 * @returns {string}
 */
export function featureStableId(feature, fallbackIndex = 0) {
    const props = feature?.properties || {};
    const raw = props.OBJECTID ?? props.objectid ?? props.FID ?? props.fid ?? props._featureIndex;
    if (raw != null && raw !== '') return String(raw);
    return `idx-${fallbackIndex}`;
}

/**
 * @param {object} feature
 * @returns {object}
 */
export function stripLiveFiberDisplayProps(feature) {
    const properties = { ...(feature?.properties || {}) };
    for (const key of DROP_PROPS) delete properties[key];
    return { ...feature, properties };
}

/**
 * @param {object[]} features
 * @returns {{ west: number, south: number, east: number, north: number }|null}
 */
export function envelopeFromFeatures(features) {
    if (!features?.length || typeof turf === 'undefined') return null;
    try {
        const bbox = turf.bbox({ type: 'FeatureCollection', features });
        if (!bbox.every(Number.isFinite)) return null;
        return { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] };
    } catch {
        return null;
    }
}

/**
 * @param {object[]} [frameFeatures]
 * @returns {object|null}
 */
export function unionSheetFrameCoverage(frameFeatures = []) {
    const polys = (frameFeatures || []).filter((feature) => {
        const type = feature?.geometry?.type;
        return type === 'Polygon' || type === 'MultiPolygon';
    });
    if (!polys.length) return null;
    if (polys.length === 1) return polys[0];
    if (typeof turf === 'undefined') return null;

    try {
        let acc = polys[0];
        for (let i = 1; i < polys.length; i++) {
            const merged = turf.union(turf.featureCollection([acc, polys[i]]));
            if (merged?.geometry) acc = merged;
        }
        return acc;
    } catch {
        return {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'MultiPolygon',
                coordinates: polys.flatMap((feature) => (
                    feature.geometry.type === 'Polygon'
                        ? [feature.geometry.coordinates]
                        : (feature.geometry.coordinates || [])
                ))
            }
        };
    }
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {object}
 */
function mergeClippedFeatures(a, b) {
    try {
        const combined = turf.combine(turf.featureCollection([a, b]));
        const next = combined.features?.[0];
        if (next?.geometry) {
            return {
                ...a,
                geometry: next.geometry,
                properties: { ...a.properties, ...b.properties }
            };
        }
    } catch {
        /* keep first piece */
    }
    return a;
}

/**
 * Clip Fiber features to the union of sheet polygons (whole-project coverage).
 * @param {object[]} [features]
 * @param {object[]} [frameFeatures]
 * @returns {object[]}
 */
export function clipFeaturesToSheetCoverage(features = [], frameFeatures = []) {
    const coverage = unionSheetFrameCoverage(frameFeatures);
    if (coverage) {
        return clipFeaturesToSheetFrame(coverage, features).map(stripLiveFiberDisplayProps);
    }

    const byId = new Map();
    (frameFeatures || []).forEach((frame, frameIndex) => {
        for (const clipped of clipFeaturesToSheetFrame(frame, features)) {
            const id = featureStableId(clipped, frameIndex);
            const cleaned = stripLiveFiberDisplayProps(clipped);
            const prev = byId.get(id);
            byId.set(id, prev ? mergeClippedFeatures(prev, cleaned) : cleaned);
        }
    });
    return [...byId.values()];
}

/**
 * @param {string} [projectName]
 * @param {string} [liveLayerName]
 * @param {string} [fiberKey]
 * @returns {string}
 */
export function buildSheetFiberOperationalName(projectName, liveLayerName, fiberKey) {
    const base = String(projectName || 'Sheets').trim() || 'Sheets';
    const live = String(liveLayerName || UDOT_FIBER_LAYER_BY_KEY[fiberKey]?.name || fiberKey || 'Fiber').trim();
    return `${base} ${live}`;
}

/**
 * @param {object} input
 * @returns {{ name: string, fiberKey: string, featureCount: number, geojson: object, source: object }}
 */
export function buildSheetFiberOperationalSpec({
    projectName,
    liveLayer,
    fiberKey,
    features
} = {}) {
    const cleaned = filterUdotFiberDisplayFeatures(fiberKey, features || [])
        .map(stripLiveFiberDisplayProps);
    return {
        name: buildSheetFiberOperationalName(projectName, liveLayer?.name, fiberKey),
        fiberKey,
        featureCount: cleaned.length,
        geojson: { type: 'FeatureCollection', features: cleaned },
        source: {
            format: SHEET_FIBER_SNAPSHOT_FORMAT,
            url: liveLayer?.service?.url || liveLayer?.source?.url || '',
            sourceLayerId: liveLayer?.id || null,
            projectName: String(projectName || '').trim() || 'Sheets',
            fiberKey
        }
    };
}

/**
 * @param {object} [layer]
 * @returns {boolean}
 */
export function isSheetFiberSnapshotLayer(layer) {
    return layer?.source?.format === SHEET_FIBER_SNAPSHOT_FORMAT;
}

/**
 * @param {string} [projectName]
 * @param {object[]} [layers]
 * @returns {object[]}
 */
export function listSheetFiberSnapshotLayers(layers = [], projectName = '') {
    const project = String(projectName || '').trim();
    return (layers || []).filter((layer) => {
        if (!isSheetFiberSnapshotLayer(layer)) return false;
        if (!project) return true;
        return String(layer.source?.projectName || '').trim() === project;
    });
}

/**
 * @param {object} [layer]
 * @returns {string|null}
 */
export function fiberKeyOfLayer(layer) {
    if (!layer) return null;
    return layer.source?.fiberKey
        || layer._udotFiberLayerKey
        || matchUdotFiberLayerUrl(layer.service?.url || layer.source?.url || layer.url)?.key
        || null;
}

/**
 * Pick Fiber layers for sheet PDF collect/refresh.
 * No visible snapshots → live overlay (yesterday). Visible snapshots for a Fiber key
 * replace that live layer so edited operational copies are what the PDF draws.
 *
 * @param {string[]} [visibleFiberIds]
 * @param {object[]} [layers]
 * @returns {{ fiberLayerIds: string[], omitIds: string[], refreshLiveIds: string[] }}
 */
export function resolveFiberLayerIdsForPdfExport(visibleFiberIds = [], layers = []) {
    const byId = new Map((layers || []).map((layer) => [layer.id, layer]));
    const visibleLayers = (visibleFiberIds || [])
        .map((id) => byId.get(id))
        .filter(Boolean);
    const snapshots = visibleLayers.filter(isSheetFiberSnapshotLayer);

    if (!snapshots.length) {
        const liveIds = (visibleFiberIds || []).filter((id) => !isSheetFiberSnapshotLayer(byId.get(id)));
        return {
            fiberLayerIds: liveIds,
            omitIds: liveIds,
            refreshLiveIds: liveIds
        };
    }

    const snapshotKeys = new Set(snapshots.map(fiberKeyOfLayer).filter(Boolean));
    const convertedLiveIds = new Set();
    for (const snap of snapshots) {
        if (snap.source?.sourceLayerId) convertedLiveIds.add(snap.source.sourceLayerId);
    }
    for (const layer of layers || []) {
        if (!layer?.id || isSheetFiberSnapshotLayer(layer)) continue;
        const key = fiberKeyOfLayer(layer);
        if (key && snapshotKeys.has(key) && (isUdotFiberLiveDataset(layer) || layer.type === 'service')) {
            convertedLiveIds.add(layer.id);
        }
    }

    const remainingLive = visibleLayers.filter((layer) => {
        if (isSheetFiberSnapshotLayer(layer)) return false;
        if (convertedLiveIds.has(layer.id)) return false;
        const key = fiberKeyOfLayer(layer);
        return !key || !snapshotKeys.has(key);
    });

    const fiberLayerIds = [
        ...snapshots.map((layer) => layer.id),
        ...remainingLive.map((layer) => layer.id)
    ];
    const omitIds = [...new Set([
        ...fiberLayerIds,
        ...convertedLiveIds,
        ...listSheetFiberSnapshotLayers(layers).map((layer) => layer.id)
    ])];

    return {
        fiberLayerIds,
        omitIds,
        refreshLiveIds: remainingLive.map((layer) => layer.id)
    };
}

/**
 * @param {string[]} [visibleFiberIds]
 * @param {object[]} [layers]
 * @returns {string[]}
 */
export function liveFiberIdsForPdfExport(visibleFiberIds = [], layers = []) {
    return resolveFiberLayerIdsForPdfExport(visibleFiberIds, layers).fiberLayerIds;
}

/**
 * @param {string[]} [visibleFiberIds]
 * @param {object[]} [layers]
 * @returns {string[]}
 */
export function omitIdsForSheetPdfFiber(visibleFiberIds = [], layers = []) {
    return resolveFiberLayerIdsForPdfExport(visibleFiberIds, layers).omitIds;
}

/**
 * Swap converted live Fiber ids for the operational copies on the sheet design list.
 * @param {string[]} [designLayerIds]
 * @param {string[]} [hiddenLiveIds]
 * @param {string[]} [snapshotIds]
 * @returns {string[]}
 */
export function replaceLiveFiberIdsInDesignList(designLayerIds = [], hiddenLiveIds = [], snapshotIds = []) {
    const hide = new Set((hiddenLiveIds || []).filter(Boolean));
    const kept = (designLayerIds || []).filter((id) => id && !hide.has(id));
    const seen = new Set(kept);
    for (const id of snapshotIds || []) {
        if (!id || seen.has(id)) continue;
        kept.push(id);
        seen.add(id);
    }
    return kept;
}
