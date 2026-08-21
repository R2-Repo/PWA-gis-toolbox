/**
 * Prepare UDOT Fiber features and resolve PDF styles that match the live map pack.
 */
import { resolveFeatureStyle } from '../../map/style-engine.js';
import { resolveEsriLineDasharray } from '../../arcgis/picture-markers.js';
import { UDOT_FIBER_LAYER_BY_KEY, UDOT_FIBER_ROTATION_FIELD, matchUdotFiberLayerUrl } from './constants.js';
import {
    applyUdotFiberDisplayOffsets
} from './display-offsets.js';
import {
    buildUdotFiberExcludeWhere,
    filterUdotFiberDisplayFeatures
} from './display-filters.js';
import { udotFiberDrawRank } from './draw-order.js';
import { decorateUdotFiberPointFeatures, resolvePointGlyph } from './glyphs.js';
import {
    UDOT_FIBER_CASING_COLOR,
    UDOT_FIBER_CASING_EXTRA,
    UDOT_FIBER_CASING_OPACITY,
    UDOT_FIBER_GLOW_EXTRA,
    UDOT_FIBER_GLOW_OPACITY,
    UDOT_FIBER_LINE_CORE_WIDTH
} from './paint.js';
import {
    buildUdotFiberLayerStyle,
    getDrawingLayer,
    lookupBentleyColor,
    resolveStyle
} from './resolve-style.js';
import { UDOT_FIBER_GROUND_LOCK_ZOOM, udotFiberIconPxAtZoom } from './zoom-scale.js';

/** Typical sheet map scale (~1100 ft on tabloid) matches the approved ground-lock look. */
export const UDOT_FIBER_SHEET_EXPORT_ZOOM = UDOT_FIBER_GROUND_LOCK_ZOOM;

const LINE_LABEL_SIZE = Object.freeze({
    fiber: 12,
    conduit: 11
});

/**
 * @param {object|null} [layer]
 * @param {object|null} [layerStyle]
 * @returns {string|null}
 */
export function resolveUdotFiberLayerKey(layer, layerStyle = null) {
    if (layer?._udotFiberLayerKey) return layer._udotFiberLayerKey;
    const url = layer?.service?.url || layer?.source?.url || layer?.url;
    const fromUrl = matchUdotFiberLayerUrl(url)?.key;
    if (fromUrl) return fromUrl;
    return layerStyle?._udotFiber?.layerKey
        || layer?.properties?._udotFiberKey
        || null;
}

/**
 * @param {string} [color]
 * @param {Record<string, unknown>} [props]
 * @param {string|null} [labelField]
 * @param {string} [fallback]
 */
export function resolveUdotFiberHexColor(color, props = {}, labelField = null, fallback = '#111827') {
    if (typeof color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim())) {
        return color.trim();
    }
    const label = labelField && props[labelField] != null ? String(props[labelField]) : '';
    return lookupBentleyColor(label) || fallback;
}

/**
 * Stamp + decorate Fiber features the same way the live map does.
 * @param {string} layerKey
 * @param {object[]} features
 * @param {{ layerId?: string, map?: object }} [opts]
 */
export function prepareUdotFiberExportFeatures(layerKey, features = [], opts = {}) {
    if (!layerKey || !features.length) return features || [];
    const layerId = opts.layerId || '';
    const stamp = (list) => list.map((feature) => ({
        ...feature,
        properties: {
            ...(feature.properties || {}),
            ...(layerId ? { _sourceLayerId: layerId } : {}),
            _udotFiberKey: layerKey
        }
    }));

    if (features.every((feature) => feature?.properties?._udotFiberKey === layerKey)) {
        return stamp(features);
    }

    let next = filterUdotFiberDisplayFeatures(layerKey, features);
    const alreadyOffset = next.some((feature) => feature?.properties?._udotDisplayOffsetM != null);
    if (layerKey === 'fiber' && !alreadyOffset) {
        next = applyUdotFiberDisplayOffsets(next);
    }
    next = decorateUdotFiberPointFeatures(layerKey, next, opts.map);
    return stamp(next);
}

/**
 * ArcGIS `where` for corridor queries (same hide list as the live layer).
 * @param {string} [layerKey]
 */
export function udotFiberExportWhere(layerKey) {
    return buildUdotFiberExcludeWhere(layerKey);
}

