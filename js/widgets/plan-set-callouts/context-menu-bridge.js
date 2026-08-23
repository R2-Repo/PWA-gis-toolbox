/**
 * Plan Set Callouts items for the map right-click and Shift+drag menus.
 * Active while a callout session is on the map, including after Done.
 * Primary map only (not dual-screen).
 */

import { fiberKeyOfLayer } from '../sheet-cutting/fiber-operational.js';
import { fiberFeatureId, noteTextForFeature } from './fiber-notes.js';
import {
    fallbackCalloutText,
    isLeaderOn,
    labelForLeader,
    leadersForFeatureOnSheet,
    sheetIdForCoordinate
} from './callout-targets.js';
import { hitCalloutPreview } from './preview.js';

/** @type {null | {
 *   isActive?: () => boolean,
 *   isOpen: () => boolean,
 *   getSession: () => object,
 *   mapService: object,
 *   getLayers: () => object[],
 *   onRemoveLeader: (leaderKey: string) => void,
 *   onAddNote: (leaderKey: string) => void,
 *   onAddLeader: (input: object) => void,
 *   onSetLeadersEnabled?: (features: object[], enabled: boolean, options?: object) => number
 * }} */
let menuContext = null;

/**
 * @param {typeof menuContext} next
 */
export function setPlanSetCalloutMenuContext(next) {
    menuContext = next;
}

function menuIsLive() {
    return Boolean(menuContext?.isActive?.() || menuContext?.isOpen?.());
}

function stampFiberKey(feature, fiberKey) {
    if (!feature) return feature;
    if (feature.properties?._udotFiberKey) return feature;
    return {
        ...feature,
        properties: { ...(feature.properties || {}), _udotFiberKey: fiberKey }
    };
}

function layerForId(layerId) {
    const layers = menuContext?.getLayers?.() || [];
    return layerId ? layers.find((entry) => entry.id === layerId) : null;
}

function fiberKeyFor(layer, feature) {
    return fiberKeyOfLayer(layer) || feature?.properties?._udotFiberKey || '';
}

function isCalloutFiberKey(fiberKey) {
    return Boolean(fiberKey) && fiberKey !== 'cabinets' && fiberKey !== 'building';
}

function clickCoord(payload) {
    if (payload?.latlng) return [payload.latlng.lng, payload.latlng.lat];
    const geometry = payload?.feature?.geometry;
    if (geometry?.type === 'Point' && geometry.coordinates) return geometry.coordinates;
    return null;
}

function collectNearbyHits(payload) {
    const seen = new Set();
    const hits = [];
    const add = (feature, layerId) => {
        if (!feature) return;
        const layer = layerForId(layerId);
        const fiberKey = fiberKeyFor(layer, feature);
        if (!isCalloutFiberKey(fiberKey)) return;
        const stamped = stampFiberKey(feature, fiberKey);
        const id = `${layerId || ''}:${fiberFeatureId(stamped) || hits.length}`;
        if (seen.has(id)) return;
        seen.add(id);
        hits.push({ feature: stamped, layer, fiberKey, layerId });
    };

    add(payload?.feature, payload?.layerId);

    const latlng = payload?.latlng;
    const nearby = latlng && menuContext.mapService?.findFeaturesNearClick
        ? (menuContext.mapService.findFeaturesNearClick(latlng, payload.layerId, payload.featureIndex) || [])
        : [];
    for (const hit of nearby) {
        add(hit.feature, hit.layerId);
    }
    return hits;
}

function resolveTargets(session, hits, coord) {
    const sheetId = coord ? sheetIdForCoordinate(session, coord) : session?.selectedSheetId;
    const byKey = new Map();
    const leftovers = [];

    for (const hit of hits) {
        const matches = leadersForFeatureOnSheet(session, hit.feature, { sheetId, coord });
        if (matches.length) {
            for (const leader of matches) {
                const key = leader.leaderKey || leader.leaderId;
                if (key && !byKey.has(key)) byKey.set(key, { leader, hit });
            }
            continue;
        }
        leftovers.push(hit);
    }

    return { targets: [...byKey.values()], leftovers, sheetId };
}

function addInputFor(hit, coord, sheetId, leader) {
    const feature = hit.feature;
    const fiberKey = hit.fiberKey;
    const featureId = fiberFeatureId(feature);
    const anchor = feature.geometry?.type === 'Point'
        ? feature.geometry.coordinates
        : coord;
    return {
        targetKey: leader?.targetKey || (fiberKey === 'boxes' || fiberKey === 'splices'
            ? `${fiberKey}:${featureId || 'manual'}`
            : `span:line:${fiberKey}:${featureId || 'manual'}`),
        targetKind: leader?.targetKind || (fiberKey === 'boxes' || fiberKey === 'splices' ? fiberKey : 'span'),
        text: fallbackCalloutText(feature, fiberKey) || noteTextForFeature(fiberKey, feature),
        anchor,
        sheetId: leader?.sheetId || sheetId
    };
}

