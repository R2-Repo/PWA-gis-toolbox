/**
 * MapLibre text label layer config for GeoJSON sources.
 */

import { parseArcgisLabelField } from '../arcgis/drawing-info.js';
import { geometryPresence } from './geometry-kind.js';
import { LOCAL_GLYPH_FONT_STACK } from './local-glyphs.js';
import { POLYGON_ANCHOR_PROPERTY } from './polygon-label-anchors.js';
import { MAPLIBRE_MAX_ZOOM } from './scale-range.js';

export const DEFAULT_LAYER_LABELS = {
    enabled: false,
    field: '',
    field2: '',
    decimals: null,
    prefix: '',
    suffix: '',
    template: '',
    expressionNote: '',
    placement: 'point',
    minZoom: 11,
    maxZoom: MAPLIBRE_MAX_ZOOM,
    size: 11,
    offset: [0, 1.1],
    anchor: 'top',
    color: '#111111',
    haloColor: '#ffffff',
    haloWidth: 1.5,
    verticalStack: false,
    writingMode: null,
    rotateField: null,
    lineHeight: 0.95,
    allowOverlap: false,
    ignorePlacement: false
};

/** Faces in the same-origin glyph bundle (public/fonts, range 0-255). */
export const APP_MAP_TEXT_FONTS = LOCAL_GLYPH_FONT_STACK;

const DEFAULT_LABELS = {
    field: 'station',
    field2: '',
    decimals: null,
    prefix: '',
    suffix: '',
    template: '',
    placement: 'point',
    minZoom: 11,
    maxZoom: MAPLIBRE_MAX_ZOOM,
    size: 11,
    offset: [0, 1.1],
    anchor: 'top',
    color: '#111111',
    haloColor: '#ffffff',
    haloWidth: 1.5,
    verticalStack: false,
    rotateField: null,
    lineHeight: 0.95,
    allowOverlap: false,
    ignorePlacement: false
};

const NAME_LIKE_FIELD_RE = /^(name|label|title|station|route|road|street|description|desc)$/i;

/** Point placement on real point features. Polygons use a one-point anchor source. */
export const POINT_LABEL_GEOMETRY_TYPES = ['Point', 'MultiPoint'];
/** Clustered GeoJSON sources only contain point features. */
export const CLUSTER_LABEL_GEOMETRY_TYPES = ['Point', 'MultiPoint'];
export const LINE_LABEL_GEOMETRY_TYPES = ['LineString', 'MultiLineString'];

/**
 * @param {string[]} types
 * @returns {unknown[]}
 */
export function geometryTypeMatchFilter(types) {
    return ['match', ['geometry-type'], [...types], true, false];
}

/**
 * Whether a label layer should be added for this geometry mix.
 * Point placement covers points and polygons (including polygon-only and
 * workspace viewport packets). Line placement covers line geometries only.
 * @param {object|null|undefined} mapLabels
 * @param {{ hasPoints?: boolean, hasLines?: boolean, hasPolygons?: boolean }} [presence]
 * @returns {boolean}
 */
export function shouldInstallLabelLayer(mapLabels, { hasPoints = false, hasLines = false, hasPolygons = false } = {}) {
    if (!mapLabels?.field || mapLabels.enabled === false) return false;
    if (mapLabels.placement === 'line') return !!hasLines;
    return !!(hasPoints || hasPolygons);
}

/**
 * Labels panel hint for the active placement.
 * @param {{ placement?: string, hasPoints?: boolean, hasPolygons?: boolean }} [opts]
 * @returns {string}
 */
export function labelPlacementHint({ placement, hasPoints = false, hasPolygons = false } = {}) {
    if (placement === 'line') return 'Labels follow line geometry';
    if (hasPolygons) return 'Labels at an interior point';
    if (hasPoints) return 'Labels at point locations';
    return 'Labels at an interior point';
}

/**
 * Geometry mix for label installation.
 * Workspace viewport packets are a partial view, so the stored schema is
 * included when `includeSchema` is set — a later setData of the same source
 * can then label polygons that were outside the first packet.
 * @param {object[]|null|undefined} features
 * @param {string|null|undefined} schemaGeometryType
 * @param {{ includeSchema?: boolean }} [opts]
 * @returns {{ hasPoints: boolean, hasLines: boolean, hasPolygons: boolean }}
 */
