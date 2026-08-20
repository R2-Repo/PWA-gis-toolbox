/**
 * Modern CAD MapLibre layer specs for UDOT Fiber live layers.
 * Dual-contrast lines + dual-halo labels. Class colors stay published.
 */
import { compilePaint } from '../../map/style-engine.js';
import { buildMapLabelLayerSpec, resolveLayerLabels } from '../../map/map-labels.js';
import logger from '../../core/logger.js';
import { combineUdotFiberMapLibreFilter } from './display-filters.js';
import { UDOT_FIBER_LAYER_BY_KEY, UDOT_FIBER_ROTATION_FIELD } from './constants.js';
import { getDrawingLayer } from './resolve-style.js';
import { resolveEsriLineDasharray } from '../../arcgis/picture-markers.js';
import { preloadUdotFiberGlyphs } from './glyphs.js';
import {
    buildUdotFiberCircleRadiusExpression,
    buildUdotFiberHitRadiusExpression,
    buildUdotFiberIconSizeExpression,
    buildUdotFiberLineWidthExpression
} from './zoom-scale.js';

/** Regular is on the demotiles glyph server; Bold often fails silent and hides labels. */
export const UDOT_FIBER_LABEL_FONT = [
    'Open Sans Regular',
    'Arial Unicode MS Regular'
];

const CASING_COLOR = '#0a0a0a';
const CASING_OPACITY = 0.42;
const GLOW_BLUR = 1.35;
const GLOW_OPACITY = 0.18;
const CASING_EXTRA = 0.8;
const GLOW_EXTRA = 1.55;

const LINE_CORE_WIDTH = Object.freeze({
    fiber: 2.35,
    conduit: 2.55
});

/**
 * ArcGIS geographic rotation (clockwise from north) → MapLibre icon-rotate.
 * @returns {unknown[]}
 */
export function buildUdotFiberIconRotateExpression() {
    return [
        'to-number',
        ['coalesce', ['get', UDOT_FIBER_ROTATION_FIELD], 0]
    ];
}

/**
 * Resolve point vs line paint. Prefer style hint, then catalog key.
 * @param {object} [layerStyle]
 * @param {string} [fiberKey]
 * @returns {'line'|'point'|null}
 */
export function resolveUdotFiberPaintGeometry(layerStyle, fiberKey) {
    const hinted = layerStyle?._udotFiber?.geometry;
    if (hinted === 'line' || hinted === 'point') return hinted;
    return UDOT_FIBER_LAYER_BY_KEY[fiberKey]?.geometry || null;
}

/**
 * Numeric pad only — MapLibre 4 rejects `+` around interpolate/match widths.
 * @param {number|unknown[]} width
 * @param {number} extra
 * @param {number} [fallback]
 */
export function widenLineWidth(width, extra, fallback = 2) {
    const n = Number(extra);
    const base = typeof width === 'number' && Number.isFinite(width) ? width : fallback;
    if (!Number.isFinite(n)) return base;
    return base + n;
}

/**
 * @param {number|unknown[]} value
 * @param {number} factor
 */
function scaleOpacity(value, factor) {
    if (typeof value === 'number') return value * factor;
    return ['*', value, factor];
}

/**
 * @param {object} layerStyle
 * @param {string} [fiberKey]
 */
function resolveLineDash(layerStyle, fiberKey) {
    const fromStyle = layerStyle?._udotFiber?.lineDasharray;
    if (Array.isArray(fromStyle) && fromStyle.length) return fromStyle;
    return resolveEsriLineDasharray(getDrawingLayer(fiberKey)?.classes);
}

function lineLabelFilter(field, fiberKey) {
    const geom = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
    const hasText = field
        ? ['all', geom, ['has', field], ['!=', ['to-string', ['get', field]], '']]
        : geom;
    return combineUdotFiberMapLibreFilter(hasText, fiberKey);
}

function lineLabelSize(fiberKey) {
    const base = fiberKey === 'conduit' ? 10 : 11;
    return [
        'interpolate', ['linear'], ['zoom'],
        15, base,
        17, base + 0.5,
        20, base + 1
    ];
}

/**
 * Along-line labels that stay readable on any basemap (dual halo).
 * @returns {object[]}
 */
