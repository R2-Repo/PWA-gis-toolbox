import { SHEET_FRAME_PREVIEW_COLOR } from './sheet-preview.js';
import { INSET_PREVIEW_COLOR } from './inset-views.js';
import { resolveFeatureStyle } from '../../map/style-engine.js';
import {
    closestPdfRingEdge,
    pickTextAngleWithBottomTowardInterior,
    pointInPdfRing,
    probeOutwardUnitNormal
} from './sheet-pdf-placement.js';
import { buildUdotFiberPdfStyle, layoutUdotFiberPdfBox, udotFiberPdfDrawRank } from './sheet-pdf-fiber.js';
import { interpolateUdotFiberIconPx } from '../../symbology/udot-fiber/zoom-scale.js';

/** Matchline SEE SHEET label size (PDF points). Inner glyph edge sits on the cutout border. */
export const MATCHLINE_SEE_LABEL_FONT_PT = 7.5;

/**
 * Convert map CSS pixels to PDF points via the capture transform.
 *
 * @param {number} cssPx
 * @param {number} pxPerPt
 * @param {number} [captureScale]
 * @returns {number}
 */
export function mapCssPxToPdfPt(cssPx, pxPerPt, captureScale = 1) {
    const px = Math.max(0, Number(cssPx) || 0);
    const scale = Math.max(0, Number(captureScale) || 0);
    const perPt = Math.max(0, Number(pxPerPt) || 0);
    return px * scale * perPt;
}

/**
 * Fiber point / box glyph size. Corridor pages keep CAD sizes; DETAILS pages
 * grow to the on-screen map size at the capture zoom.
 *
 * @param {object} style
 * @param {number} pxPerPt
 * @param {{ captureScale?: number, zoom?: number, matchMapScreenSpace?: boolean, maxPt?: number }} [options]
 * @returns {{ size: number, boxRadius: number }}
 */
export function resolveFiberGlyphPdfMetrics(style, pxPerPt, options = {}) {
    const cadSize = Math.max(2.4, (style?.radius || 4) * pxPerPt);
    const cadBoxRadius = Math.max(4.8, (style?.radius || 4.8) * Math.max(pxPerPt, 0.7));
    if (!options.matchMapScreenSpace) {
        return { size: cadSize, boxRadius: cadBoxRadius };
    }

    const iconPx = interpolateUdotFiberIconPx(style?.fiberKey, options.zoom);
    let mapPt = mapCssPxToPdfPt(iconPx, pxPerPt, options.captureScale);
    const capPt = Number(options.maxPt);
    if (Number.isFinite(capPt) && capPt > 0) {
        mapPt = Math.min(mapPt, capPt);
    }
    const glyph = style?.glyph || 'circle';
    const mapSize = glyph === 'rect'
        ? mapPt / 2.24
        : glyph === 'bowtie'
            ? mapPt / 2
            : glyph === 'square-x'
                ? mapPt / 1.4
                : mapPt / 1.1;
    return {
        size: Math.max(cadSize, mapSize),
        boxRadius: Math.max(cadBoxRadius, mapPt / 2.24)
    };
}

/**
 * Generic point marker radius. DETAILS pages convert map circle-radius CSS px.
 *
 * @param {object} style
 * @param {number} pxPerPt
 * @param {{ captureScale?: number, matchMapScreenSpace?: boolean }} [options]
 * @returns {number}
 */