function turnOnItem(session, entry, coord, sheetId) {
    const { leader, hit } = entry;
    const label = leader ? labelForLeader(session, leader) : fallbackCalloutText(hit.feature, hit.fiberKey);
    return {
        icon: '🔺',
        label: `Turn on callout — ${label}`,
        action: () => menuContext.onAddLeader?.(addInputFor(hit, coord, sheetId, leader))
    };
}

function turnOffItem(leader, session) {
    return {
        icon: '🔺',
        label: `Turn off callout — ${labelForLeader(session, leader)}`,
        action: () => menuContext.onRemoveLeader?.(leader.leaderKey || leader.leaderId)
    };
}

/**
 * @param {object} payload
 * @returns {object[]}
 */
export function getPlanSetCalloutMenuItems(payload) {
    if (!menuIsLive()) return [];

    const items = [];
    const lngLat = payload?.latlng
        ? { lng: payload.latlng.lng, lat: payload.latlng.lat }
        : null;
    const hit = lngLat ? hitCalloutPreview(menuContext.mapService, lngLat) : null;
    const leaderKey = hit?.properties?.leader_key || hit?.properties?.leader_id;

    if (leaderKey) {
        items.push({
            icon: '🔺',
            label: 'Turn off callout',
            action: () => menuContext.onRemoveLeader?.(leaderKey)
        });
        items.push({
            icon: '➕',
            label: 'Add number to callout',
            action: () => menuContext.onAddNote?.(leaderKey)
        });
        return items;
    }

    const session = menuContext.getSession?.();
    const coord = clickCoord(payload);
    const hits = collectNearbyHits(payload);
    if (!hits.length) return items;

    const { targets, leftovers, sheetId } = resolveTargets(session, hits, coord);
    const onTargets = targets.filter((entry) => isLeaderOn(entry.leader));
    const offTargets = targets.filter((entry) => !isLeaderOn(entry.leader));
    const leftoverOn = leftovers.map((hit) => ({ hit, leader: null }));

    const onItems = [
        ...offTargets.map((entry) => turnOnItem(session, entry, coord, sheetId)),
        ...leftoverOn.map((entry) => turnOnItem(session, entry, coord, sheetId))
    ];
    const offItems = onTargets.map((entry) => turnOffItem(entry.leader, session));

    if (onItems.length === 1 && !offItems.length) return onItems;
    if (offItems.length === 1 && !onItems.length) return offItems;

    if (onItems.length === 1) items.push(onItems[0]);
    else if (onItems.length > 1) {
        items.push({
            icon: '🔺',
            label: 'Turn on callout',
            children: onItems.map((item) => ({
                label: String(item.label).replace(/^Turn on callout — /, ''),
                action: item.action
            }))
        });
    }

    if (offItems.length === 1) items.push(offItems[0]);
    else if (offItems.length > 1) {
        items.push({
            icon: '🔺',
            label: 'Turn off callout',
            children: offItems.map((item) => ({
                label: String(item.label).replace(/^Turn off callout — /, ''),
                action: item.action
            }))
        });
    }

    return items;
}

function selectedFeatures(layer) {
    const indices = new Set(
        (menuContext.mapService?.getSelectedIndices?.(layer.id) || []).map(Number)
    );
    return (layer?.geojson?.features || [])
        .map((feature, i) => {
            const raw = Number(feature?.properties?._featureIndex);
            const idx = Number.isFinite(raw) ? raw : i;
            return { feature, idx };
        })
        .filter(({ idx }) => indices.has(idx))
        .map(({ feature }) => {
            const fiberKey = fiberKeyFor(layer, feature);
            return stampFiberKey(feature, fiberKey);
        });
}

/**
 * Box-select items while a callout session is live.
 * @param {{ layer?: object, count?: number, bbox?: number[] }} input
 * @returns {object[]}
 */
export function getCalloutSelectionItems({ layer, count = 0, bbox } = {}) {
    if (!menuIsLive() || !(count > 0)) return [];
    const fiberKey = fiberKeyOfLayer(layer);
    if (!isCalloutFiberKey(fiberKey)) return [];
    if (!menuContext.getSession?.()) return [];

    return [
        {
            label: 'Turn callout on',
            icon: '🔺',
            title: 'Turn on callouts for the selected Fiber features (one per span)',
            action: () => {
                const features = selectedFeatures(layer);
                menuContext.onSetLeadersEnabled?.(features, true, { bbox });
            }
        },
        {
            label: 'Turn callout off',
            icon: '🔺',
            title: 'Turn off callouts for the selected Fiber features',
            action: () => {
                const features = selectedFeatures(layer);
                menuContext.onSetLeadersEnabled?.(features, false, { bbox });
            }
        }
    ];
}
