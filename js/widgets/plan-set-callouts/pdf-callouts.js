/**
 * Draw per-sheet callout leaders + PROJECT KEY NOTES on corridor and DETAILS PDFs.
 * Overlay only — does not change sheet-cutting polygons.
 */

import { PDF_DETAIL_FOOTER_BAND_IN } from '../sheet-cutting/sheet-pdf-orientation.js';
import { pointInPdfRing } from '../sheet-cutting/sheet-pdf-placement.js';
import { leadersForSheet, notesUsedOnSheet } from './leader-placement.js';
import { formatCalloutLabel } from './fiber-notes.js';
import {
    CALLOUT_FILL_RGB,
    CALLOUT_PDF_CIRCLE_GAP,
    CALLOUT_PDF_CIRCLE_R,
    CALLOUT_PDF_FONT_SIZE,
    CALLOUT_PDF_LINE_WIDTH,
    CALLOUT_PDF_TABLE_COL_GUTTER,
    CALLOUT_PDF_TABLE_LINE_WIDTH,
    CALLOUT_PDF_TABLE_PAD,
    CALLOUT_PDF_TABLE_ROW_H,
    CALLOUT_PDF_TABLE_TEXT_SIZE,
    CALLOUT_PDF_TABLE_TITLE_H,
    CALLOUT_PDF_TABLE_TITLE_SIZE,
    CALLOUT_PDF_TEXT_DY,
    CALLOUT_STROKE_RGB,
    CALLOUT_TABLE_STROKE_RGB,
    CALLOUT_TEXT_RGB
} from './callout-style.js';
import {
    layoutKeyNotesTable,
    layoutKeyNotesTableInRect,
    measureInsetNotesReservePt,
    measureKeyNotesTableSize,
    pickKeyNotesTableRect,
    rectsOverlap
} from './key-notes-layout.js';

export {
    layoutKeyNotesTable,
    layoutKeyNotesTableInRect,
    measureInsetNotesReservePt,
    pickKeyNotesTableRect
};

export {
    CALLOUT_PDF_CIRCLE_GAP,
    CALLOUT_PDF_CIRCLE_R,
    CALLOUT_PDF_FONT_SIZE,
    CALLOUT_PDF_LINE_WIDTH
};

/**
 * Corridor helper only. Overview pages never get fiber callouts.
 * DETAILS pages use drawInsetCalloutsOnPdf instead of this helper.
 * @param {string} [pageType]
 * @returns {boolean}
 */
export function shouldDrawCalloutsOnPdfPage(pageType) {
    return pageType === 'detail';
}

/**
 * @param {{ x: number, y: number }} origin
 * @param {number} count
 * @param {number} [gap]
 * @param {number} [direction]
 * @returns {{ x: number, y: number }[]}
 */
export function calloutBubbleCenters(origin, count, gap = CALLOUT_PDF_CIRCLE_GAP, direction = 1) {
    const n = Math.max(0, Number(count) || 0);
    const dir = direction < 0 ? -1 : 1;
    return Array.from({ length: n }, (_, index) => ({
        x: origin.x + index * gap * dir,
        y: origin.y
    }));
}

function applySolidStroke(doc, rgb, width) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    doc.setLineWidth(width);
    doc.setLineDashPattern?.([], 0);
    doc.setLineCap?.('round');
    doc.setLineJoin?.('round');
}

function circleFitsInRing(cx, cy, radius, ring, pad = 0.75) {
    if (!ring?.length) return true;
    const m = radius + pad;
    const samples = [
        { x: cx, y: cy },
        { x: cx + m, y: cy },
        { x: cx - m, y: cy },
        { x: cx, y: cy + m },
        { x: cx, y: cy - m }
    ];
    return samples.every((point) => pointInPdfRing(point.x, point.y, ring));
}

function pullPdfPointInside(point, ring, radius) {
    if (!ring?.length || !isFinitePoint(point)) return point;
    if (circleFitsInRing(point.x, point.y, radius, ring)) return point;
    const cx = ring.reduce((sum, entry) => sum + entry.x, 0) / ring.length;
    const cy = ring.reduce((sum, entry) => sum + entry.y, 0) / ring.length;
    let lo = 0;
    let hi = 1;
    let best = { x: cx, y: cy };
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const next = {
            x: point.x + (cx - point.x) * mid,
            y: point.y + (cy - point.y) * mid
        };
        if (circleFitsInRing(next.x, next.y, radius, ring)) {
            best = next;
            hi = mid;
        } else {
            lo = mid;
        }
    }
    return best;
}

