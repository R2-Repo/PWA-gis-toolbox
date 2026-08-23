/**
 * UDOT Fiber on sheet PDFs: vector linework (no Fiber/Conduit along-line labels).
 */
import { getLayers } from '../../core/state.js';
import { matchUdotFiberLayerUrl, UDOT_BOX_IN_LABEL_PROP, UDOT_BOX_LABEL_FIELD, UDOT_FIBER_ROTATION_FIELD } from '../../symbology/udot-fiber/constants.js';
import { isUdotFiberLabelLayerId } from '../../symbology/udot-fiber/draw-order.js';
import { resolveStyle as resolveUdotFiberFeatureStyle } from '../../symbology/udot-fiber/resolve-style.js';
import { resolveLookalike } from '../../symbology/udot-fiber/lookalikes.js';
import {
    UDOT_PIP_COLOR,
    UDOT_PIP_PDF_DASH,
    isProtectInPlaceFeature,
    protectInPlaceOutlineKind
} from '../../symbology/udot-fiber/protect-in-place.js';
import { clipFeaturesToSheetFrame } from './export-builder.js';

const FIBER_LINE_KEYS = new Set(['fiber', 'conduit']);
/** Live box glyph uses `rh = rw / 2.05`. */
export const UDOT_PDF_BOX_ASPECT = 2.05;
const FIBER_DRAW_RANK = Object.freeze({
    conduit: 41,
    fiber: 42,
    building: 44,
    boxes: 46,
    splices: 48,
    cabinets: 49
});

const ANNOTATION_FEATURE_TYPES = new Set([
    'sheet_outline',
    'matchline_see_label',
    'overview_sheet_outline',
    'overview_sheet_label',
    'overview_route',
    'inset_outline',
    'inset_label'
]);

/**
 * @param {object|null} [layer]
 * @param {object|null} [layerStyle]
 * @returns {boolean}
 */
export function resolveUdotFiberLayerKey(layer, layerStyle = null) {
    return layerStyle?._udotFiber?.layerKey
        || layer?._udotFiberLayerKey
        || matchUdotFiberLayerUrl(layer?.service?.url || layer?.source?.url || layer?.url)?.key
        || null;
}

/**
 * @param {object|null} [layer]
 * @param {object|null} [layerStyle]
 * @returns {boolean}
 */
export function isUdotFiberPaintLayer(layer, layerStyle = null) {
    return Boolean(resolveUdotFiberLayerKey(layer, layerStyle));
}

/**
 * Hide Fiber/Conduit along-line labels for sheet capture. Box/point labels stay.
 *
 * @param {object} mapService
 * @param {string[]} fiberLayerIds
 * @param {object[]} [layers]
 * @returns {() => void}
 */
export function suspendUdotFiberLineLabels(mapService, fiberLayerIds = [], layers = getLayers()) {
    const map = mapService?.getMap?.();
    const restored = [];
    if (!map) return () => {};

    const byId = new Map((layers || []).map((layer) => [layer.id, layer]));
    for (const layerId of fiberLayerIds || []) {
        const layer = byId.get(layerId);
        const style = mapService?.getLayerStyle?.(layerId);
        if (!FIBER_LINE_KEYS.has(resolveUdotFiberLayerKey(layer, style))) continue;
        const subIds = mapService?.getLayerRecord?.(layerId)?.layerIds || [];
        for (const subId of subIds) {
            if (!isUdotFiberLabelLayerId(subId) || !map.getLayer?.(subId)) continue;
            const prev = map.getLayoutProperty?.(subId, 'visibility');
            if (prev === 'none') continue;
            map.setLayoutProperty?.(subId, 'visibility', 'none');
            restored.push({ subId, prev: prev || 'visible' });
        }
    }

    return () => {
        for (const { subId, prev } of restored) {
            if (!map.getLayer?.(subId)) continue;
            map.setLayoutProperty?.(subId, 'visibility', prev);
        }
    };
}

/**
 * @param {object} mapService
 * @param {string} layerId
 * @returns {boolean}
 */
function isLayerVisible(mapService, layerId) {
    const map = mapService?.getMap?.();
    const record = mapService?.getLayerRecord?.(layerId);
    const subIds = record?.layerIds ?? [];
    if (map && subIds.length) {
        for (const subId of subIds) {
            if (!map.getLayer?.(subId)) continue;
            return map.getLayoutProperty?.(subId, 'visibility') !== 'none';
        }
    }
    return true;
}