export function labelGeometryPresence(features, schemaGeometryType, { includeSchema = false } = {}) {
    return geometryPresence(features, schemaGeometryType, { includeSchema });
}

/**
 * @param {string} layerId
 * @returns {boolean}
 */
export function isMapLabelLayerId(layerId) {
    return typeof layerId === 'string'
        && (layerId.endsWith('-labels')
            || layerId.endsWith('-line-labels')
            || layerId.endsWith('-labels-plate')
            || layerId.endsWith('-line-labels-plate'));
}

/**
 * Intersect label zoom window with optional layer visibility range.
 * @param {object|null|undefined} labelsConfig
 * @param {{ minzoom: number, maxzoom: number }|null} layerZoomRange
 * @returns {{ minzoom: number, maxzoom: number }}
 */
export function resolveEffectiveLabelZoomRange(labelsConfig, layerZoomRange) {
    const labelMin = Number.isFinite(labelsConfig?.minZoom)
        ? labelsConfig.minZoom
        : DEFAULT_LAYER_LABELS.minZoom;
    const labelMax = Number.isFinite(labelsConfig?.maxZoom)
        ? labelsConfig.maxZoom
        : DEFAULT_LAYER_LABELS.maxZoom;

    if (!layerZoomRange) {
        return { minzoom: labelMin, maxzoom: labelMax };
    }

    return {
        minzoom: Math.max(labelMin, layerZoomRange.minzoom),
        maxzoom: Math.min(labelMax, layerZoomRange.maxzoom)
    };
}

/**
 * @param {Array<{ name: string, type?: string, uniqueCount?: number, selected?: boolean }>} fields
 * @returns {object|null}
 */
export function pickLabelField(fields) {
    const visible = (fields || []).filter((f) => f.selected !== false && f.name);
    const nameLike = visible.find((f) => NAME_LIKE_FIELD_RE.test(f.name));
    if (nameLike) return nameLike;
    return visible.find((f) => f.type === 'string' || (f.uniqueCount ?? Infinity) <= 50)
        || visible.find((f) => f.type === 'number')
        || visible[0]
        || null;
}

/**
 * @param {object[]} features
 * @param {string} field
 * @param {number} [limit]
 * @returns {string[]}
 */