/**
 * PDF draw rank so conduit/fiber paint stays under buildings → cabinets.
 * @param {object} feature
 */
export function udotFiberSheetDrawOrder(feature) {
    const key = feature?.properties?._udotFiberKey;
    const rank = udotFiberDrawRank(key);
    if (rank < 0) return null;
    const isLabel = feature?.properties?._udotFiberPass === 'label';
    return isLabel ? 48 + rank : 42 + rank;
}

/**
 * Map-matching vector style for one Fiber feature on a sheet PDF.
 * Line colors stay published class colors (not Bentley label overrides).
 * Dashed conduit has no casing/glow — same as the live map.
 *
 * @param {string} layerKey
 * @param {object} feature
 * @param {object|null} [layerStyle]
 */
export function resolveUdotFiberSheetPdfStyle(layerKey, feature, layerStyle = null) {
    const props = feature?.properties || {};
    const geometry = UDOT_FIBER_LAYER_BY_KEY[layerKey]?.geometry;
    const style = layerStyle?._udotFiber?.layerKey === layerKey
        ? layerStyle
        : (layerStyle || buildUdotFiberLayerStyle(layerKey));
    const kind = geometry === 'point' ? 'point' : 'line';
    const flat = resolveFeatureStyle(style, feature, kind);
    const resolved = resolveStyle(layerKey, props);
    const meta = getDrawingLayer(layerKey);
    const dash = style?._udotFiber?.lineDasharray
        || resolveEsriLineDasharray(meta?.classes || []);
    const dashed = Array.isArray(dash) && dash.length > 0;

    if (geometry === 'line' || layerKey === 'fiber' || layerKey === 'conduit') {
        const core = UDOT_FIBER_LINE_CORE_WIDTH[layerKey]
            || (Number(flat.strokeWidth) || 2.35);
        const strokeColor = resolveUdotFiberHexColor(flat.strokeColor, props, null, resolved.color);
        const labelField = style?.labels?.field || meta?.labelField || null;
        return {
            kind: 'line',
            fiberKey: layerKey,
            strokeColor,
            strokeWidth: core,
            strokeOpacity: 1,
            dash: dashed ? dash : undefined,
            lineCap: dashed ? 'butt' : 'round',
            casing: dashed
                ? null
                : {
                    color: UDOT_FIBER_CASING_COLOR,
                    width: core + UDOT_FIBER_CASING_EXTRA,
                    opacity: UDOT_FIBER_CASING_OPACITY
                },
            glow: dashed
                ? null
                : {
                    color: strokeColor,
                    width: core + UDOT_FIBER_GLOW_EXTRA,
                    opacity: UDOT_FIBER_GLOW_OPACITY
                },
            labelField,
            labelSize: LINE_LABEL_SIZE[layerKey] || 11,
            color: strokeColor,
            haloColor: '#ffffff',
            haloWidth: layerKey === 'conduit' ? 2.1 : 1.9
        };
    }

    const glyph = resolved.glyph || resolvePointGlyph(layerKey, props);
    const iconPx = udotFiberIconPxAtZoom(layerKey, UDOT_FIBER_SHEET_EXPORT_ZOOM);
    const labelField = style?.labels?.field || meta?.labelField || null;
    const fillColor = glyph?.color
        || resolveUdotFiberHexColor(flat.fillColor, props, labelField, resolved.color);
    const labelColor = resolveUdotFiberHexColor(
        typeof style?.labels?.color === 'string' ? style.labels.color : null,
        props,
        labelField,
        fillColor
    );

    return {
        kind: 'point',
        fiberKey: layerKey,
        fillColor,
        strokeColor: '#0a0a0a',
        radius: iconPx,
        strokeWidth: 1.15,
        fillOpacity: 0.85,
        strokeOpacity: 0.55,
        glyph: glyph
            ? {
                kind: glyph.glyph,
                color: glyph.color || fillColor,
                rotationDeg: Number(props[UDOT_FIBER_ROTATION_FIELD]) || 0
            }
            : null,
        labelField,
        labelSize: 11,
        color: labelColor,
        haloColor: '#ffffff',
        haloWidth: 1.1,
        plateHaloColor: '#0a0a0a',
        plateHaloWidth: 2.1
    };
}
