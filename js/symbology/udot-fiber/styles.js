/**
 * Prebuilt MapLibre styles for live-layer catalog entries.
 */
import { buildUdotFiberLayerStyle } from './resolve-style.js';

export const UDOT_FIBER_STYLE = buildUdotFiberLayerStyle('fiber');
export const UDOT_CONDUIT_STYLE = buildUdotFiberLayerStyle('conduit');
export const UDOT_CABINETS_STYLE = buildUdotFiberLayerStyle('cabinets');
export const UDOT_BOXES_STYLE = buildUdotFiberLayerStyle('boxes');
export const UDOT_SPLICES_STYLE = buildUdotFiberLayerStyle('splices');
export const UDOT_BUILDING_STYLE = buildUdotFiberLayerStyle('building');

export const UDOT_FIBER_STYLES_BY_KEY = {
    fiber: UDOT_FIBER_STYLE,
    conduit: UDOT_CONDUIT_STYLE,
    cabinets: UDOT_CABINETS_STYLE,
    boxes: UDOT_BOXES_STYLE,
    splices: UDOT_SPLICES_STYLE,
    building: UDOT_BUILDING_STYLE
};