export function resolvePointMarkerPdfRadius(style, pxPerPt, options = {}) {
    const cad = Math.max(0.5, (style?.radius ?? 4) * pxPerPt * 0.5);
    if (style?.radius === 0) return 0;
    if (!options.matchMapScreenSpace) return cad;
    const mapR = mapCssPxToPdfPt(style?.radius ?? 4, pxPerPt, options.captureScale);
    return Math.max(cad, mapR);
}

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

    if (featureType === 'inset_outline') {
        return {
            kind: 'polygon',
            strokeColor: INSET_PREVIEW_COLOR,
            strokeWidth: 1.15,
            strokeOpacity: 1,
            fillColor: INSET_PREVIEW_COLOR,
            fillOpacity: 0,
            dash: [4, 2.5]
        };
    }

    if (featureType === 'inset_label') {
        return {
            kind: 'inset_label',
            fontSize: 8,
            color: '#1e3a8a',
            haloColor: '#ffffff',
            haloWidth: 1.1
        };
    }

    if (featureType === 'matchline_see_label') {
        return {
            kind: 'matchline_see_label',
            fontSize: MATCHLINE_SEE_LABEL_FONT_PT,
            color: '#141414',
            haloColor: '#ffffff',
            haloWidth: 0.8
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

    const fiberStyle = buildUdotFiberPdfStyle(feature, layerStyle);
    if (fiberStyle) return fiberStyle;

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
        const widthPt = Number.isFinite(style._pdfWidthPt)
            ? style._pdfWidthPt
            : Math.max(0.35, (style.strokeWidth || 1) * pxPerPt);
        doc.setLineWidth(widthPt);
        if (typeof doc.setLineCap === 'function') doc.setLineCap('round');
        if (typeof doc.setLineJoin === 'function') doc.setLineJoin('round');

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
 * @param {Array<{ x: number, y: number }>} points
 * @param {object} style
 * @param {number} pxPerPt
 */
function fiberStrokeWidthPt(strokeWidth, pxPerPt) {
    const scale = Math.min(Math.max(Number(pxPerPt) || 0.2, 0.12), 0.38);
    return Math.max(0.18, (strokeWidth || 0.62) * scale);
}

function drawFiberLine(doc, points, style, pxPerPt) {
    for (const stroke of style.strokes || []) {
        drawPolyline(doc, points, { ...stroke, _pdfWidthPt: fiberStrokeWidthPt(stroke.strokeWidth, pxPerPt) }, pxPerPt);
    }
    doc.setLineDashPattern?.([], 0);
}

function rotatePdfPoint(cx, cy, x, y, angleDeg) {
    const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    return {
        x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
        y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
    };
}

function fillQuad(doc, a, b, c, d) {
    if (typeof doc.triangle === 'function') {
        doc.triangle(a.x, a.y, b.x, b.y, c.x, c.y, 'F');
        doc.triangle(a.x, a.y, c.x, c.y, d.x, d.y, 'F');
        return;
    }
    applyStrokeColor(doc, '#111111');
    doc.line(a.x, a.y, b.x, b.y);
    doc.line(b.x, b.y, c.x, c.y);
    doc.line(c.x, c.y, d.x, d.y);
    doc.line(d.x, d.y, a.x, a.y);
}

function mixHexToward(hex, toward, t) {
    const a = parseHexColor(hex);
    const b = parseHexColor(toward);
    const mix = (x, y) => Math.round(x + (y - x) * t);
    const byte = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${byte(mix(a.r, b.r))}${byte(mix(a.g, b.g))}${byte(mix(a.b, b.b))}`;
}

function drawRotatedCenteredText(doc, cx, cy, text, fontSize, angleDeg, color, haloColor = null, haloWidth = 0) {
    if (!text) return;
    doc.setFontSize(fontSize);
    const width = typeof doc.getTextWidth === 'function'
        ? doc.getTextWidth(text)
        : text.length * fontSize * 0.52;
    const { x, y } = computeRotatedTextAnchor(cx, cy, width, angleDeg);
    const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
    const lift = fontSize * 0.35;
    const ax = x + lift * Math.sin(rad);
    const ay = y + lift * Math.cos(rad);
    const options = { angle: Number(angleDeg) || 0 };
    if (haloColor) {
        const halo = parseHexColor(haloColor);
        const step = haloWidth || 0.65;
        doc.setTextColor(halo.r, halo.g, halo.b);
        for (const [dx, dy] of [[-step, 0], [step, 0], [0, -step], [0, step]]) {
            doc.text(text, ax + dx, ay + dy, options);
        }
    }
    const ink = parseHexColor(color || '#111111');
    doc.setTextColor(ink.r, ink.g, ink.b);
    doc.text(text, ax, ay, options);
}

function drawInBoxLabel(doc, point, lines, fontSize, jsPdfAngleDeg, color = '#111111', haloColor = null, haloWidth = 0) {
    const list = (Array.isArray(lines) ? lines : [lines]).map((line) => String(line || '').trim()).filter(Boolean);
    if (!list.length || !fontSize) return;
    const lineH = fontSize * 1.08;
    const blockH = list.length * lineH;
    const rad = ((Number(jsPdfAngleDeg) || 0) * Math.PI) / 180;
    const upX = -Math.sin(rad);
    const upY = -Math.cos(rad);
    list.forEach((line, i) => {
        const fromCenter = (blockH - lineH) / 2 - i * lineH;
        drawRotatedCenteredText(
            doc,
            point.x + upX * fromCenter,
            point.y + upY * fromCenter,
            line,
            fontSize,
            jsPdfAngleDeg,
            color,
            haloColor,
            haloWidth
        );
    });
}

/**
 * Crisp CAD marks — not raster sprites.
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number }} point
 * @param {object} style
 * @param {number} pxPerPt
 * @param {number} mapBearing
 */
function drawFiberPoint(doc, point, style, pxPerPt, mapBearing = 0, screen = null) {
    const metrics = resolveFiberGlyphPdfMetrics(style, pxPerPt, screen || {});
    const size = metrics.size;
    const angle = (Number(style.rotation) || 0) - (Number(mapBearing) || 0);
    const color = style.fillColor || '#111111';
    const ink = style.strokeColor || '#111111';
    applyFillColor(doc, color);
    applyStrokeColor(doc, ink);
    doc.setLineWidth(Math.max(0.35, 0.55 * pxPerPt * Math.max(1, Number(screen?.captureScale) || 1)));
    doc.setLineDashPattern?.([], 0);

    const at = (dx, dy) => rotatePdfPoint(point.x, point.y, point.x + dx, point.y + dy, angle);
    const glyph = style.glyph || 'circle';

    if (glyph === 'rect') {
        const measure = (text, fontSize) => {
            doc.setFontSize(fontSize);
            return typeof doc.getTextWidth === 'function'
                ? doc.getTextWidth(text)
                : text.length * fontSize * 0.52;
        };
        const box = layoutUdotFiberPdfBox(
            style.boxLabel,
            metrics.boxRadius,
            measure
        );
        const a = at(-box.halfWidth, -box.halfHeight);
        const b = at(box.halfWidth, -box.halfHeight);
        const c = at(box.halfWidth, box.halfHeight);
        const d = at(-box.halfWidth, box.halfHeight);
        applyStrokeColor(doc, ink);
        doc.line(a.x, a.y, b.x, b.y);
        doc.line(b.x, b.y, c.x, c.y);
        doc.line(c.x, c.y, d.x, d.y);
        doc.line(d.x, d.y, a.x, a.y);
        if (box.lines.length && box.fontSize) {
            const edgeAngle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            const outward = {
                x: (a.x + b.x) / 2 - point.x,
                y: (a.y + b.y) / 2 - point.y
            };
            drawInBoxLabel(
                doc,
                point,
                box.lines,
                box.fontSize,
                pickJsPdfAngleWithCapsOutward(edgeAngle, outward),
                '#111111',
                '#ffffff',
                0.45
            );
        }
        return;
    }

    if (glyph === 'ring' || glyph === 'circle') {
        applyFillColor(doc, glyph === 'ring' ? '#ffffff' : color);
        applyStrokeColor(doc, glyph === 'ring' ? (color || '#ff0000') : ink);
        doc.circle(point.x, point.y, size * 0.55, 'FD');
        return;
    }

    if (glyph === 'bowtie') {
        const left = [at(-size, -size * 0.7), at(0, 0), at(-size, size * 0.7)];
        const right = [at(size, -size * 0.7), at(0, 0), at(size, size * 0.7)];
        if (typeof doc.triangle === 'function') {
            doc.triangle(left[0].x, left[0].y, left[1].x, left[1].y, left[2].x, left[2].y, 'FD');
            doc.triangle(right[0].x, right[0].y, right[1].x, right[1].y, right[2].x, right[2].y, 'FD');
        }
        return;
    }

    if (glyph === 'square-x') {
        const a = at(-size * 0.7, -size * 0.7);
        const b = at(size * 0.7, -size * 0.7);
        const c = at(size * 0.7, size * 0.7);
        const d = at(-size * 0.7, size * 0.7);
        applyFillColor(doc, mixHexToward(color, '#ffffff', 0.72));
        fillQuad(doc, a, b, c, d);
        applyStrokeColor(doc, color || ink);
        doc.line(a.x, a.y, b.x, b.y);
        doc.line(b.x, b.y, c.x, c.y);
        doc.line(c.x, c.y, d.x, d.y);
        doc.line(d.x, d.y, a.x, a.y);
        doc.line(a.x, a.y, c.x, c.y);
        doc.line(b.x, b.y, d.x, d.y);
        return;
    }

    applyFillColor(doc, color);
    applyStrokeColor(doc, ink);
    doc.circle(point.x, point.y, size * 0.5, 'FD');
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
function drawPoint(doc, point, style, pxPerPt, screen = null) {
    const radius = resolvePointMarkerPdfRadius(style, pxPerPt, screen || {});
    if (style.radius === 0 || radius <= 0) return;

    const captureScale = Math.max(1, Number(screen?.captureScale) || 1);
    withPdfOpacity(doc, style.fillOpacity ?? 1, () => {
        applyFillColor(doc, style.fillColor || '#2563eb');
        applyStrokeColor(doc, style.strokeColor || '#ffffff');
        doc.setLineWidth(Math.max(0.2, (style.strokeWidth || 1) * pxPerPt * (screen?.matchMapScreenSpace ? captureScale : 0.5)));
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

    const y = point.y + (Number.isFinite(style.dy) ? style.dy : -2);
    const options = {
        align: style.align || 'center',
        baseline: style.baseline || 'bottom'
    };

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
 * Two-line DETAIL / SEE DETAILS label, stacked entirely on the outward side of `anchor`.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number }} point
 * @param {object} props
 * @param {object} style
 */
export function drawInsetCalloutLabel(doc, point, props, style) {
    const line1 = props?.inset_label || '';
    const line2 = props?.see_details || '';
    if (!line1 && !line2) return;

    const font1 = style.fontSize || 8;
    const font2 = Math.max(6, font1 - 1);
    const gap = 1.5;
    const blockH = (line1 ? font1 : 0) + (line2 ? font2 + gap : 0);
    const anchor = String(props?.label_anchor || 'bottom');

    let align = 'center';
    if (anchor === 'left' || anchor === 'top-left' || anchor === 'bottom-left') align = 'left';
    else if (anchor === 'right' || anchor === 'top-right' || anchor === 'bottom-right') align = 'right';

    let topBaseline;
    if (anchor === 'bottom' || anchor === 'bottom-left' || anchor === 'bottom-right') {
        topBaseline = point.y - blockH + font1;
    } else if (anchor === 'top' || anchor === 'top-left' || anchor === 'top-right') {
        topBaseline = point.y + font1;
    } else {
        topBaseline = point.y - blockH / 2 + font1;
    }

    const shared = { ...style, align, dy: 0, baseline: 'bottom' };
    if (line1) {
        drawLabel(doc, { x: point.x, y: topBaseline }, line1, { ...shared, fontSize: font1 });
    }
    if (line2) {
        drawLabel(
            doc,
            { x: point.x, y: topBaseline + (line1 ? font1 + gap : 0) },
            line2,
            { ...shared, fontSize: font2 }
        );
    }
}

/**
 * jsPDF left-align anchor so rotated text is visually centered on (cx, cy).
 * jsPDF Tm run direction in page y-down is (cos θ, −sin θ) — not (cos, sin).
 * Do not use align:'center' with angle; do not use baseline:'middle' (applied in
 * unrotated page Y before rotation, which pulls right-edge / skewed labels in).
 */
function computeRotatedTextAnchor(cx, cy, widthPt, angleDeg) {
    const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
    const half = Math.max(0, Number(widthPt) || 0) / 2;
    return {
        x: cx - half * Math.cos(rad),
        y: cy + half * Math.sin(rad)
    };
}

/**
 * Pick the parallel jsPDF angle whose glyph caps point along `outward`.
 * jsPDF Tm (y-up) maps caps to page y-down (−sin θ, −cos θ). Never use (sin, −cos).
 *
 * @param {number} edgeAngleDeg
 * @param {{ x: number, y: number }} outward
 * @returns {number}
 */
/**
 * jsPDF angle for text that runs along a rotated Fiber box (page y-down).
 * The rectangle is drawn with `rotatePdfPoint`; jsPDF run is (cos θ, −sin θ).
 *
 * @param {number} boxAngleDeg
 * @returns {number}
 */
export function udotFiberPdfBoxTextAngle(boxAngleDeg) {
    const rad = ((Number(boxAngleDeg) || 0) * Math.PI) / 180;
    const edgeAngle = (Math.atan2(Math.sin(rad), Math.cos(rad)) * 180) / Math.PI;
    return pickJsPdfAngleWithCapsOutward(edgeAngle, {
        x: Math.sin(rad),
        y: -Math.cos(rad)
    });
}

export function pickJsPdfAngleWithCapsOutward(edgeAngleDeg, outward) {
    const a = -Number(edgeAngleDeg) || 0;
    const b = a + (a > 0 ? -180 : 180);
    const capDot = (angleDeg) => {
        const rad = (angleDeg * Math.PI) / 180;
        const upX = -Math.sin(rad);
        const upY = -Math.cos(rad);
        return upX * outward.x + upY * outward.y;
    };
    return capDot(a) >= capDot(b) ? a : b;
}

/**
 * Place the alphabetic baseline just outside the gold outline, caps facing out.
 * Origin is the match-line cap edge (not the page bbox). See docs/SHEET_CUTTING.md.
 *
 * @param {{ x: number, y: number }} borderPdf
 * @param {{ x: number, y: number }} capLeftPdf
 * @param {{ x: number, y: number }} capRightPdf
 * @param {number} fontPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function placeMatchlineLabelOnGoldOutline(
    borderPdf,
    capLeftPdf,
    capRightPdf,
    fontPt = MATCHLINE_SEE_LABEL_FONT_PT,
    pdfRing = null
) {
    let edgeAngleDeg = (Math.atan2(
        capRightPdf.y - capLeftPdf.y,
        capRightPdf.x - capLeftPdf.x
    ) * 180) / Math.PI;
    let midX = borderPdf.x;
    let midY = borderPdf.y;
    if (pdfRing?.length) {
        const edge = closestPdfRingEdge(pdfRing, midX, midY, edgeAngleDeg);
        if (edge) {
            midX = edge.point.x;
            midY = edge.point.y;
            const dx = edge.to.x - edge.from.x;
            const dy = edge.to.y - edge.from.y;
            if (Math.hypot(dx, dy) > 1e-6) {
                edgeAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
            }
        }
    }

    let outward = probeOutwardUnitNormal(midX, midY, edgeAngleDeg, pdfRing);
    const size = Math.max(4, Number(fontPt) || MATCHLINE_SEE_LABEL_FONT_PT);
    const capH = size * 0.7;
    const standoff = Math.max(2, size * 0.22);
    let x = midX + outward.x * standoff;
    let y = midY + outward.y * standoff;
    if (pdfRing?.length && pointInPdfRing(x, y, pdfRing)) {
        outward = { x: -outward.x, y: -outward.y };
        x = midX + outward.x * standoff;
        y = midY + outward.y * standoff;
    }

    let angle = pickJsPdfAngleWithCapsOutward(edgeAngleDeg, outward);
    const capSample = (px, py, ang) => {
        const rad = (ang * Math.PI) / 180;
        return { x: px - Math.sin(rad) * capH, y: py - Math.cos(rad) * capH };
    };
    let cap = capSample(x, y, angle);
    if (pdfRing?.length && pointInPdfRing(cap.x, cap.y, pdfRing)) {
        angle += angle > 0 ? -180 : 180;
        cap = capSample(x, y, angle);
    }
    if (pdfRing?.length) {
        const samplesOutside = (px, py, ang) => {
            const c = capSample(px, py, ang);
            return !pointInPdfRing(px, py, pdfRing) && !pointInPdfRing(c.x, c.y, pdfRing);
        };
        if (!samplesOutside(x, y, angle)) {
            for (let dist = standoff + 1; dist <= 48; dist += 1) {
                const tx = midX + outward.x * dist;
                const ty = midY + outward.y * dist;
                if (samplesOutside(tx, ty, angle)) {
                    x = tx;
                    y = ty;
                    break;
                }
            }
        }
    }

    return { x, y, angle, edgeAngleDeg, outward };
}

/**
 * PDF draw position: border midpoint projected, then half a glyph outside along
 * the geographic outward vector (same projector as the gold outline).
 *
 * @param {{ x: number, y: number }} borderPdf
 * @param {{ x: number, y: number }} outwardPdf
 * @param {{ x: number, y: number }} capLeftPdf
 * @param {{ x: number, y: number }} capRightPdf
 * @param {number} [fontPt]
 * @returns {{ x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function computeMatchlineSeeLabelPdfPlacement(
    borderPdf,
    outwardPdf,
    capLeftPdf,
    capRightPdf,
    fontPt = MATCHLINE_SEE_LABEL_FONT_PT,
    pdfRing = null
) {
    const ox = outwardPdf.x - borderPdf.x;
    const oy = outwardPdf.y - borderPdf.y;
    const len = Math.hypot(ox, oy) || 1;
    let nx = ox / len;
    let ny = oy / len;
    const offset = Math.max(0, Number(fontPt) || 0) * 0.5;
    let x = borderPdf.x + nx * offset;
    let y = borderPdf.y + ny * offset;
    if (pdfRing?.length && pointInPdfRing(x, y, pdfRing)) {
        nx = -nx;
        ny = -ny;
        x = borderPdf.x + nx * offset;
        y = borderPdf.y + ny * offset;
    }
    if (pdfRing?.length && pointInPdfRing(x, y, pdfRing)) {
        for (let dist = offset + 2; dist <= 64; dist += 2) {
            const tx = borderPdf.x + nx * dist;
            const ty = borderPdf.y + ny * dist;
            if (!pointInPdfRing(tx, ty, pdfRing)) {
                x = tx;
                y = ty;
                break;
            }
            const fx = borderPdf.x - nx * dist;
            const fy = borderPdf.y - ny * dist;
            if (!pointInPdfRing(fx, fy, pdfRing)) {
                x = fx;
                y = fy;
                nx = -nx;
                ny = -ny;
                break;
            }
        }
    }
    const edgeAngleDeg = (Math.atan2(
        capRightPdf.y - capLeftPdf.y,
        capRightPdf.x - capLeftPdf.x
    ) * 180) / Math.PI;
    const interior = { x: borderPdf.x - nx, y: borderPdf.y - ny };
    return {
        x,
        y,
        edgeAngleDeg,
        angle: pickTextAngleWithBottomTowardInterior(edgeAngleDeg, x, y, interior)
    };
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {string} text
 * @param {number} cx
 * @param {number} cy
 * @param {number} angleDeg
 * @param {object} style
 */
function drawRotatedHaloText(doc, text, cx, cy, angleDeg, style) {
    const label = String(text ?? '');
    if (!label) return;

    const fontSize = style.fontSize || MATCHLINE_SEE_LABEL_FONT_PT;
    doc.setFontSize(fontSize);
    const width = typeof doc.getTextWidth === 'function'
        ? doc.getTextWidth(label)
        : label.length * fontSize * 0.45;
    const angle = Number(angleDeg) || 0;
    const { x: anchorX, y: anchorY } = computeRotatedTextAnchor(cx, cy, width, angle);
    const options = { align: 'left', baseline: 'alphabetic', angle };

    if (style.haloColor) {
        const halo = parseHexColor(style.haloColor);
        const step = style.haloWidth ?? 0.8;
        doc.setTextColor(halo.r, halo.g, halo.b);
        for (const [dx, dy] of [
            [-step, 0], [step, 0], [0, -step], [0, step],
            [-step * 0.7, -step * 0.7], [step * 0.7, step * 0.7],
            [-step * 0.7, step * 0.7], [step * 0.7, -step * 0.7]
        ]) {
            doc.text(label, anchorX + dx, anchorY + dy, options);
        }
    }

    const { r, g, b } = parseHexColor(style.color || '#141414');
    doc.setTextColor(r, g, b);
    doc.text(label, anchorX, anchorY, options);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {import('geojson').Feature<import('geojson').Point>} feature
 * @param {import('maplibre-gl').Map} map
 * @param {object} transform
 * @param {number} captureScale
 * @param {object} style
 */
function drawMatchlineSeeLabel(doc, feature, map, transform, captureScale, style, pdfRing = null) {
    const props = feature?.properties || {};
    const coords = feature?.geometry?.coordinates;
    if (!coords?.length || !props.cap_left?.length || !props.cap_right?.length) {
        return;
    }
    if (!transform?.projectLngLat || !map) return;

    const borderPdf = transform.projectLngLat(map, coords[0], coords[1], captureScale);
    const capLeftPdf = transform.projectLngLat(map, props.cap_left[0], props.cap_left[1], captureScale);
    const capRightPdf = transform.projectLngLat(map, props.cap_right[0], props.cap_right[1], captureScale);
    const fontPt = style.fontSize || MATCHLINE_SEE_LABEL_FONT_PT;
    const placed = pdfRing?.length
        ? placeMatchlineLabelOnGoldOutline(borderPdf, capLeftPdf, capRightPdf, fontPt, pdfRing)
        : computeMatchlineSeeLabelPdfPlacement(
            borderPdf,
            props.outward?.length
                ? transform.projectLngLat(map, props.outward[0], props.outward[1], captureScale)
                : borderPdf,
            capLeftPdf,
            capRightPdf,
            fontPt,
            null
        );
    drawRotatedHaloText(doc, props.text, placed.x, placed.y, placed.angle, style);
}

/**
 * @param {object} feature
 * @returns {number}
 */
function featureDrawOrder(feature) {
    const props = feature?.properties || {};
    if (props.feature_type === 'matchline_see_label') return 210;
    if (props.feature_type === 'inset_label') return 205;
    if (props.feature_type === 'overview_sheet_label') return 200;
    if (props.feature_type === 'inset_outline') return 110;
    if (props.feature_type === 'sheet_outline') return 100;
    if (props._preview === 'station_label' || props._preview === 'begin_end_marker') return 90;
    if (props.feature_type === 'overview_sheet_outline') return 35;
    if (props._preview === 'station_tick') return 40;
    if (props.feature_type === 'route' || props._preview === 'route' || props.feature_type === 'overview_route') return 20;
    if (props._udotFiberKey) return udotFiberPdfDrawRank(props._udotFiberKey);
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
function renderFeature(doc, feature, map, transform, captureScale, style, pdfRing = null, screen = null) {
    const geometry = feature?.geometry;
    if (!geometry) return;

    const pxPerPt = transform.pxPerPt;
    const props = feature.properties || {};
    const screenOpts = screen || {
        pxPerPt,
        captureScale,
        zoom: Number(map?.getZoom?.()) || 0,
        matchMapScreenSpace: false,
        maxPt: Math.max(12, (transform.placedRect?.width || 0) * 0.4)
    };

    if (props.feature_type === 'matchline_see_label' || style.kind === 'matchline_see_label') {
        drawMatchlineSeeLabel(doc, feature, map, transform, captureScale, style, pdfRing);
        return;
    }

    if (style.kind === 'inset_label' || props.feature_type === 'inset_label') {
        const [lng, lat] = geometry.coordinates || [];
        if (lng == null || lat == null || !transform?.projectLngLat || !map) return;
        const point = transform.projectLngLat(map, lng, lat, captureScale);
        drawInsetCalloutLabel(doc, point, props, style);
        return;
    }

    if (geometry.type === 'LineString') {
        const points = projectRing(map, geometry.coordinates, transform, captureScale);
        if (style.kind === 'fiber_line') drawFiberLine(doc, points, style, pxPerPt);
        else drawPolyline(doc, points, style, pxPerPt);
        return;
    }

    if (geometry.type === 'MultiLineString') {
        for (const line of geometry.coordinates) {
            const points = projectRing(map, line, transform, captureScale);
            if (style.kind === 'fiber_line') drawFiberLine(doc, points, style, pxPerPt);
            else drawPolyline(doc, points, style, pxPerPt);
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

        if (style.kind === 'fiber_point') {
            drawFiberPoint(doc, point, style, pxPerPt, map.getBearing?.() || 0, screenOpts);
            return;
        }

        drawPoint(doc, point, style, pxPerPt, screenOpts);
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
            } else if (style.kind === 'fiber_point') {
                drawFiberPoint(doc, point, style, pxPerPt, map.getBearing?.() || 0, screenOpts);
            } else {
                drawPoint(doc, point, style, pxPerPt, screenOpts);
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

    const outline = features.find((feature) => feature.properties?.feature_type === 'sheet_outline');
    const outlineRing = outline?.geometry?.type === 'Polygon'
        ? outline.geometry.coordinates[0]
        : (outline?.geometry?.type === 'MultiPolygon' ? outline.geometry.coordinates[0]?.[0] : null);
    const pdfRing = outlineRing?.length && map && transform?.projectLngLat
        ? projectRing(map, outlineRing, transform, captureScale)
        : null;
    const screen = {
        captureScale,
        zoom: Number(map?.getZoom?.()) || 0,
        matchMapScreenSpace: Boolean(resolveStyle?.matchMapScreenSpace),
        maxPt: Math.max(12, (transform?.placedRect?.width || 0) * 0.4)
    };

    for (const feature of features) {
        try {
            const layerId = feature.properties?._sourceLayerId;
            const layerStyle = resolveStyle.layerStyleFor?.(layerId) ?? null;
            const style = resolveVectorFeatureStyle(feature, layerStyle);
            renderFeature(doc, feature, map, transform, captureScale, style, pdfRing, screen);
        } catch (_) {
            // Skip features that fail to project or render.
        }
    }
}
