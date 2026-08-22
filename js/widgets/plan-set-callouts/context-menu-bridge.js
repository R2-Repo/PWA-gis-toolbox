/**
 * Plan Set Callouts items for the map right-click menu.
 * Active while a callout session is on the map, including after Done.
 * Primary map only (not dual-screen).
 */

import { fiberKeyOfLayer } from '../sheet-cutting/fiber-operational.js';
import { fiberFeatureId, noteTextForFeature } from './fiber-notes.js';
import { hitCalloutPreview } from './preview.js';

/** @type {null | {
 *   isActive?: () => boolean,
 *   isOpen: () => boolean,
 *   getSession: () => object,
 *   mapService: object,
 *   getLayers: () => object[],
 *   onRemoveLeader: (leaderKey: string) => void,
 *   onAddNote: (leaderKey: string) => void,
 *   onAddLeader: (input: object) => void
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

    const feature = payload?.feature;
    const layers = menuContext.getLayers?.() || [];
    const layer = payload?.layerId ? layers.find((entry) => entry.id === payload.layerId) : null;
    const fiberKey = fiberKeyOfLayer(layer) || feature?.properties?._udotFiberKey;
    if (!feature || !fiberKey) return items;
    if (fiberKey === 'cabinets' || fiberKey === 'building') return items;

    const text = noteTextForFeature(fiberKey, feature);
    const coords = feature.geometry?.type === 'Point'
        ? feature.geometry.coordinates
        : (lngLat ? [lngLat.lng, lngLat.lat] : null);
    if (!coords) return items;

    const session = menuContext.getSession?.();
    const featureId = fiberFeatureId(feature);
    const matches = (session?.leaders || []).filter((leader) => {
        if (leader.targetKey === `${fiberKey}:${featureId}`) return true;
        if (featureId && (leader.memberIds || []).map(String).includes(String(featureId))) return true;
        if (featureId && String(leader.targetKey).includes(`:${featureId}`)) return true;
        return false;
    });
    const onLeader = matches.find((leader) => leader.suppressed !== true && leader.enabled !== false);

    if (onLeader) {
        items.push({
            icon: '🔺',
            label: 'Turn off callout',
            action: () => menuContext.onRemoveLeader?.(onLeader.leaderKey || onLeader.leaderId)
        });
        return items;
    }

    items.push({
        icon: '🔺',
        label: 'Turn on callout',
        action: () => menuContext.onAddLeader?.({
            targetKey: matches[0]?.targetKey || `${fiberKey}:${featureId || 'manual'}`,
            targetKind: fiberKey === 'boxes' || fiberKey === 'splices' ? fiberKey : 'span',
            text,
            anchor: coords
        })
    });
    return items;
}
