import { SHEET_FRAME_PREVIEW_COLOR } from './sheet-preview.js';
import { resolveFeatureStyle } from '../../map/style-engine.js';

/**
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function parseHexColor(hex) {
    const raw = String(hex || '#000000').replace('#', '').trim();
    if (raw.length === 3) {
        return {
            r: parseInt(raw[0] + raw[0], 16),
            g: parseInt(raw[1] + raw[1], 16),
            b: parseInt(raw[2] + raw[2], 16)
        };
    }
    return {
        r: parseInt(raw.slice(0, 2), 16) || 0,
        g: parseInt(raw.slice(2, 4), 16) || 0,
        b: parseInt(raw.slice(4, 6), 16) || 0
    };
}

/**
 * @param {string} geometryType
 * @returns {'point'|'line'|'polygon'|null}
 */
function geometryKindFromType(geometryType) {
    if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'point';
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'line';
    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') return 'polygon';
    return null;
}

/**
 * @param {object|null} layerStyle
 * @param {object} feature
 * @param {'point'|'line'|'polygon'} geometryKind
 * @returns {object|null}
 */
function resolveLayerFlatStyle(layerStyle, feature, geometryKind) {
    if (!layerStyle) return null;
    return resolveFeatureStyle(layerStyle, feature, geometryKind);
}

/**
 * @param {object|null} labelsConfig
 * @returns {object}
 */
function labelDrawStyleFromConfig(labelsConfig) {
    if (!labelsConfig?.field && labelsConfig?.enabled !== true) return {};
    return {
        fontSize: labelsConfig.size || 8,
        color: labelsConfig.color || '#111111',
        haloColor: labelsConfig.haloColor || '#ffffff',
        haloWidth: labelsConfig.haloWidth ?? 1.25
    };
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} opacity
 * @param {() => void} drawFn
 */
function withPdfOpacity(doc, opacity, drawFn) {
    const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    if (alpha >= 0.999) {
        drawFn();
        return;
    }

    const canUseGState = typeof doc.saveGraphicsState === 'function'
        && typeof doc.restoreGraphicsState === 'function'
        && typeof doc.setGState === 'function'
        && typeof doc.GState === 'function';

    if (!canUseGState) {
        drawFn();
        return;
    }

    try {
        doc.saveGraphicsState();
        doc.setGState(doc.GState({ opacity: alpha }));
        drawFn();
    } catch (_) {
        drawFn();
    } finally {
        try {
            doc.restoreGraphicsState();
        } catch (_) {
            // Ignore graphics-state restore failures.
        }
    }
}

/**
 * @param {object} feature
 * @param {object|null} [layerStyle]
 * @returns {object}
 */
