/**
 * MapLibre text label layer config for GeoJSON sources.
 */

import { MAPLIBRE_MAX_ZOOM } from './scale-range.js';

export const DEFAULT_LAYER_LABELS = {
    enabled: false,
    field: '',
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

/** Fonts available on CARTO glyphs (and demotiles Open Sans). */
export const APP_MAP_TEXT_FONTS = ['Open Sans Regular', 'Noto Sans Regular'];

const DEFAULT_LABELS = {
    field: 'station',
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
    if (!labels) return { ...DEFAULT_LAYER_LABELS };
    return {
        ...DEFAULT_LAYER_LABELS,
        ...labels,
        offset: Array.isArray(labels.offset) ? [...labels.offset] : DEFAULT_LAYER_LABELS.offset
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
        const val = feature?.properties?.[labels.field];
        if (val != null && val !== '') return String(val);
    }
    const props = feature?.properties || {};
    return props.name || props.Name || props.NAME || `Feature ${idx + 1}`;
}

/**
 * @param {object} mapLabels
 */
export function normalizeMapLabels(mapLabels) {
    if (!mapLabels?.field) return null;
    return { ...DEFAULT_LABELS, ...mapLabels };
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
        ? ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'point_count']]]
        : ['==', ['geometry-type'], 'Point'];

    const layout = {
        'text-field': ['to-string', ['get', cfg.field]],
        'text-font': APP_MAP_TEXT_FONTS,
        'text-size': cfg.size,
        'text-offset': cfg.offset,
        'text-anchor': cfg.verticalStack ? (cfg.anchor || 'bottom') : (cfg.anchor || 'top'),
        'text-allow-overlap': cfg.allowOverlap,
        'text-ignore-placement': cfg.ignorePlacement
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

    return {
        id: labelId,
        type: 'symbol',
        source: sourceId,
        filter,
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
        'text-field': ['to-string', ['get', cfg.field]],
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
        filter: ['==', ['geometry-type'], 'LineString'],
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