/**
 * Visible Fiber live layers on the map — captured as raster, not redrawn as PDF vectors.
 *
 * @param {object} mapService
 * @param {object[]} [layers]
 * @returns {string[]}
 */
export function listVisibleUdotFiberLayerIds(mapService, layers = getLayers()) {
    const ids = [];
    for (const layer of layers || []) {
        if (!layer?.id) continue;
        const style = mapService?.getLayerStyle?.(layer.id);
        if (!isUdotFiberPaintLayer(layer, style)) continue;
        if (!isLayerVisible(mapService, layer.id)) continue;
        ids.push(layer.id);
    }
    return ids;
}

/**
 * Vector PDF style for a Fiber feature. Line layers do not carry along-line labels.
 *
 * @param {object} feature
 * @param {object|null} [layerStyle]
 * @returns {object|null}
 */
export function buildUdotFiberPdfStyle(feature, layerStyle = null) {
    const props = feature?.properties || {};
    const key = layerStyle?._udotFiber?.layerKey
        || props._udotFiberKey
        || resolveUdotFiberLayerKey(null, layerStyle);
    if (!key) return null;

    const resolved = resolveUdotFiberFeatureStyle(key, props);
    const color = resolved?.color || '#94a3b8';
    const pip = isProtectInPlaceFeature(feature);

    if (FIBER_LINE_KEYS.has(key)) {
        if (pip) {
            return {
                kind: 'fiber_line',
                fiberKey: key,
                protectInPlace: true,
                strokes: [{
                    strokeColor: UDOT_PIP_COLOR,
                    strokeWidth: key === 'conduit' ? 0.72 : 0.62,
                    strokeOpacity: 1,
                    dash: [...UDOT_PIP_PDF_DASH]
                }],
                labelField: null
            };
        }
        const coreWidth = key === 'conduit' ? 0.72 : 0.62;
        return {
            kind: 'fiber_line',
            fiberKey: key,
            strokes: [{
                strokeColor: color,
                strokeWidth: coreWidth,
                strokeOpacity: 1,
                dash: key === 'conduit' ? [2.1, 1.6] : undefined
            }],
            labelField: null
        };
    }

    const lookalike = resolveLookalike(key, props) || resolved?.glyph;
    const boxLabel = key === 'boxes' && props[UDOT_BOX_IN_LABEL_PROP]
        ? String(props[UDOT_BOX_LABEL_FIELD] || props.BOXLABELS || '').trim()
        : '';
    const markColor = lookalike?.color || color;
    const coloredMark = key === 'cabinets' || key === 'building';

    if (pip) {
        return {
            kind: 'fiber_point',
            fiberKey: key,
            protectInPlace: true,
            glyph: protectInPlaceOutlineKind(key),
            fillColor: null,
            strokeColor: UDOT_PIP_COLOR,
            radius: key === 'cabinets' ? 5.4 : (key === 'boxes' ? 4.8 : 4.1),
            rotation: Number(props[UDOT_FIBER_ROTATION_FIELD]) || 0,
            boxLabel: null,
            dash: [...UDOT_PIP_PDF_DASH],
            labelField: null
        };
    }

    return {
        kind: 'fiber_point',
        fiberKey: key,
        glyph: lookalike?.glyph || 'circle',
        fillColor: markColor,
        strokeColor: coloredMark ? markColor : '#111111',
        radius: key === 'cabinets' ? 5.4 : (key === 'boxes' ? 4.8 : 4.1),
        rotation: Number(props[UDOT_FIBER_ROTATION_FIELD]) || 0,
        boxLabel: boxLabel || null,
        labelField: null
    };
}

/**
 * Split a long BOXLABELS string at the space nearest the midpoint.
 *
 * @param {string} [label]
 * @returns {string[]}
 */
export function wrapUdotFiberPdfBoxLabel(label) {
    const text = String(label || '').trim().replace(/\s+/g, ' ');
    if (!text) return [];
    if (text.length <= 10 || !text.includes(' ')) return [text];
    const mid = text.length / 2;
    let cut = -1;
    let best = Infinity;
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== ' ') continue;
        const dist = Math.abs(i - mid);
        if (dist < best) {
            cut = i;
            best = dist;
        }
    }
    if (cut < 1) return [text];
    const left = text.slice(0, cut).trim();
    const right = text.slice(cut + 1).trim();
    return right ? [left, right] : [left];
}