export function buildUdotFiberLabelSpecs({
    datasetId,
    sourceId,
    layerStyle,
    fiberKey,
    minz
} = {}) {
    try {
        const labelCfg = resolveLayerLabels(layerStyle, null);
        if (!labelCfg?.field) return [];
        const base = buildMapLabelLayerSpec(datasetId, sourceId, labelCfg, false);
        if (!base) return [];

        const labelId = `svc-${base.id}`;
        const isLine = labelCfg.placement === 'line'
            || fiberKey === 'fiber'
            || fiberKey === 'conduit';
        const layout = {
            ...base.layout,
            'text-font': UDOT_FIBER_LABEL_FONT,
            'text-pitch-alignment': isLine ? 'map' : 'viewport',
            'text-letter-spacing': 0.03,
            'text-padding': isLine ? 8 : 2,
            'text-max-width': 24,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-optional': true
        };
        if (isLine) {
            layout['symbol-placement'] = 'line';
            layout['symbol-spacing'] = 360;
            layout['text-max-angle'] = 45;
            layout['text-keep-upright'] = true;
            layout['text-rotation-alignment'] = 'map';
            layout['text-size'] = lineLabelSize(fiberKey);
            delete layout['text-offset'];
            delete layout['text-anchor'];
        } else if (typeof layout['text-size'] === 'number') {
            layout['text-size'] = buildUdotFiberLineWidthExpression(layout['text-size'], fiberKey);
        }

        const filter = isLine
            ? lineLabelFilter(labelCfg.field, fiberKey)
            : combineUdotFiberMapLibreFilter(base.filter, fiberKey);
        const labelMin = isLine
            ? Math.max(15, Number(base.minzoom) || 0, minz ?? 0)
            : (minz != null ? Math.max(Number(base.minzoom) || 0, minz) : base.minzoom);
        const shared = {
            type: 'symbol',
            source: sourceId,
            filter,
            minzoom: labelMin,
            maxzoom: base.maxzoom
        };

        if (isLine) {
            return [{
                ...shared,
                id: labelId,
                layout: { ...layout },
                paint: {
                    'text-color': '#111827',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2.6,
                    'text-halo-blur': 0.05,
                    'text-opacity': 1
                }
            }];
        }

        return [
            {
                ...shared,
                id: `${labelId}-plate`,
                layout: { ...layout },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': '#0a0a0a',
                    'text-halo-width': 2.1,
                    'text-halo-blur': 0.1,
                    'text-opacity': 0.92
                }
            },
            {
                ...shared,
                id: labelId,
                layout: { ...layout },
                paint: {
                    'text-color': layerStyle?.labels?.color ?? labelCfg.color,
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 0.95,
                    'text-opacity': 1
                }
            }
        ];
    } catch (error) {
        logger.warn('UdotFiber', 'Label specs skipped', { error: error?.message || String(error) });
        return [];
    }
}

/**
 * @param {object} p
 * @returns {object[]}
 */
