/**
 * Legend entries for the dual-screen pop-out, from the local layer catalog.
 */

import { buildMapLegend, legendLayerRecords } from '../map/map-legend.js';
import { getPopoutLayers, subscribePopoutLayers } from './popout-layer-catalog.js';

export function popoutLegendEntries() {
    return buildMapLegend(legendLayerRecords(getPopoutLayers(), (layer) => layer.style || null));
}

export function subscribePopoutLegend(fn) {
    return subscribePopoutLayers(() => fn(popoutLegendEntries()));
}