export function resolveVectorFeatureStyle(feature, layerStyle = null) {
    const props = feature?.properties || {};
    const preview = props._preview;
    const featureType = props.feature_type;

    if (featureType === 'sheet_outline') {
        return {
            kind: 'line',
            strokeColor: '#c9a227',
            strokeWidth: 1.25,
            strokeOpacity: 1,
            dash: [5, 3]
        };
    }

    if (featureType === 'overview_sheet_outline') {
        return {
            kind: 'polygon',
            strokeColor: SHEET_FRAME_PREVIEW_COLOR,
            strokeWidth: 2,
            strokeOpacity: 1,
            fillColor: SHEET_FRAME_PREVIEW_COLOR,
            fillOpacity: 0
        };
    }

    if (featureType === 'overview_route') {
        return { kind: 'line', strokeColor: '#cc4444', strokeWidth: 2, strokeOpacity: 0.85 };
    }

    if (featureType === 'overview_sheet_label') {
        return {
            kind: 'label',
            field: 'sheet_label',
            fontSize: 11,
            color: '#1a1a1a',
            haloColor: '#ffffff',
            haloWidth: 1.25
        };
    }

    if (featureType === 'route' || preview === 'route') {
        const flat = resolveLayerFlatStyle(layerStyle, feature, 'line');
        if (flat) {
            return {
                kind: 'line',
                strokeColor: flat.strokeColor,
                strokeWidth: flat.strokeWidth,
                strokeOpacity: flat.strokeOpacity ?? 1
            };
        }
        return { kind: 'line', strokeColor: '#cc4444', strokeWidth: 2, strokeOpacity: 0.65 };
    }

    if (preview === 'project_centerline' || preview === 'trimmed_centerline') {
        return { kind: 'line', strokeColor: '#111111', strokeWidth: 2.5, strokeOpacity: 1 };
    }

    if (preview === 'station_tick' || preview === 'centerline_segment' || preview === 'mp-clip') {
        return {
            kind: 'line',
            strokeColor: preview === 'centerline_segment' ? '#888888' : '#111111',
            strokeWidth: preview === 'station_tick' ? 0.75 : 1.5,
            strokeOpacity: 1,
            dash: preview === 'centerline_segment' ? [3, 3] : undefined
        };
    }

    if (preview === 'station_label') {
        return { kind: 'label', field: 'station_label', fontSize: 11, color: '#111111' };
    }

    if (preview === 'begin_end_marker') {
        return {
            kind: 'point',
            fillColor: '#00cc66',
            strokeColor: '#ffffff',
            radius: 3.5,
            labelField: 'name',
            labelSize: 8
        };
    }

    const geometryType = feature?.geometry?.type;
    const geometryKind = geometryKindFromType(geometryType);
    const flat = geometryKind ? resolveLayerFlatStyle(layerStyle, feature, geometryKind) : null;
    const labelsConfig = layerStyle?.labels?.enabled && layerStyle?.labels?.field
        ? layerStyle.labels
        : null;
    const labelStyle = labelDrawStyleFromConfig(labelsConfig);

    const strokeColor = flat?.strokeColor || layerStyle?.strokeColor || '#2563eb';
    const strokeWidth = flat?.strokeWidth ?? layerStyle?.strokeWidth ?? 2;
    const strokeOpacity = flat?.strokeOpacity ?? layerStyle?.strokeOpacity ?? 1;
    const fillColor = flat?.fillColor || layerStyle?.fillColor || strokeColor;
    const fillOpacity = flat?.fillOpacity ?? layerStyle?.fillOpacity ?? 0.25;

    if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
        const labelField = labelsConfig?.field || layerStyle?.labels?.field;
        return {
            kind: 'line',
            strokeColor,
            strokeWidth,
            strokeOpacity,
            labelField: labelField || null,
            labelSize: labelStyle.fontSize || 8
        };
    }

    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
        return {
            kind: 'polygon',
            strokeColor,
            strokeWidth,
            strokeOpacity,
            fillColor,
            fillOpacity
        };
    }

    if (geometryType === 'Point' || geometryType === 'MultiPoint') {
        const labelField = labelsConfig?.field
            || layerStyle?.labels?.field
            || (props.station_label != null && props.station_label !== '' ? 'station_label' : null)
            || props.name
            || null;
        const pointSize = flat?.pointSize ?? layerStyle?.pointSize;
        const pointHidden = pointSize === 0
            || (fillOpacity === 0 && strokeOpacity === 0 && strokeWidth === 0);

        if (pointHidden && labelField) {
            return {
                kind: 'label',
                field: labelField,
                ...labelStyle,
                fontSize: labelStyle.fontSize || (labelField === 'station_label' ? 11 : 8)
            };
        }

        return {
            kind: 'point',
            fillColor,
            strokeColor,
            radius: pointSize ?? 4,
            strokeWidth: 1,
            fillOpacity,
            strokeOpacity,
            labelField,
            labelSize: labelStyle.fontSize || 8,
            color: labelStyle.color || '#111111',
            haloColor: labelStyle.haloColor,
            haloWidth: labelStyle.haloWidth
        };
    }

    return { kind: 'line', strokeColor, strokeWidth, strokeOpacity };
}

function applyStrokeColor(doc, hex) {
    const { r, g, b } = parseHexColor(hex);
    doc.setDrawColor(r, g, b);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {string} hex
 */
function applyFillColor(doc, hex) {
    const { r, g, b } = parseHexColor(hex);
    doc.setFillColor(r, g, b);
}

/**
 * @param {number[][]} ring
 * @param {import('maplibre-gl').Map} map
 * @param {object} transform
 * @param {number} captureScale
 * @returns {Array<{ x: number, y: number }>}
 */
function projectRing(map, ring, transform, captureScale) {
    const points = [];
    for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        points.push(transform.projectLngLat(map, lng, lat, captureScale));
    }
    return points;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {Array<{ x: number, y: number }>} points
 * @param {object} style
 * @param {number} pxPerPt
 */
function drawPolyline(doc, points, style, pxPerPt) {
    if (points.length < 2) return;

    withPdfOpacity(doc, style.strokeOpacity, () => {
        applyStrokeColor(doc, style.strokeColor);
        doc.setLineWidth(Math.max(0.35, (style.strokeWidth || 1) * pxPerPt));

        if (style.dash?.length) {
            doc.setLineDashPattern?.(style.dash, 0);
        } else {
            doc.setLineDashPattern?.([], 0);
        }

        for (let i = 1; i < points.length; i++) {
            doc.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
        }
    });
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {Array<{ x: number, y: number }>} ring
 * @param {object} style
 * @param {number} pxPerPt
 */
function drawPolygonRing(doc, ring, style, pxPerPt) {
    if (ring.length < 3) return;
    drawPolyline(doc, [...ring, ring[0]], style, pxPerPt);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number }} point
 * @param {object} style
 * @param {number} pxPerPt
 */
function drawPoint(doc, point, style, pxPerPt) {
    const rawRadius = (style.radius ?? 4) * pxPerPt * 0.5;
    if (style.radius === 0 || rawRadius <= 0) return;

    const radius = Math.max(0.5, rawRadius);
    withPdfOpacity(doc, style.fillOpacity ?? 1, () => {
        applyFillColor(doc, style.fillColor || '#2563eb');
        applyStrokeColor(doc, style.strokeColor || '#ffffff');
        doc.setLineWidth(Math.max(0.2, (style.strokeWidth || 1) * pxPerPt * 0.5));
        doc.circle(point.x, point.y, radius, 'FD');
    });
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number }} point
 * @param {string} text
 * @param {object} style
 */