export function buildUdotFiberLayerSpecs({
    datasetId,
    sourceId,
    layerStyle,
    opacity = 1,
    fiberKey,
    minzoom
} = {}) {
    const styPoly = compilePaint(layerStyle, 'polygon');
    const styLine = compilePaint(layerStyle, 'line');
    const styPoint = compilePaint(layerStyle, 'point');
    const geometry = resolveUdotFiberPaintGeometry(layerStyle, fiberKey);
    const minz = Number.isFinite(Number(minzoom)) ? Number(minzoom) : undefined;
    const zoomOpt = minz != null ? { minzoom: minz } : {};
    const specs = [];

    specs.push({
        id: `svc-lyr-${datasetId}-fill`,
        type: 'fill',
        source: sourceId,
        ...zoomOpt,
        filter: combineUdotFiberMapLibreFilter(
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            fiberKey
        ),
        paint: {
            'fill-color': styPoly.fillColor,
            'fill-opacity': scaleOpacity(styPoly.fillOpacity, opacity * 0.35)
        }
    });

    if (geometry === 'line' || fiberKey === 'fiber' || fiberKey === 'conduit') {
        const baseWidth = LINE_CORE_WIDTH[fiberKey]
            ?? (typeof styLine.strokeWidth === 'number' ? styLine.strokeWidth : 1.2);
        const coreWidth = buildUdotFiberLineWidthExpression(baseWidth, fiberKey);
        const dash = resolveLineDash(layerStyle, fiberKey);

        const lineLayer = (id, layout, paint) => ({
            id,
            type: 'line',
            source: sourceId,
            ...zoomOpt,
            filter: combineUdotFiberMapLibreFilter(
                ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false],
                fiberKey
            ),
            layout,
            paint
        });

        specs.push(lineLayer(
            `svc-lyr-${datasetId}-casing`,
            { 'line-cap': 'round', 'line-join': 'round' },
            {
                'line-color': CASING_COLOR,
                'line-width': buildUdotFiberLineWidthExpression(
                    widenLineWidth(baseWidth, CASING_EXTRA, baseWidth),
                    fiberKey
                ),
                'line-opacity': CASING_OPACITY * opacity
            }
        ));
        specs.push(lineLayer(
            `svc-lyr-${datasetId}-glow`,
            { 'line-cap': 'round', 'line-join': 'round' },
            {
                'line-color': styLine.strokeColor,
                'line-width': buildUdotFiberLineWidthExpression(
                    widenLineWidth(baseWidth, GLOW_EXTRA, baseWidth),
                    fiberKey
                ),
                'line-blur': GLOW_BLUR,
                'line-opacity': GLOW_OPACITY * opacity
            }
        ));
        const corePaint = {
            'line-color': styLine.strokeColor,
            'line-width': coreWidth,
            'line-opacity': scaleOpacity(styLine.strokeOpacity, opacity)
        };
        const coreLayout = { 'line-cap': 'round', 'line-join': 'round' };
        if (Array.isArray(dash) && dash.length) {
            corePaint['line-dasharray'] = dash;
            coreLayout['line-cap'] = 'butt';
        }
        specs.push(lineLayer(`svc-lyr-${datasetId}-line`, coreLayout, corePaint));
    }

    if (geometry === 'point') {
        specs.push({
            id: `svc-lyr-${datasetId}-circle`,
            type: 'circle',
            source: sourceId,
            ...zoomOpt,
            filter: combineUdotFiberMapLibreFilter(
                ['all',
                    ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
                    ['!', ['has', '_udotGlyph']]
                ],
                fiberKey
            ),
            paint: {
                'circle-radius': buildUdotFiberCircleRadiusExpression(styPoint.circleRadius, fiberKey),
                'circle-color': styPoint.fillColor,
                'circle-stroke-color': '#0a0a0a',
                'circle-stroke-width': 1.15,
                'circle-stroke-opacity': 0.55 * opacity,
                'circle-opacity': scaleOpacity(styPoint.fillOpacity, opacity),
                'circle-pitch-alignment': 'viewport'
            }
        });
        specs.push({
            id: `svc-lyr-${datasetId}-glyph`,
            type: 'symbol',
            source: sourceId,
            ...zoomOpt,
            filter: combineUdotFiberMapLibreFilter(
                ['all',
                    ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
                    ['has', '_udotGlyph']
                ],
                fiberKey
            ),
            layout: {
                'icon-image': ['get', '_udotGlyph'],
                'icon-size': buildUdotFiberIconSizeExpression(fiberKey),
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-pitch-alignment': 'viewport',
                'icon-rotation-alignment': 'map',
                'icon-rotate': buildUdotFiberIconRotateExpression()
            }
        });
        specs.push({
            id: `svc-lyr-${datasetId}-hit`,
            type: 'circle',
            source: sourceId,
            ...zoomOpt,
            filter: combineUdotFiberMapLibreFilter(
                ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
                fiberKey
            ),
            paint: {
                'circle-radius': buildUdotFiberHitRadiusExpression(fiberKey),
                'circle-color': '#000000',
                'circle-opacity': 0,
                'circle-stroke-width': 0
            }
        });
    }

    specs.push(...buildUdotFiberLabelSpecs({
        datasetId,
        sourceId,
        layerStyle,
        fiberKey,
        minz
    }));

    return specs;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {object[]} specs
 * @returns {string[]}
 */
function addSpecsSafely(map, specs) {
    const ids = [];
    for (const spec of specs) {
        try {
            if (map.getLayer(spec.id)) map.removeLayer(spec.id);
            map.addLayer(spec);
            ids.push(spec.id);
        } catch (error) {
            logger.warn('UdotFiber', 'addLayer rejected', {
                id: spec.id,
                type: spec.type,
                error: error?.message || String(error)
            });
        }
    }
    return ids;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {object} layerStyle
 * @param {number} opacity
 * @param {{ fiberKey?: string, minZoom?: number|null }} [opts]
 * @returns {string[]}
 */
export function addUdotFiberVectorLayers(map, datasetId, sourceId, layerStyle, opacity, opts = {}) {
    preloadUdotFiberGlyphs(map);
    let specs = [];
    try {
        specs = buildUdotFiberLayerSpecs({
            datasetId,
            sourceId,
            layerStyle,
            opacity,
            fiberKey: opts.fiberKey,
            minzoom: opts.minZoom
        });
    } catch (error) {
        logger.warn('UdotFiber', 'Paint specs failed; using core line fallback', {
            error: error?.message || String(error)
        });
    }
    const ids = addSpecsSafely(map, specs);
    const needsLine = opts.fiberKey === 'fiber' || opts.fiberKey === 'conduit';
    if (needsLine && !ids.some((id) => id.endsWith('-line'))) {
        const styLine = compilePaint(layerStyle, 'line');
        const minz = Number.isFinite(Number(opts.minZoom)) ? Number(opts.minZoom) : undefined;
        return ids.concat(addSpecsSafely(map, [{
            id: `svc-lyr-${datasetId}-line`,
            type: 'line',
            source: sourceId,
            ...(minz != null ? { minzoom: minz } : {}),
            filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': styLine.strokeColor || '#94a3b8',
                'line-width': LINE_CORE_WIDTH[opts.fiberKey] || 1.2,
                'line-opacity': 1
            }
        }]));
    }
    return ids;
}
