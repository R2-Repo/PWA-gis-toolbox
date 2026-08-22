/**
 * Plan Set Callouts items for the map right-click menu.
 * Active only while the widget is open. Primary map only (not dual-screen).
 */

import { fiberKeyOfLayer } from '../sheet-cutting/fiber-operational.js';
import { fiberFeatureId, noteTextForFeature } from './fiber-notes.js';
import { hitCalloutPreview } from './preview.js';

/** @type {null | {
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

/**
 * @param {object} payload
 * @returns {object[]}
 */
export function getPlanSetCalloutMenuItems(payload) {
    if (!menuContext?.isOpen?.()) return [];

    const items = [];
    const lngLat = payload?.latlng
        ? { lng: payload.latlng.lng, lat: payload.latlng.lat }
        : null;
    const hit = lngLat ? hitCalloutPreview(menuContext.mapService, lngLat) : null;
    const leaderKey = hit?.properties?.leader_key || hit?.properties?.leader_id;

    if (leaderKey) {
        items.push({
            icon: '🔺',
            label: 'Remove callout',
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

    items.push({
        icon: '🔺',
        label: 'Add callout',
        action: () => menuContext.onAddLeader?.({
            targetKey: `${fiberKey}:${fiberFeatureId(feature) || 'manual'}`,
            targetKind: fiberKey === 'boxes' || fiberKey === 'splices' ? fiberKey : 'span',
            text,
            anchor: coords
        })
    });
    return items;
}