function drawLabel(doc, point, text, style) {
    if (!text) return;

    const fontSize = style.fontSize || 8;
    const { r, g, b } = parseHexColor(style.color || '#111111');
    doc.setFontSize(fontSize);

    const y = point.y - 2;
    const options = { align: 'center', baseline: 'bottom' };

    if (style.haloColor) {
        const halo = parseHexColor(style.haloColor);
        const step = style.haloWidth ?? 1;
        doc.setTextColor(halo.r, halo.g, halo.b);
        for (const [dx, dy] of [
            [-step, 0], [step, 0], [0, -step], [0, step],
            [-step * 0.7, -step * 0.7], [step * 0.7, step * 0.7],
            [-step * 0.7, step * 0.7], [step * 0.7, -step * 0.7]
        ]) {
            doc.text(String(text), point.x + dx, y + dy, options);
        }
    }

    doc.setTextColor(r, g, b);
    doc.text(String(text), point.x, y, options);
}

/**
 * @param {object} feature
 * @returns {number}
 */
function featureDrawOrder(feature) {
    const props = feature?.properties || {};
    if (props.feature_type === 'overview_sheet_label') return 200;
    if (props.feature_type === 'sheet_outline') return 100;
    if (props._preview === 'station_label' || props._preview === 'begin_end_marker') return 90;
    if (props.feature_type === 'overview_sheet_outline') return 35;
    if (props._preview === 'station_tick') return 40;
    if (props.feature_type === 'route' || props._preview === 'route' || props.feature_type === 'overview_route') return 20;
    return 50;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {import('geojson').Feature} feature
 * @param {import('maplibre-gl').Map} map
 * @param {object} transform
 * @param {number} captureScale
 * @param {object} style
 */
function renderFeature(doc, feature, map, transform, captureScale, style) {
    const geometry = feature?.geometry;
    if (!geometry) return;

    const pxPerPt = transform.pxPerPt;

    if (geometry.type === 'LineString') {
        const points = projectRing(map, geometry.coordinates, transform, captureScale);
        drawPolyline(doc, points, style, pxPerPt);
        return;
    }

    if (geometry.type === 'MultiLineString') {
        for (const line of geometry.coordinates) {
            const points = projectRing(map, line, transform, captureScale);
            drawPolyline(doc, points, style, pxPerPt);
        }
        return;
    }

    if (geometry.type === 'Polygon') {
        for (const ring of geometry.coordinates) {
            const points = projectRing(map, ring, transform, captureScale);
            if (style.kind === 'polygon') {
                drawPolygonRing(doc, points, style, pxPerPt);
            } else {
                drawPolyline(doc, points, style, pxPerPt);
            }
        }
        return;
    }

    if (geometry.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates) {
            for (const ring of polygon) {
                const points = projectRing(map, ring, transform, captureScale);
                if (style.kind === 'polygon') {
                    drawPolygonRing(doc, points, style, pxPerPt);
                } else {
                    drawPolyline(doc, points, style, pxPerPt);
                }
            }
        }
        return;
    }

    if (geometry.type === 'Point') {
        const [lng, lat] = geometry.coordinates;
        const point = transform.projectLngLat(map, lng, lat, captureScale);

        if (style.kind === 'label') {
            const text = feature.properties?.[style.field] ?? '';
            drawLabel(doc, point, text, style);
            return;
        }

        drawPoint(doc, point, style, pxPerPt);
        if (style.labelField && style.kind !== 'label') {
            drawLabel(doc, point, feature.properties?.[style.labelField], {
                fontSize: style.labelSize || 8,
                color: style.color || '#111111',
                haloColor: style.haloColor,
                haloWidth: style.haloWidth
            });
        }
        return;
    }

    if (geometry.type === 'MultiPoint') {
        for (const coord of geometry.coordinates) {
            const point = transform.projectLngLat(map, coord[0], coord[1], captureScale);
            if (style.kind === 'label') {
                drawLabel(doc, point, feature.properties?.[style.field], style);
            } else {
                drawPoint(doc, point, style, pxPerPt);
            }
        }
    }
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {import('geojson').FeatureCollection|object} collection
 * @param {import('maplibre-gl').Map} map
 * @param {object} transform
 * @param {number} captureScale
 * @param {(feature: object) => object} resolveStyle
 */
export function renderFeatureCollectionToPdf(doc, collection, map, transform, captureScale, resolveStyle) {
    const features = [...(collection?.features || [])].sort(
        (a, b) => featureDrawOrder(a) - featureDrawOrder(b)
    );

    for (const feature of features) {
        try {
            const layerId = feature.properties?._sourceLayerId;
            const layerStyle = resolveStyle.layerStyleFor?.(layerId) ?? null;
            const style = resolveVectorFeatureStyle(feature, layerStyle);
            renderFeature(doc, feature, map, transform, captureScale, style);
        } catch (_) {
            // Skip features that fail to project or render.
        }
    }
}
