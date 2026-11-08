/**
 * Legend entries from the dual-screen layer catalog.
 * Snapshots and forwarded map commands fill the catalog.
 */

import { buildMapLegend, legendLayerRecords } from '../map/map-legend.js';
import { getPopoutLayers, subscribePopoutLayers } from './popout-layer-catalog.js';

export function popoutLegendEntries() {
    return buildMapLegend(legendLayerRecords(getPopoutLayers(), (layer) => layer.style || null));
}

export function subscribePopoutLegend(fn) {
    return subscribePopoutLayers(() => fn(popoutLegendEntries()));
}
