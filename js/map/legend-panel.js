/**
 * Right-panel legend: collapse preference and entries.
 * Dual Screen reads the pop-out layer catalog (the bridge), not the map object.
 */
import { isServiceLayer } from '../core/data-model.js';
import { buildMapLegend, legendLayerRecords } from './map-legend.js';
import { replacePopoutLayers } from '../dual-screen/popout-layer-catalog.js';
import { popoutLegendEntries } from '../dual-screen/popout-legend.js';

export const LEGEND_COLLAPSED_KEY = 'gis-toolbox-legend-collapsed';

/**
 * Collapsed unless the user has stored an expanded preference.
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function readLegendCollapsed(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(LEGEND_COLLAPSED_KEY);
        if (raw == null) return true;
        return raw !== '0' && raw !== 'false';
    } catch {
        return true;
    }
}

/**
 * @param {boolean} collapsed
 * @param {Storage} [storage]
 */
export function writeLegendCollapsed(collapsed, storage = globalThis.localStorage) {
    storage.setItem(LEGEND_COLLAPSED_KEY, collapsed ? '1' : '0');
}

/**
 * Same style lookup the on-map legend used: saved style, else service default.
 * @param {object|null|undefined} layer
 * @param {{ getLayerStyle?: (id: string) => object|null, serviceStyle?: (layer: object) => object|null }} [lookup]
 */
export function styleForLegendLayer(layer, lookup = {}) {
    if (!layer) return null;
    const saved = lookup.getLayerStyle?.(layer.id) || null;
    if (saved) return saved;
    if (isServiceLayer(layer)) return lookup.serviceStyle?.(layer) || null;
    return null;
}

function publishLegendBridge(layers, styleFor) {
    const records = legendLayerRecords(layers, styleFor).map((record) => ({
        ...record,
        type: 'spatial'
    }));
    replacePopoutLayers(records);
}

/**
 * Main-window legend entries.
 * Pass `layers` while dual screen is on to mirror them into the bridge catalog
 * before reading. Omit `layers` to read whatever the bridge already stored.
 * @param {{ dualScreen?: boolean, layers?: object[]|null, styleFor?: (layer: object) => object|null }} [options]
 */
export function legendEntriesForPanel({ dualScreen = false, layers, styleFor } = {}) {
    if (dualScreen) {
        if (Array.isArray(layers)) publishLegendBridge(layers, styleFor);
        return popoutLegendEntries();
    }
    return buildMapLegend(legendLayerRecords(layers, styleFor));
}
