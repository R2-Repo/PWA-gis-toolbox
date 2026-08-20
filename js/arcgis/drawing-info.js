/**
 * Convert ArcGIS REST `drawingInfo` (renderer + labelingInfo) to a GIS Toolbox
 * layer style. This is the same metadata ArcGIS uses when it generates KML for
 * Google Earth — importing the FeatureServer URL already has it; we were
 * discarding it and downloading geometry only.
 */
import { scaleToZoom } from '../map/scale-range.js';
import { normalizeStyle } from '../map/style-engine.js';

export const MAX_UNIQUE_CLASSES = 200;
const DEFAULT_LATITUDE = 40;
const OID_FIELD_RE = /^(objectid|objectid_\d*|fid|oid|globalid|esri_oid)$/i;
const DEFAULT_UNIQUE_FALLBACK = '#94a3b8';

/**
 * @param {unknown} geometryType GeoJSON or esriGeometry* type
 * @returns {'point'|'line'|'polygon'}
 */
export function geometryKindFromArcgis(geometryType) {
    const t = String(geometryType || '');
    if (/line|polyline/i.test(t)) return 'line';
    if (/point/i.test(t)) return 'point';
    return 'polygon';
}

function clampByte(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(255, Math.round(v)));
}

function toHexByte(n) {
    return clampByte(n).toString(16).padStart(2, '0');
}

/**
 * ArcGIS colors are `[r, g, b, a]` with alpha 0–255.
 * @param {unknown} color
 * @returns {{ hex: string, opacity: number }|null}
 */