function clampPointToRect(point, rect, radius) {
    if (!rect || !isFinitePoint(point)) return point;
    const pad = radius + 1;
    return {
        x: Math.min(Math.max(point.x, rect.x + pad), rect.x + rect.width - pad),
        y: Math.min(Math.max(point.y, rect.y + pad), rect.y + rect.height - pad)
    };
}

/**
 * Keep a stacked numbered cluster fully inside the gold sheet ring (and optional clip cell).
 * @param {{ x: number, y: number }} origin
 * @param {number} count
 * @param {object[]} goldPdfRing
 * @param {{ x: number, y: number, width: number, height: number }|null} clipRect
 * @returns {{ origin: { x: number, y: number }, direction: number }}
 */
export function constrainCalloutCluster(origin, count, goldPdfRing = [], clipRect = null) {
    const n = Math.max(1, Number(count) || 1);
    let next = { ...origin };
    if (clipRect) next = clampPointToRect(next, clipRect, CALLOUT_PDF_CIRCLE_R);
    next = pullPdfPointInside(next, goldPdfRing, CALLOUT_PDF_CIRCLE_R);

    const rightCenters = calloutBubbleCenters(next, n, CALLOUT_PDF_CIRCLE_GAP, 1);
    const rightFits = rightCenters.every((center) => circleFitsInRing(center.x, center.y, CALLOUT_PDF_CIRCLE_R, goldPdfRing))
        && (!clipRect || rightCenters.every((center) => (
            center.x >= clipRect.x + CALLOUT_PDF_CIRCLE_R
            && center.x <= clipRect.x + clipRect.width - CALLOUT_PDF_CIRCLE_R
            && center.y >= clipRect.y + CALLOUT_PDF_CIRCLE_R
            && center.y <= clipRect.y + clipRect.height - CALLOUT_PDF_CIRCLE_R
        )));
    if (rightFits) return { origin: next, direction: 1 };

    const leftOrigin = { x: next.x - (n - 1) * CALLOUT_PDF_CIRCLE_GAP, y: next.y };
    const leftCenters = calloutBubbleCenters(leftOrigin, n, CALLOUT_PDF_CIRCLE_GAP, 1);
    const leftFits = leftCenters.every((center) => circleFitsInRing(center.x, center.y, CALLOUT_PDF_CIRCLE_R, goldPdfRing))
        && (!clipRect || leftCenters.every((center) => (
            center.x >= clipRect.x + CALLOUT_PDF_CIRCLE_R
            && center.x <= clipRect.x + clipRect.width - CALLOUT_PDF_CIRCLE_R
        )));
    if (leftFits) return { origin: leftOrigin, direction: 1 };

    return {
        origin: pullPdfPointInside(next, goldPdfRing, CALLOUT_PDF_CIRCLE_R + (n - 1) * CALLOUT_PDF_CIRCLE_GAP * 0.5),
        direction: 1
    };
}

/**
 * @param {object} session
 * @param {string|{ sheetId?: string, sheetNumber?: number }} sheetOrId
 * @param {object} [options]
 * @returns {{ width: number, height: number }}
 */
export function measureKeyNotesTable(session, sheetOrId, options = {}) {
    const notes = notesUsedOnSheet(session, sheetOrId, options);
    return measureKeyNotesTableSize(notes, options.columnCount || 1);
}