/**
 * Landscape box matching the live Fiber glyph (aspect ~2.05). Readable PDF
 * size; text shrinks or wraps to stay inside (the rectangle does not grow).
 *
 * @param {string|null} [label]
 * @param {number} [radius]
 * @param {(text: string, fontSize: number) => number} [measureWidth]
 * @returns {{ fontSize: number, halfWidth: number, halfHeight: number, lines: string[] }}
 */
export function layoutUdotFiberPdfBox(label, radius = 4.8, measureWidth = null) {
    const size = Math.max(4.8, Number(radius) || 4.8);
    const halfWidth = size * 1.12;
    const halfHeight = halfWidth / UDOT_PDF_BOX_ASPECT;
    const text = String(label || '').trim();
    if (!text) {
        return { fontSize: 0, halfWidth, halfHeight, lines: [] };
    }

    const estimate = (value, pt) => (
        typeof measureWidth === 'function'
            ? measureWidth(value, pt)
            : value.length * pt * 0.54
    );
    const lines = wrapUdotFiberPdfBoxLabel(text);
    const padX = 0.7;
    const padY = 0.35;
    const innerW = Math.max(1, halfWidth * 2 - padX * 2);
    const innerH = Math.max(1, halfHeight * 2 - padY * 2);
    let fontSize = Math.min(5.2, innerH / (lines.length * 1.05));
    const widestAt = (pt) => Math.max(...lines.map((line) => estimate(line, pt)));
    if (widestAt(fontSize) > innerW) {
        fontSize = Math.max(2.6, fontSize * (innerW / widestAt(fontSize)));
    }

    return { fontSize, halfWidth, halfHeight, lines };
}

/**
 * @param {string} [fiberKey]
 * @returns {number}
 */
export function udotFiberPdfDrawRank(fiberKey) {
    const rank = FIBER_DRAW_RANK[fiberKey];
    return Number.isFinite(rank) ? rank : 50;
}

/**
 * Live Fiber features for the current sheet (after a viewport refresh).
 *
 * @param {object} mapService
 * @param {string[]} fiberLayerIds
 * @param {object|null} frameFeature
 * @param {object[]} [layers]
 * @returns {object[]}
 */
export function collectUdotFiberSheetFeatures(mapService, fiberLayerIds = [], frameFeature = null, layers = getLayers()) {
    const byId = new Map((layers || []).map((layer) => [layer.id, layer]));
    const features = [];
    for (const layerId of fiberLayerIds || []) {
        const layer = byId.get(layerId);
        const style = mapService?.getLayerStyle?.(layerId);
        const key = resolveUdotFiberLayerKey(layer, style);
        if (!key) continue;
        const fromRecord = mapService?.getLayerRecord?.(layerId)?.geojson?.features;
        const fromLayer = layer?.geojson?.features;
        const list = fromRecord?.length ? fromRecord : (fromLayer || []);
        for (const feature of list) {
            if (!feature?.geometry) continue;
            features.push({
                ...feature,
                properties: {
                    ...(feature.properties || {}),
                    _sourceLayerId: layerId,
                    _udotFiberKey: key
                }
            });
        }
    }
    return frameFeature ? clipFeaturesToSheetFrame(frameFeature, features) : features;
}

/**
 * Drop Fiber features that will be replaced by a fresh per-sheet collection.
 *
 * @param {import('geojson').FeatureCollection|object|null} collection
 * @param {string[]} rasterLayerIds
 * @returns {import('geojson').FeatureCollection|object|null}
 */
export function omitRasterizedLiveFeatures(collection, rasterLayerIds = []) {
    const skip = new Set((rasterLayerIds || []).filter(Boolean));
    if (!skip.size || !collection?.features) return collection;
    return {
        ...collection,
        features: collection.features.filter((feature) => {
            const type = feature?.properties?.feature_type;
            if (type && ANNOTATION_FEATURE_TYPES.has(type)) return true;
            const sourceId = feature?.properties?._sourceLayerId;
            return !sourceId || !skip.has(sourceId);
        })
    };
}

/**
 * @param {object} mapService
 * @param {string[]} layerIds
 * @returns {Promise<void>}
 */
export async function refreshUdotFiberPaintLayers(mapService, layerIds = []) {
    const ids = (layerIds || []).filter(Boolean);
    if (!ids.length || typeof mapService?.refreshServiceLayer !== 'function') return;
    await Promise.all(ids.map((id) => mapService.refreshServiceLayer(id)));
}
