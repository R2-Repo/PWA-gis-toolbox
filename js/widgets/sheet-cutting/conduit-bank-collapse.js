/**
 * View-only conduit-bank collapse for remade Fiber / Conduit snapshots.
 * Originals stay on the layer; map + PDF hide siblings when the flag is on.
 */

import { filterLinesForCollapsedView, spanMemberKey } from '../plan-set-callouts/span-grouping.js';
import { fiberKeyOfLayer, isSheetFiberSnapshotLayer } from './fiber-operational.js';

const LINE_KEYS = new Set(['fiber', 'conduit']);

/**
 * @param {object} feature
 * @param {string} [fiberKey]
 * @returns {object}
 */
export function stampCollapseFiberKey(feature, fiberKey) {
    if (!feature) return feature;
    const key = feature.properties?._udotFiberKey || fiberKey || '';
    if (!key || feature.properties?._udotFiberKey === key) return feature;
    return {
        ...feature,
        properties: {
            ...(feature.properties || {}),
            _udotFiberKey: key
        }
    };
}

/**
 * @param {object[]} [layers]
 * @returns {{ boxes: object[], lines: object[], lineLayers: object[] }}
 */
export function collectSnapshotCollapseInputs(layers = []) {
    const boxes = [];
    const lines = [];
    const lineLayers = [];
    for (const layer of layers || []) {
        if (!isSheetFiberSnapshotLayer(layer)) continue;
        const fiberKey = fiberKeyOfLayer(layer);
        const features = (layer.geojson?.features || []).map((feature) => (
            stampCollapseFiberKey(feature, fiberKey)
        ));
        if (fiberKey === 'boxes') {
            boxes.push(...features.filter((feature) => feature?.geometry?.type === 'Point'));
        }
        if (LINE_KEYS.has(fiberKey)) {
            lines.push(...features.filter((feature) => feature?.geometry));
            lineLayers.push(layer);
        }
    }
    return { boxes, lines, lineLayers };
}

/**
 * @param {object[]} [lineFeatures]
 * @param {object[]} [boxes]
 * @returns {Set<string>}
 */
export function visibleCollapseMemberKeys(lineFeatures = [], boxes = []) {
    return new Set(
        filterLinesForCollapsedView(lineFeatures, boxes, { collapsed: true })
            .map((feature) => spanMemberKey(feature))
            .filter(Boolean)
    );
}

/**
 * Stamp remade line layers so map refresh can hide siblings without rewriting GeoJSON.
 * @param {object[]} [layers]
 * @param {boolean} collapsed
 * @returns {object[]}
 */
export function stampSnapshotCollapseState(layers = [], collapsed = false) {
    const { boxes, lines, lineLayers } = collectSnapshotCollapseInputs(layers);
    const keys = collapsed ? visibleCollapseMemberKeys(lines, boxes) : null;
    for (const layer of lineLayers) {
        if (collapsed) {
            layer._udotCollapseConduitBanks = true;
            layer._udotCollapseVisibleKeys = keys;
        } else {
            delete layer._udotCollapseConduitBanks;
            delete layer._udotCollapseVisibleKeys;
        }
    }
    return lineLayers;
}

/**
 * @param {{ getLayers?: Function, mapService?: { refreshLayerData?: Function } }} ctx
 * @param {boolean} collapsed
 * @returns {object[]}
 */
export function syncConduitBankCollapseView(ctx, collapsed = false) {
    const layers = ctx?.getLayers?.() || [];
    const lineLayers = stampSnapshotCollapseState(layers, collapsed === true);
    for (const layer of lineLayers) {
        ctx?.mapService?.refreshLayerData?.(layer);
    }
    return lineLayers;
}

/**
 * Keep points; when collapsed, keep one carrier per span from remade line features.
 * Live (non-snapshot) lines are left alone.
 * @param {object[]} [features]
 * @param {{ collapsed?: boolean, snapshotLayerIds?: Iterable<string> }} [options]
 * @returns {object[]}
 */
export function applyCollapsedBankFilter(features = [], options = {}) {
    if (options.collapsed !== true) return features || [];

    const snapshotIds = options.snapshotLayerIds
        ? new Set([...options.snapshotLayerIds].filter(Boolean))
        : null;
    const isSnapshotLine = (feature) => {
        const key = feature?.properties?._udotFiberKey;
        if (!LINE_KEYS.has(key)) return false;
        if (!snapshotIds) return true;
        const sourceId = feature?.properties?._sourceLayerId;
        return !sourceId || snapshotIds.has(sourceId);
    };

    const lines = [];
    const rest = [];
    for (const feature of features || []) {
        if (isSnapshotLine(feature)) lines.push(feature);
        else rest.push(feature);
    }
    if (!lines.length) return features || [];

    const boxes = rest.filter((feature) => feature?.properties?._udotFiberKey === 'boxes');
    const visibleKeys = visibleCollapseMemberKeys(lines, boxes);
    const kept = lines.filter((feature) => {
        const key = spanMemberKey(feature);
        return !key || visibleKeys.has(key);
    });
    return [...rest, ...kept];
}