function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function drawNumberedCircle(doc, cx, cy, label) {
    applySolidStroke(doc, CALLOUT_STROKE_RGB, CALLOUT_PDF_LINE_WIDTH);
    doc.setFillColor(CALLOUT_FILL_RGB[0], CALLOUT_FILL_RGB[1], CALLOUT_FILL_RGB[2]);
    doc.circle(cx, cy, CALLOUT_PDF_CIRCLE_R, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(CALLOUT_PDF_FONT_SIZE);
    doc.setTextColor(CALLOUT_TEXT_RGB[0], CALLOUT_TEXT_RGB[1], CALLOUT_TEXT_RGB[2]);
    doc.text(String(label), cx, cy + CALLOUT_PDF_TEXT_DY, { align: 'center' });
}

function drawLeaders(doc, session, leaders, map, transform, captureScale, goldPdfRing = [], clipRect = null) {
    if (!map || !transform?.projectLngLat || !leaders.length) return;
    const notesById = new Map((session.notes || []).map((note) => [note.noteId, note]));
    applySolidStroke(doc, CALLOUT_STROKE_RGB, CALLOUT_PDF_LINE_WIDTH);
    for (const leader of leaders) {
        if (!leader.anchor || !leader.bubble) continue;
        let from;
        let to;
        try {
            from = transform.projectLngLat(map, leader.anchor[0], leader.anchor[1], captureScale);
            to = transform.projectLngLat(map, leader.bubble[0], leader.bubble[1], captureScale);
        } catch {
            continue;
        }
        if (!isFinitePoint(from) || !isFinitePoint(to)) continue;
        if (clipRect) {
            from = clampPointToRect(from, clipRect, 0.5);
            to = clampPointToRect(to, clipRect, CALLOUT_PDF_CIRCLE_R);
        }
        from = pullPdfPointInside(from, goldPdfRing, 0.5);
        const labels = (leader.noteIds || [])
            .map((id) => notesById.get(id))
            .filter((note) => Number.isFinite(Number(note?.number)) && Number(note.number) > 0)
            .map((note) => formatCalloutLabel(note))
            .filter(Boolean);
        const cluster = constrainCalloutCluster(to, Math.max(labels.length, 1), goldPdfRing, clipRect);
        applySolidStroke(doc, CALLOUT_STROKE_RGB, CALLOUT_PDF_LINE_WIDTH);
        doc.line(from.x, from.y, cluster.origin.x, cluster.origin.y);
        const centers = calloutBubbleCenters(cluster.origin, labels.length, CALLOUT_PDF_CIRCLE_GAP, cluster.direction);
        labels.forEach((label, index) => {
            const center = centers[index];
            drawNumberedCircle(doc, center.x, center.y, label);
        });
    }
}

function drawKeyNotesTable(doc, layout) {
    const notes = layout?.notes || [];
    const rect = layout?.rect;
    if (!rect || !notes.length) return;
    const columns = layout.columns?.length ? layout.columns : [notes];
    const colCount = Math.max(1, columns.length);
    const innerW = rect.width - CALLOUT_PDF_TABLE_PAD * 2 - (colCount - 1) * CALLOUT_PDF_TABLE_COL_GUTTER;
    const colW = innerW / colCount;

    doc.setFillColor(CALLOUT_FILL_RGB[0], CALLOUT_FILL_RGB[1], CALLOUT_FILL_RGB[2]);
    applySolidStroke(doc, CALLOUT_TABLE_STROKE_RGB, CALLOUT_PDF_TABLE_LINE_WIDTH);
    doc.rect(rect.x, rect.y, rect.width, rect.height, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(CALLOUT_PDF_TABLE_TITLE_SIZE);
    doc.setTextColor(CALLOUT_TEXT_RGB[0], CALLOUT_TEXT_RGB[1], CALLOUT_TEXT_RGB[2]);
    doc.text('PROJECT KEY NOTES', rect.x + CALLOUT_PDF_TABLE_PAD, rect.y + CALLOUT_PDF_TABLE_PAD + 10);

    columns.forEach((column, colIndex) => {
        const colX = rect.x + CALLOUT_PDF_TABLE_PAD + colIndex * (colW + CALLOUT_PDF_TABLE_COL_GUTTER);
        column.forEach((note, index) => {
            const rowY = rect.y + CALLOUT_PDF_TABLE_PAD + CALLOUT_PDF_TABLE_TITLE_H + index * CALLOUT_PDF_TABLE_ROW_H + 6;
            const cx = colX + CALLOUT_PDF_CIRCLE_R;
            drawNumberedCircle(doc, cx, rowY, formatCalloutLabel(note));
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(CALLOUT_PDF_TABLE_TEXT_SIZE);
            doc.setTextColor(CALLOUT_TEXT_RGB[0], CALLOUT_TEXT_RGB[1], CALLOUT_TEXT_RGB[2]);
            const textX = cx + CALLOUT_PDF_CIRCLE_R + 5;
            const maxW = Math.max(8, colW - (textX - colX));
            doc.text(String(note.text || ''), textX, rowY + 2.4, { maxWidth: maxW });
        });
    });
}

/**
 * Corridor: pack into page white space.
 * DETAILS: pin to `notesRect` under the map. Never fall back onto the map cell.
 *
 * @param {object[]} notes
 * @param {object} [options]
 * @returns {object|null}
 */
export function resolveKeyNotesLayout(notes, options = {}) {
    if (!notes.length) return null;
    if (options.notesRect) {
        return layoutKeyNotesTableInRect(notes, options.notesRect);
    }
    const shared = {
        notes,
        pageW: options.pageW,
        pageH: options.pageH,
        marginsPt: options.layoutMargins || options.marginsPt || {},
        footerReservePt: options.footerReservePt,
        goldPdfRing: options.goldPdfRing || [],
        avoidRects: options.avoidRects || [],
        reserveNorthArrow: options.reserveNorthArrow
    };
    if (!options.clipRect) {
        return layoutKeyNotesTable(shared);
    }
    return layoutKeyNotesTable({
        ...shared,
        goldPdfRing: [],
        avoidRects: [...shared.avoidRects, options.clipRect],
        reserveNorthArrow: false
    });
}

/**
 * Notes whose leaders sit inside this detail box.
 * @param {object} session
 * @param {object} insetView
 * @returns {object[]}
 */
export function insetKeyNotesForView(session, insetView) {
    if (!session || !insetView) return [];
    return notesUsedOnSheet(session, insetView.parentSheetId || '', {
        insetViews: [insetView],
        insetView,
        page: 'inset'
    });
}

/**
 * Corridor sheets only (`pageType === 'detail'`). Skip overview pages.
 * Leaders covered by a detail box are omitted here and drawn on DETAILS pages.
 * @param {import('jspdf').jsPDF} doc
 * @param {object} options
 */
export function drawSheetCalloutsOnPdf(doc, options = {}) {
    const session = options.session;
    const sheet = options.sheet;
    const sheetOrId = sheet || options.sheetId;
    if (!session || !doc || !sheetOrId) return;
    if (options.pageType && !shouldDrawCalloutsOnPdfPage(options.pageType)) return;

    const filter = {
        insetViews: options.insetViews || [],
        page: 'corridor'
    };
    const lookup = sheet || options.sheetId;
    const leaders = leadersForSheet(session, lookup, filter);
    const notes = notesUsedOnSheet(session, lookup, filter);
    if (!leaders.length && !notes.length) return;

    const map = options.map;
    const transform = options.transform;
    const captureScale = options.captureScale || 1;
    const pageW = options.pageW || doc.internal.pageSize.getWidth();
    const pageH = options.pageH || doc.internal.pageSize.getHeight();
    const layoutMargins = options.layoutMargins || {};
    const goldPdfRing = options.goldPdfRing || [];

    try {
        drawLeaders(doc, session, leaders, map, transform, captureScale, goldPdfRing);
    } catch (error) {
        console.warn('[plan-set-callouts] skipped leader overlay', error);
    }

    const layout = resolveKeyNotesLayout(notes, {
        pageW,
        pageH,
        layoutMargins,
        goldPdfRing,
        avoidRects: options.avoidRects || [],
        footerReservePt: options.footerReservePt
    });
    drawKeyNotesTable(doc, layout);
}

/**
 * Draw enabled callouts whose anchors fall inside a detail box, plus that box's key notes.
 * @param {import('jspdf').jsPDF} doc
 * @param {object} options
 */
export function drawInsetCalloutsOnPdf(doc, options = {}) {
    const session = options.session;
    const insetView = options.insetView;
    if (!session || !insetView || !doc) return;

    const filter = {
        insetViews: [insetView],
        insetView,
        page: 'inset'
    };
    const sheetId = insetView.parentSheetId || options.sheetId || '';
    const leaders = leadersForSheet(session, sheetId, filter);
    const notes = notesUsedOnSheet(session, sheetId, filter);
    if (!leaders.length && !notes.length) return;

    const clipRect = options.clipRect || options.mapRect || null;
    try {
        drawLeaders(
            doc,
            session,
            leaders,
            options.map,
            options.transform,
            options.captureScale || 1,
            options.goldPdfRing || [],
            clipRect
        );
    } catch (error) {
        console.warn('[plan-set-callouts] skipped inset leader overlay', error);
    }

    const pageW = options.pageW || doc.internal.pageSize.getWidth();
    const pageH = options.pageH || doc.internal.pageSize.getHeight();
    const layout = resolveKeyNotesLayout(notes, {
        pageW,
        pageH,
        layoutMargins: options.layoutMargins || {},
        goldPdfRing: options.goldPdfRing || [],
        clipRect,
        notesRect: options.notesRect || null,
        avoidRects: options.avoidRects || [],
        footerReservePt: options.footerReservePt,
        reserveNorthArrow: false
    });
    if (layout?.rect && clipRect && rectsOverlap(layout.rect, clipRect)) {
        return;
    }
    drawKeyNotesTable(doc, layout);
}

export { PDF_DETAIL_FOOTER_BAND_IN };