export function sampleFieldValues(features, field, limit = 3) {
    if (!field || !features?.length) return [];
    const out = [];
    const seen = new Set();
    for (const f of features) {
        const raw = f?.properties?.[field];
        if (raw == null || raw === '') continue;
        const text = String(raw);
        if (seen.has(text)) continue;
        seen.add(text);
        out.push(text);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * @param {object[]} features
 * @param {string} field
 * @param {number} [sampleSize]
 * @returns {number} fraction empty in sample (0–1)
 */
export function fieldEmptyRatio(features, field, sampleSize = 20) {
    if (!field || !features?.length) return 1;
    const sample = features.slice(0, sampleSize);
    let empty = 0;
    for (const f of sample) {
        const raw = f?.properties?.[field];
        if (raw == null || raw === '') empty++;
    }
    return empty / sample.length;
}

/**
 * @param {unknown} value
 * @returns {number|null} 0–8, or null when decimals are left as stored
 */
export function normalizeLabelDecimals(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 8) return null;
    return n;
}

/**
 * @param {object|null|undefined} labels
 * @returns {boolean}
 */
export function labelUsesFormat(labels) {
    if (!labels) return false;
    if (normalizeLabelDecimals(labels.decimals) != null) return true;
    if (String(labels.prefix || '') !== '') return true;
    if (String(labels.suffix || '') !== '') return true;
    if (String(labels.template || '').trim() !== '') return true;
    if (String(labels.field2 || '').trim() !== '') return true;
    return false;
}

/**
 * @param {unknown} raw
 * @param {unknown} decimals
 * @returns {string}
 */
export function formatLabelPart(raw, decimals) {
    if (raw == null || raw === '') return '';
    const places = normalizeLabelDecimals(decimals);
    if (places == null) return String(raw);
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return String(raw);
    return n.toFixed(places);
}

/**
 * Plain-text label for one feature. A template replaces prefix and suffix.
 * @param {object|null|undefined} properties
 * @param {object|null|undefined} labels
 * @returns {string}
 */
export function formatLabelText(properties, labels) {
    if (!labels?.field) return '';
    const primary = formatLabelPart(properties?.[labels.field], labels.decimals);
    const field2 = String(labels.field2 || '').trim();
    const secondary = field2 ? formatLabelPart(properties?.[field2], labels.decimals) : '';
    const template = String(labels.template || '');
    if (template.trim()) {
        return template.replaceAll('{value2}', secondary).replaceAll('{value}', primary);
    }
    const prefix = String(labels.prefix || '');
    const suffix = String(labels.suffix || '');
    let body = primary;
    if (field2 && secondary !== '') {
        body = primary === '' ? secondary : `${primary} ${secondary}`;
    }
    if (!prefix && !suffix && body === '') return '';
    return `${prefix}${body}${suffix}`;
}

/**
 * MapLibre text-field. Unformatted labels stay a plain to-string get.
 * @param {object} cfg
 * @returns {unknown}
 */
export function buildLabelTextField(cfg) {
    if (!cfg?.field) return '';
    if (!labelUsesFormat(cfg)) return ['to-string', ['get', cfg.field]];

    const decimals = normalizeLabelDecimals(cfg.decimals);
    const primary = formattedFieldExpression(cfg.field, decimals);
    const field2 = String(cfg.field2 || '').trim();
    const secondary = field2 ? formattedFieldExpression(field2, decimals) : '';
    const template = String(cfg.template || '');
    if (template.trim()) return compileLabelTemplate(template, primary, secondary);
    const parts = [];
    const prefix = String(cfg.prefix || '');
    const suffix = String(cfg.suffix || '');
    if (prefix) parts.push(prefix);
    parts.push(primary);
    if (secondary) {
        parts.push(['case', ['==', secondary, ''], '', ['concat', ' ', secondary]]);
    }
    if (suffix) parts.push(suffix);
    if (parts.length === 1) return parts[0];
    return ['concat', ...parts];
}

function formattedFieldExpression(field, decimals) {
    const asText = ['to-string', ['coalesce', ['get', field], '']];
    if (decimals == null) return ['to-string', ['get', field]];
    const formatOpts = {
        'min-fraction-digits': decimals,
        'max-fraction-digits': decimals
    };
    // to-number keeps the branch a number. MapLibre does not narrow typeof checks.
    return ['case',
        ['==', ['typeof', ['get', field]], 'number'],
        ['number-format', ['to-number', ['get', field]], formatOpts],
        asText
    ];
}

function compileLabelTemplate(template, primary, secondary) {
    const parts = [];
    const re = /\{value2\}|\{value\}/g;
    let last = 0;
    let match;
    while ((match = re.exec(template)) !== null) {
        if (match.index > last) parts.push(template.slice(last, match.index));
        parts.push(match[0] === '{value2}' ? (secondary || '') : primary);
        last = match.index + match[0].length;
    }
    if (last < template.length) parts.push(template.slice(last));
    const flat = parts.filter((part) => part !== '');
    if (!flat.length) return '';
    if (flat.length === 1) return flat[0];
    return ['concat', ...flat];
}

/**
 * @param {object|null|undefined} entry labelingInfo entry
 * @returns {string}
 */
export function arcgisLabelExpressionText(entry) {
    if (!entry) return '';
    const classic = String(entry.labelExpression || '').trim();
    if (classic) return classic;
    return String(
        entry.labelExpressionInfo?.expression
        || entry.labelExpressionInfo?.value
        || ''
    ).trim();
}

/**
 * @param {object|null|undefined} drawingInfo
 * @returns {object|null}
 */
export function labelingEntryFromDrawingInfo(drawingInfo) {
    const entries = drawingInfo?.labelingInfo;
    if (!Array.isArray(entries)) return null;
    return entries.find((entry) => entry && (entry.labelExpression || entry.labelExpressionInfo)) || null;
}

/**
 * Plain sentence when a published expression is more than one field.
 * A single `[FIELD]` or `$feature.FIELD` expression is not simplified.
 * @param {object|null|undefined} entry
 * @param {string} [appliedField]
 * @returns {string}
 */
export function simplifiedArcgisLabelNote(entry, appliedField = '') {
    const text = arcgisLabelExpressionText(entry);
    if (!text) return '';
    if (parseArcgisLabelField(entry)) return '';
    const field = String(appliedField || '').trim();
    if (field) return `The ArcGIS label expression was simplified to the field ${field}.`;
    return 'The ArcGIS label expression was simplified and was not applied.';
}

/**
 * Attach expressionNote on a style built from ArcGIS drawingInfo.
 * @param {object|null|undefined} style
 * @param {object|null|undefined} drawingInfo
 * @returns {object|null|undefined}
 */
export function annotateSimplifiedArcgisLabels(style, drawingInfo) {
    if (!style || typeof style !== 'object') return style;
    const entry = labelingEntryFromDrawingInfo(drawingInfo);
    const note = simplifiedArcgisLabelNote(entry, style.labels?.field || '');
    if (!note) return style;
    const labels = style.labels && typeof style.labels === 'object'
        ? { ...style.labels }
        : { enabled: false, field: '' };
    labels.expressionNote = note;
    style.labels = labels;
    return style;
}

/**
 * Resolve active label config from layer style or legacy dataset._mapLabels.
 * @param {object|null} style
 * @param {object|null} dataset
 * @returns {object|null} normalized mapLabels for buildMapLabelLayerSpec
 */
export function resolveLayerLabels(style, dataset) {
    const fromStyle = style?.labels;
    if (fromStyle != null) {
        if (fromStyle.enabled === false) return null;
        if (fromStyle.enabled && fromStyle.field) {
            const { enabled, ...rest } = fromStyle;
            return normalizeMapLabels(rest);
        }
        // Explicit labels block present but incomplete (e.g. enabled without field).
        // Do not fall through to legacy _mapLabels — that fights the Labels UI.
        if (Object.prototype.hasOwnProperty.call(fromStyle, 'enabled')) return null;
    }
    if (dataset?._mapLabels?.field) {
        return normalizeMapLabels(dataset._mapLabels);
    }
    return null;
}

/**
 * Copy legacy dataset._mapLabels into style.labels when style has no labels block yet.
 * Respects an explicit style.labels object, including enabled:false (user turned labels off).
 * @param {object|null|undefined} style
 * @param {object|null|undefined} dataset
 * @returns {object}
 */
export function mergeDatasetLabelsIntoStyle(style, dataset) {
    const base = style && typeof style === 'object' ? { ...style } : {};
    if (base.labels != null) return base;
    if (!dataset?._mapLabels?.field) return base;
    return {
        ...base,
        labels: normalizeLayerLabels({
            enabled: true,
            ...dataset._mapLabels
        })
    };
}

/**
 * @param {object|null} labels partial labels block from layer style
 * @returns {object}
 */
export function normalizeLayerLabels(labels) {
    if (!labels) return { ...DEFAULT_LAYER_LABELS, offset: [...DEFAULT_LAYER_LABELS.offset] };
    return {
        ...DEFAULT_LAYER_LABELS,
        ...labels,
        field2: typeof labels.field2 === 'string' ? labels.field2 : '',
        decimals: normalizeLabelDecimals(labels.decimals),
        prefix: typeof labels.prefix === 'string' ? labels.prefix : '',
        suffix: typeof labels.suffix === 'string' ? labels.suffix : '',
        template: typeof labels.template === 'string' ? labels.template : '',
        expressionNote: typeof labels.expressionNote === 'string' ? labels.expressionNote : '',
        offset: Array.isArray(labels.offset) ? [...labels.offset] : [...DEFAULT_LAYER_LABELS.offset]
    };
}

/**
 * Resolve KML placemark name from label config or fallback properties.
 * @param {object} feature
 * @param {number} idx
 * @param {object|null} style
 * @returns {string}
 */
export function resolvePlacemarkLabel(feature, idx, style) {
    if (feature?.properties?._annotationType && feature?.properties?.text) {
        return String(feature.properties.text);
    }
    const labels = style?.labels;
    if (labels?.enabled && labels.field) {
        const text = formatLabelText(feature?.properties, labels);
        if (text !== '') return text;
    }
    const props = feature?.properties || {};
    return props.name || props.Name || props.NAME || `Feature ${idx + 1}`;
}

/**
 * @param {object} mapLabels
 */
export function normalizeMapLabels(mapLabels) {
    if (!mapLabels?.field) return null;
    const cfg = { ...DEFAULT_LABELS, ...mapLabels };
    // Style normalize can store a missing offset as undefined, which MapLibre rejects.
    if (!Array.isArray(cfg.offset)) cfg.offset = [...DEFAULT_LABELS.offset];
    return cfg;
}

function pointLabelLayout(cfg, extraLayout = {}) {
    const layout = {
        'symbol-placement': 'point',
        'text-field': buildLabelTextField(cfg),
        'text-font': APP_MAP_TEXT_FONTS,
        'text-size': cfg.size,
        'text-offset': cfg.offset,
        'text-anchor': cfg.verticalStack ? (cfg.anchor || 'bottom') : (cfg.anchor || 'top'),
        'text-allow-overlap': cfg.allowOverlap,
        'text-ignore-placement': cfg.ignorePlacement,
        ...extraLayout
    };

    if (cfg.verticalStack || cfg.writingMode === 'vertical') {
        layout['text-line-height'] = cfg.lineHeight;
        layout['text-rotation-alignment'] = 'map';
        layout['text-pitch-alignment'] = 'map';
        layout['text-anchor'] = cfg.anchor || 'center';
        layout['text-offset'] = cfg.offset || [0, 0];
        if (cfg.writingMode === 'vertical') {
            layout['text-writing-mode'] = ['vertical'];
        }
        if (cfg.rotateField) {
            layout['text-rotate'] = ['get', cfg.rotateField];
        }
    }
    return layout;
}

function pointLabelPaint(cfg) {
    return {
        'text-color': cfg.color,
        'text-halo-color': cfg.haloColor,
        'text-halo-width': cfg.haloWidth
    };
}

/**
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {object} mapLabels
 * @param {boolean} [useCluster]
 */
export function buildMapLabelLayerSpec(datasetId, sourceId, mapLabels, useCluster = false) {
    const cfg = normalizeMapLabels(mapLabels);
    if (!cfg) return null;

    if (cfg.placement === 'line') {
        return buildMapLineLabelLayerSpec(datasetId, sourceId, cfg);
    }

    const labelId = `${datasetId}-labels`;
    const filter = useCluster
        ? ['all', geometryTypeMatchFilter(CLUSTER_LABEL_GEOMETRY_TYPES), ['!', ['has', 'point_count']]]
        : geometryTypeMatchFilter(POINT_LABEL_GEOMETRY_TYPES);

    return {
        id: labelId,
        type: 'symbol',
        source: sourceId,
        filter,
        minzoom: cfg.minZoom,
        maxzoom: cfg.maxZoom,
        layout: pointLabelLayout(cfg),
        paint: pointLabelPaint(cfg)
    };
}

/**
 * Label layer for polygon anchor points. One feature per polygon, so a
 * polygon that spans several tiles is not labeled again in each tile.
 * @param {string} datasetId
 * @param {string} sourceId anchor GeoJSON source, or the vector-tile source
 * @param {object} mapLabels
 * @param {{ layerId?: string }} [opts]
 */
export function buildPolygonAnchorLabelLayerSpec(datasetId, sourceId, mapLabels, { layerId = null } = {}) {
    const cfg = normalizeMapLabels(mapLabels);
    if (!cfg || cfg.placement === 'line') return null;

    return {
        id: layerId || `${datasetId}-labels`,
        type: 'symbol',
        source: sourceId,
        filter: ['==', ['to-number', ['get', POLYGON_ANCHOR_PROPERTY], 0], 1],
        minzoom: cfg.minZoom,
        maxzoom: cfg.maxZoom,
        layout: pointLabelLayout(cfg, { 'symbol-avoid-edges': true }),
        paint: pointLabelPaint(cfg)
    };
}

/**
 * Line-following labels (symbol-placement: line).
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {object} cfg normalized mapLabels config
 */
export function buildMapLineLabelLayerSpec(datasetId, sourceId, cfg) {
    const labelId = `${datasetId}-line-labels`;

    const layout = {
        'symbol-placement': 'line',
        'text-field': buildLabelTextField(cfg),
        'text-font': APP_MAP_TEXT_FONTS,
        'text-size': cfg.size,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-keep-upright': cfg.writingMode === 'vertical' ? false : true,
        'text-allow-overlap': cfg.allowOverlap,
        'text-ignore-placement': cfg.ignorePlacement
    };

    if (cfg.writingMode === 'vertical') {
        layout['text-writing-mode'] = ['vertical'];
    }

    return {
        id: labelId,
        type: 'symbol',
        source: sourceId,
        filter: geometryTypeMatchFilter(LINE_LABEL_GEOMETRY_TYPES),
        minzoom: cfg.minZoom,
        maxzoom: cfg.maxZoom,
        layout,
        paint: {
            'text-color': cfg.color,
            'text-halo-color': cfg.haloColor,
            'text-halo-width': cfg.haloWidth
        }
    };
}
