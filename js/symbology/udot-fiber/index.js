export {
    UDOT_FIBER_SERVICE_URL,
    UDOT_FIBER_LAYERS,
    UDOT_FIBER_LAYER_BY_KEY,
    UDOT_FIBER_LAYER_BY_ID,
    UDOT_FIBER_SYNC_INTERVAL_MS,
    UDOT_FIBER_CATALOG_ID,
    layerUrl,
    matchUdotFiberLayerUrl
} from './constants.js';

export {
    buildUdotFiberLayerStyle,
    resolveUdotFiberStyleForDataset,
    resolveStyle,
    lookupBentleyColor,
    getDrawingLayer,
    buildClassColorExpression,
    drawingInfo,
    bentleySymbols
} from './resolve-style.js';

export {
    UDOT_GLYPH_RULES,
    resolvePointGlyph,
    makeUdotGlyphSvg,
    ensureUdotGlyphImage,
    buildGlyphMatchExpression
} from './glyphs.js';

export { downloadUdotFiberLayer, downloadAllUdotFiberLayers } from './download.js';
export { applyUdotFiberDisplayOffsets } from './display-offsets.js';
export {
    UDOT_FIBER_STYLE,
    UDOT_CONDUIT_STYLE,
    UDOT_CABINETS_STYLE,
    UDOT_BOXES_STYLE,
    UDOT_SPLICES_STYLE,
    UDOT_BUILDING_STYLE,
    UDOT_FIBER_STYLES_BY_KEY
} from './styles.js';

// desktop-sync / map-loader import app state — load via direct path, not this barrel.