export function esriColorToCss(color) {
    if (color == null) return null;
    if (typeof color === 'string') {
        const hex = color.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) return { hex, opacity: 1 };
        if (/^#[0-9a-fA-F]{8}$/.test(hex)) {
            const a = parseInt(hex.slice(7, 9), 16) / 255;
            return { hex: hex.slice(0, 7), opacity: a };
        }
        return null;
    }
    if (Array.isArray(color) && color.length >= 3) {
        return {
            hex: `#${toHexByte(color[0])}${toHexByte(color[1])}${toHexByte(color[2])}`,
            opacity: color.length > 3 ? clampByte(color[3]) / 255 : 1
        };
    }
    if (typeof color === 'object') {
        if (color.r != null || color.red != null) {
            const r = color.r ?? color.red;
            const g = color.g ?? color.green;
            const b = color.b ?? color.blue;
            const a = color.a ?? color.alpha;
            return {
                hex: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`,
                opacity: a == null ? 1 : (Number(a) > 1 ? clampByte(a) / 255 : Number(a))
            };
        }
        if (Array.isArray(color.values) && color.values.length >= 3) {
            return esriColorToCss(color.values);
        }
    }
    return null;
}

function extractCimFlat(symbol) {
    const data = symbol?.data || symbol;
    const layers = data?.symbolLayers || data?.symbol?.symbolLayers;
    if (!Array.isArray(layers) || !layers.length) return {};
    const flat = {};
    for (const layer of layers) {
        const fill = esriColorToCss(layer.color || layer.fillColor);
        const stroke = esriColorToCss(layer.strokeColor || layer.outlineColor || layer.color);
        const type = String(layer.type || '');
        if (/stroke|line/i.test(type)) {
            if (stroke?.hex) {
                flat.strokeColor = stroke.hex;
                if (stroke.opacity < 1) flat.strokeOpacity = stroke.opacity;
            }
            const w = Number(layer.width ?? layer.size);
            if (Number.isFinite(w) && w > 0) flat.strokeWidth = w;
        } else {
            if (fill?.hex) {
                flat.fillColor = fill.hex;
                if (fill.opacity < 1) flat.fillOpacity = fill.opacity;
            }
            if (stroke?.hex && !flat.strokeColor) flat.strokeColor = stroke.hex;
        }
    }
    return flat;
}

/**
 * Flatten an ESRI symbol into paint properties our style engine understands.
 * Picture markers / CIM without a usable color return {}.
 * @param {object|null|undefined} symbol
 */
export function esriSymbolToFlat(symbol) {
    if (!symbol || typeof symbol !== 'object') return {};
    const type = String(symbol.type || '');
    if (type === 'CIMSymbolReference' || symbol.data?.symbolLayers || symbol.symbolLayers) {
        return extractCimFlat(symbol);
    }

    const flat = {};
    const color = esriColorToCss(symbol.color);
    const outline = symbol.outline ? esriSymbolToFlat(symbol.outline) : {};

    if (type === 'esriSLS' || /line/i.test(type)) {
        if (color?.hex) {
            flat.strokeColor = color.hex;
            if (color.opacity < 1) flat.strokeOpacity = color.opacity;
        }
        const width = Number(symbol.width);
        if (Number.isFinite(width) && width > 0) flat.strokeWidth = width;
        return { ...outline, ...flat };
    }

    if (type === 'esriSFS' || /fill/i.test(type)) {
        if (color?.hex) {
            flat.fillColor = color.hex;
            if (color.opacity < 1) flat.fillOpacity = color.opacity;
        }
        return { ...flat, ...outline };
    }

    if (type === 'esriSMS' || type === 'esriPMS' || /marker/i.test(type)) {
        if (color?.hex) {
            flat.fillColor = color.hex;
            flat.strokeColor = outline.strokeColor || color.hex;
            if (color.opacity < 1) flat.fillOpacity = color.opacity;
        } else if (outline.strokeColor) {
            flat.strokeColor = outline.strokeColor;
            flat.fillColor = outline.strokeColor;
        }
        if (outline.strokeWidth != null) flat.strokeWidth = outline.strokeWidth;
        const size = Number(symbol.size ?? symbol.width ?? symbol.height);
        if (Number.isFinite(size) && size > 0) {
            flat.pointSize = Math.max(3, Math.min(20, size / 1.4));
        }
        return flat;
    }

    if (type === 'esriTS') {
        if (color?.hex) flat.color = color.hex;
        const halo = esriColorToCss(symbol.haloColor);
        if (halo?.hex) flat.haloColor = halo.hex;
        if (symbol.haloSize != null) flat.haloWidth = Number(symbol.haloSize) || 1;
        const size = Number(symbol.font?.size ?? symbol.size);
        if (Number.isFinite(size) && size > 0) flat.size = size;
        return flat;
    }

    if (color?.hex) {
        flat.strokeColor = color.hex;
        flat.fillColor = color.hex;
        if (color.opacity < 1) {
            flat.strokeOpacity = color.opacity;
            flat.fillOpacity = color.opacity;
        }
    }
    return { ...outline, ...flat };
}

function uniqueClassFromSymbol(value, label, symbol, kind) {
    const flat = esriSymbolToFlat(symbol);
    const color = kind === 'line'
        ? (flat.strokeColor || flat.fillColor)
        : (flat.fillColor || flat.strokeColor);
    if (!color) return null;
    const style = {};
    if (flat.strokeWidth != null) style.strokeWidth = flat.strokeWidth;
    if (flat.pointSize != null) style.pointSize = flat.pointSize;
    if (flat.strokeOpacity != null) style.strokeOpacity = flat.strokeOpacity;
    if (flat.fillOpacity != null) style.fillOpacity = flat.fillOpacity;
    if (kind === 'line' && flat.strokeColor) style.strokeColor = flat.strokeColor;
    if (kind !== 'line' && flat.fillColor) style.fillColor = flat.fillColor;
    return {
        value: String(value),
        label: label || String(value),
        color,
        style
    };
}

function collectUniqueInfos(renderer) {
    const infos = [];
    const seen = new Set();
    const delim = renderer.fieldDelimiter || ', ';

    const push = (value, label, symbol) => {
        if (value == null || value === '') return;
        const key = String(value);
        if (seen.has(key)) return;
        seen.add(key);
        infos.push({ value: key, label: label || key, symbol });
    };

    for (const info of renderer.uniqueValueInfos || []) {
        push(info.value, info.label, info.symbol);
    }
    for (const group of renderer.uniqueValueGroups || []) {
        for (const cls of group.classes || []) {
            for (const tuple of cls.values || []) {
                const value = Array.isArray(tuple) ? tuple.filter((v) => v != null && v !== '').join(delim) : tuple;
                push(value, cls.label, cls.symbol);
            }
        }
    }
    return infos;
}

function channelForKind(kind) {
    if (kind === 'line') return 'stroke';
    if (kind === 'polygon') return 'both';
    return 'fill';
}

function applyFlatToStyle(style, flat, kind) {
    if (flat.strokeColor) style.strokeColor = flat.strokeColor;
    if (flat.fillColor) style.fillColor = flat.fillColor;
    else if (flat.strokeColor) style.fillColor = flat.strokeColor;
    if (flat.strokeWidth != null) style.strokeWidth = flat.strokeWidth;
    if (flat.strokeOpacity != null) style.strokeOpacity = flat.strokeOpacity;
    if (flat.fillOpacity != null) style.fillOpacity = flat.fillOpacity;
    if (flat.pointSize != null) style.pointSize = flat.pointSize;
    if (kind === 'line') {
        style.strokeOpacity = style.strokeOpacity ?? 1;
        style.fillOpacity = 1;
    }
}

function simpleStyleFromSymbol(symbol, kind, defaultColor) {
    const flat = esriSymbolToFlat(symbol);
    const color = kind === 'line'
        ? (flat.strokeColor || flat.fillColor || defaultColor)
        : (flat.fillColor || flat.strokeColor || defaultColor);
    const style = {
        mode: 'simple',
        strokeColor: color,
        fillColor: color,
        strokeWidth: kind === 'line' ? 2 : 1.25,
        strokeOpacity: 0.9,
        fillOpacity: kind === 'line' ? 1 : 0.35,
        pointSize: 6,
        pointSymbol: 'circle'
    };
    applyFlatToStyle(style, flat, kind);
    return style;
}

/**
 * Parse a simple `[FIELD]` / `$feature.FIELD` label expression.
 * Arcade concatenations and functions return null.
 * @param {object|null|undefined} labelingInfoEntry
 * @returns {string|null}
 */
export function parseArcgisLabelField(labelingInfoEntry) {
    if (!labelingInfoEntry) return null;
    const classic = String(labelingInfoEntry.labelExpression || '').trim();
    const arcade = String(
        labelingInfoEntry.labelExpressionInfo?.expression
        || labelingInfoEntry.labelExpressionInfo?.value
        || ''
    ).trim();

    const classicMatch = classic.match(/^\[([^\]]+)\]$/);
    if (classicMatch) return classicMatch[1];

    const arcadeField = arcade.match(/^\$feature\.([A-Za-z_][\w.]*)$/);
    if (arcadeField) return arcadeField[1].split('.').pop();

    const arcadeQuoted = arcade.match(/^\$feature\[\s*["']([^"']+)["']\s*\]$/);
    if (arcadeQuoted) return arcadeQuoted[1];

    return null;
}

function labelsFromDrawingInfo(drawingInfo, options = {}) {
    const kind = options.kind || 'polygon';
    const latitude = options.latitude ?? DEFAULT_LATITUDE;
    const entries = drawingInfo?.labelingInfo;
    const entry = Array.isArray(entries)
        ? entries.find((e) => e && (e.labelExpression || e.labelExpressionInfo))
        : null;
    const fieldFromInfo = parseArcgisLabelField(entry);
    const displayField = options.displayField && !OID_FIELD_RE.test(options.displayField)
        ? options.displayField
        : null;
    // Point-placement labels only attach to point geometries in MapLibre.
    // Auto-enable displayField labels for lines/points (Google Earth uses this as <name>).
    const field = fieldFromInfo || (kind === 'polygon' ? null : displayField);
    if (!field) return undefined;

    const placement = kind === 'line' || /line/i.test(entry?.labelPlacement || '')
        ? 'line'
        : 'point';

    const textFlat = esriSymbolToFlat(entry?.symbol);
    const minScale = Number(entry?.minScale);
    const convertedMin = Number.isFinite(minScale) && minScale > 0
        ? scaleToZoom(minScale, latitude)
        : null;

    return {
        enabled: true,
        field,
        placement,
        minZoom: convertedMin != null ? Math.max(0, Math.round(convertedMin * 10) / 10) : (kind === 'line' ? 8 : 6),
        maxZoom: 24,
        size: textFlat.size || (kind === 'line' ? 11 : 10),
        color: textFlat.color || '#111111',
        haloColor: textFlat.haloColor || '#ffffff',
        haloWidth: textFlat.haloWidth ?? 1.25,
        allowOverlap: false,
        ignorePlacement: false
    };
}

function uniqueStyleFromRenderer(renderer, kind) {
    const field1 = renderer.field1;
    if (!field1) return null;
    const infos = collectUniqueInfos(renderer);
    const classes = [];
    for (const info of infos) {
        if (classes.length >= MAX_UNIQUE_CLASSES) break;
        const cls = uniqueClassFromSymbol(info.value, info.label, info.symbol, kind);
        if (cls) classes.push(cls);
    }
    if (!classes.length) return null;

    const defaultFlat = esriSymbolToFlat(renderer.defaultSymbol);
    const defaultColor = kind === 'line'
        ? (defaultFlat.strokeColor || classes[0].color || DEFAULT_UNIQUE_FALLBACK)
        : (defaultFlat.fillColor || defaultFlat.strokeColor || classes[0].color || DEFAULT_UNIQUE_FALLBACK);

    const widths = classes.map((c) => c.style?.strokeWidth).filter((w) => w != null);
    const typicalWidth = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)]
        || defaultFlat.strokeWidth
        || (kind === 'line' ? 2 : 1.25);

    const style = {
        mode: 'smart',
        strokeColor: defaultColor,
        fillColor: defaultColor,
        strokeWidth: typicalWidth,
        strokeOpacity: 1,
        fillOpacity: kind === 'line' ? 1 : 0.45,
        pointSize: defaultFlat.pointSize || classes[0].style?.pointSize || 6,
        pointSymbol: 'circle',
        smart: {
            defaultStyle: {
                strokeColor: defaultColor,
                fillColor: defaultColor,
                strokeWidth: typicalWidth,
                pointSize: defaultFlat.pointSize || 6
            },
            visualVariables: [{
                id: `arcgis-unique-${field1}`,
                type: 'unique',
                field: field1,
                channel: channelForKind(kind),
                geometryTarget: kind,
                classes,
                defaultColor: defaultFlat.strokeColor || defaultFlat.fillColor || DEFAULT_UNIQUE_FALLBACK
            }],
            filterRules: []
        }
    };

    const concat = [renderer.field1, renderer.field2, renderer.field3].filter(Boolean);
    if (concat.length > 1) {
        style.smart.visualVariables[0].fieldConcat = concat;
        style.smart.visualVariables[0].fieldDelimiter = renderer.fieldDelimiter || ', ';
    }
    return style;
}

function classBreaksStyleFromRenderer(renderer, kind) {
    const field = renderer.field;
    if (!field) return null;
    const infos = renderer.classBreakInfos || [];
    const classes = [];
    for (const info of infos) {
        const cls = uniqueClassFromSymbol(
            `${info.classMinValue ?? ''}–${info.classMaxValue ?? info.classMaxValue}`,
            info.label,
            info.symbol,
            kind
        );
        if (!cls) continue;
        classes.push({
            ...cls,
            min: info.classMinValue ?? renderer.minValue ?? -Infinity,
            max: info.classMaxValue ?? Infinity
        });
    }
    if (!classes.length) return null;

    const defaultColor = classes[0].color;
    const min = Number.isFinite(Number(renderer.minValue)) ? Number(renderer.minValue) : (classes[0].min ?? 0);
    const max = classes[classes.length - 1].max ?? min + 1;

    return {
        mode: 'smart',
        strokeColor: defaultColor,
        fillColor: defaultColor,
        strokeWidth: kind === 'line' ? (classes[0].style?.strokeWidth || 2) : 1.25,
        strokeOpacity: 1,
        fillOpacity: kind === 'line' ? 1 : 0.45,
        pointSize: 6,
        pointSymbol: 'circle',
        smart: {
            defaultStyle: {
                strokeColor: defaultColor,
                fillColor: defaultColor,
                strokeWidth: kind === 'line' ? 2 : 1.25,
                pointSize: 6
            },
            visualVariables: [{
                id: `arcgis-breaks-${field}`,
                type: 'range',
                field,
                channel: channelForKind(kind),
                geometryTarget: kind,
                classes,
                min,
                max,
                defaultColor: DEFAULT_UNIQUE_FALLBACK
            }],
            filterRules: []
        }
    };
}

/**
 * @param {object|null|undefined} drawingInfo
 * @param {{
 *   geometryType?: string,
 *   displayField?: string|null,
 *   latitude?: number,
 *   defaultColor?: string
 * }} [options]
 * @returns {object|null} normalized layer style, or null when nothing usable
 */
export function styleFromDrawingInfo(drawingInfo, options = {}) {
    const renderer = drawingInfo?.renderer;
    const kind = geometryKindFromArcgis(options.geometryType);
    const defaultColor = options.defaultColor || '#2563eb';
    if (!renderer) return null;

    const type = String(renderer.type || '').toLowerCase();
    let style = null;
    if (type === 'uniquevalue') {
        style = uniqueStyleFromRenderer(renderer, kind);
    } else if (type === 'classbreaks') {
        style = classBreaksStyleFromRenderer(renderer, kind);
    }
    if (!style && renderer.symbol) {
        style = simpleStyleFromSymbol(renderer.symbol, kind, defaultColor);
    }
    if (!style) return null;

    const labels = labelsFromDrawingInfo(drawingInfo, {
        kind,
        displayField: options.displayField,
        latitude: options.latitude
    });
    if (labels) style.labels = labels;

    return normalizeStyle(style, style.strokeColor || defaultColor);
}

/**
 * @param {{ drawingInfo?: object, geometryType?: string, displayField?: string }} metadata
 * @param {{ latitude?: number, defaultColor?: string }} [options]
 */
export function styleFromArcgisMetadata(metadata, options = {}) {
    if (!metadata?.drawingInfo) return null;
    return styleFromDrawingInfo(metadata.drawingInfo, {
        geometryType: metadata.geometryType,
        displayField: metadata.displayField,
        latitude: options.latitude,
        defaultColor: options.defaultColor
    });
}

/**
 * Unique-value / class-break / label fields the published renderer needs
 * on map features (workspace tiles otherwise keep identity props only).
 * @param {object|null|undefined} drawingInfo
 * @returns {string[]}
 */
export function requiredStyleFieldsFromDrawingInfo(drawingInfo) {
    const fields = [];
    const renderer = drawingInfo?.renderer;
    if (renderer) {
        for (const key of ['field1', 'field2', 'field3', 'field']) {
            const value = renderer[key];
            if (value && value !== '*') fields.push(String(value));
        }
    }
    const entries = drawingInfo?.labelingInfo;
    const entry = Array.isArray(entries)
        ? entries.find((e) => e && (e.labelExpression || e.labelExpressionInfo))
        : null;
    const labelField = parseArcgisLabelField(entry);
    if (labelField) fields.push(labelField);
    return [...new Set(fields)];
}

/**
 * Keep renderer/label fields in an ArcGIS field pick so Smart style can match.
 * @param {string[]|null|undefined} selectedFields
 * @param {object|null|undefined} drawingInfo
 * @param {string[]} [availableFieldNames]
 * @returns {string[]|null|undefined}
 */
export function mergeArcgisStyleFields(selectedFields, drawingInfo, availableFieldNames) {
    if (!selectedFields) return selectedFields;
    const extra = requiredStyleFieldsFromDrawingInfo(drawingInfo)
        .filter((name) => !availableFieldNames?.length || availableFieldNames.includes(name));
    if (!extra.length) return selectedFields;
    const set = new Set(selectedFields);
    for (const name of extra) set.add(name);
    return [...set];
}

export default {
    MAX_UNIQUE_CLASSES,
    geometryKindFromArcgis,
    esriColorToCss,
    esriSymbolToFlat,
    parseArcgisLabelField,
    styleFromDrawingInfo,
    styleFromArcgisMetadata,
    requiredStyleFieldsFromDrawingInfo,
    mergeArcgisStyleFields
};
