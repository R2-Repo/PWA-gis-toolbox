/**
 * Draw per-sheet callout leaders + PROJECT KEY NOTES on corridor and DETAILS PDFs.
 * Overlay only — does not change sheet-cutting polygons.
 */

import { PDF_DETAIL_FOOTER_BAND_IN, PDF_DETAIL_FOOTER_GAP_IN } from '../sheet-cutting/sheet-pdf-orientation.js';
import { pointInPdfRing } from '../sheet-cutting/sheet-pdf-placement.js';
import { leadersForSheet, notesUsedOnSheet } from './leader-placement.js';

const TABLE_PAD = 6;
const ROW_H = 11;
const TITLE_H = 13;
/** PDF points. Slightly smaller than the first pass so numbers stay sharp on tabloid sheets. */
export const CALLOUT_PDF_CIRCLE_R = 4.2;
/** Center-to-center gap; keep stacked numbers nearly touching. */
export const CALLOUT_PDF_CIRCLE_GAP = 8.8;
export const CALLOUT_PDF_FONT_SIZE = 6;
export const CALLOUT_PDF_LINE_WIDTH = 0.45;
const CALLOUT_PDF_TEXT_DY = 2.0;

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
 * @returns {{ x: number, y: number }[]}
 */
export function calloutBubbleCenters(origin, count, gap = CALLOUT_PDF_CIRCLE_GAP) {
    const n = Math.max(0, Number(count) || 0);
    return Array.from({ length: n }, (_, index) => ({
        x: origin.x + index * gap,
        y: origin.y
    }));
}

/**
 * @param {object} params
 * @returns {{ x: number, y: number, width: number, height: number }|null}
 */
export function pickKeyNotesTableRect({
    pageW,
    pageH,
    marginsPt = {},
    footerReservePt,
    goldPdfRing = [],
    tableW,
    tableH,
    clipRect = null
} = {}) {
    const frame = clipRect || {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH
    };
    const left = (clipRect ? frame.x : (marginsPt.left || 0)) + 8;
    const top = (clipRect ? frame.y : (marginsPt.top || 0)) + 8;
    const right = (clipRect ? frame.x + frame.width : pageW - (marginsPt.right || 0)) - tableW - 8;
    const footerY = pageH - (footerReservePt ?? ((PDF_DETAIL_FOOTER_BAND_IN + PDF_DETAIL_FOOTER_GAP_IN) * 72));
    const bottomLimit = clipRect
        ? frame.y + frame.height - tableH - 8
        : Math.min(footerY - tableH - 8, pageH - tableH - 8);
    const bottom = bottomLimit;
    if (bottom < top) return { x: left, y: top, width: tableW, height: tableH };

    const candidates = [
        { x: left, y: top, width: tableW, height: tableH },
        { x: left, y: bottom, width: tableW, height: tableH },
        { x: right, y: bottom, width: tableW, height: tableH },
        { x: right, y: top, width: tableW, height: tableH }
    ];

    for (const rect of candidates) {
        if (!clipRect && rectOverlapsFooter(rect, footerY)) continue;
        if (goldPdfRing.length && rectHitsGoldCut(rect, goldPdfRing)) continue;
        return rect;
    }

    return candidates[0];
}

function rectOverlapsFooter(rect, footerY) {
    return rect.y + rect.height > footerY - 1;
}

function rectHitsGoldCut(rect, goldPdfRing) {
    const samples = [];
    for (let ix = 0; ix <= 2; ix++) {
        for (let iy = 0; iy <= 2; iy++) {
            samples.push({
                x: rect.x + (rect.width * ix) / 2,
                y: rect.y + (rect.height * iy) / 2
            });
        }
    }
    return samples.some((point) => pointInPdfRing(point.x, point.y, goldPdfRing));
}

/**
 * @param {object} session
 * @param {string|{ sheetId?: string, sheetNumber?: number }} sheetOrId
 * @param {object} [options]
 * @returns {{ width: number, height: number }}
 */
export function measureKeyNotesTable(session, sheetOrId, options = {}) {
    const notes = notesUsedOnSheet(session, sheetOrId, options);
    const rows = Math.max(notes.length, 1);
    const longest = notes.reduce((max, note) => Math.max(max, String(note.text || '').length), 12);
    return {
        width: Math.min(240, 72 + longest * 4.2),
        height: TABLE_PAD * 2 + TITLE_H + rows * ROW_H
    };
}

function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function drawNumberedCircle(doc, cx, cy, number) {
    doc.setDrawColor(20, 20, 20);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(CALLOUT_PDF_LINE_WIDTH);
    doc.circle(cx, cy, CALLOUT_PDF_CIRCLE_R, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(CALLOUT_PDF_FONT_SIZE);
    doc.setTextColor(20, 20, 20);
    doc.text(String(number), cx, cy + CALLOUT_PDF_TEXT_DY, { align: 'center' });
}

function drawLeaders(doc, session, leaders, map, transform, captureScale) {
    if (!map || !transform?.projectLngLat || !leaders.length) return;
    const notesById = new Map((session.notes || []).map((note) => [note.noteId, note]));
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(CALLOUT_PDF_LINE_WIDTH);
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
        doc.setDrawColor(20, 20, 20);
        doc.setLineWidth(CALLOUT_PDF_LINE_WIDTH);
        doc.line(from.x, from.y, to.x, to.y);
        const numbers = (leader.noteIds || [])
            .map((id) => notesById.get(id)?.number)
            .filter((value) => Number.isFinite(value));
        const centers = calloutBubbleCenters(to, numbers.length);
        numbers.forEach((number, index) => {
            const center = centers[index];
            drawNumberedCircle(doc, center.x, center.y, number);
        });
    }
}

function drawKeyNotesTable(doc, notes, rect) {
    if (!rect || !notes.length) return;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(30, 30, 30);
    doc.setLineWidth(0.5);
    doc.rect(rect.x, rect.y, rect.width, rect.height, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(20, 20, 20);
    doc.text('PROJECT KEY NOTES', rect.x + TABLE_PAD, rect.y + TABLE_PAD + 8);

    notes.forEach((note, index) => {
        const rowY = rect.y + TABLE_PAD + TITLE_H + index * ROW_H + 4;
        const cx = rect.x + TABLE_PAD + CALLOUT_PDF_CIRCLE_R;
        drawNumberedCircle(doc, cx, rowY, note.number);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(CALLOUT_PDF_FONT_SIZE);
        const textX = cx + CALLOUT_PDF_CIRCLE_R + 4;
        const maxW = rect.width - (textX - rect.x) - TABLE_PAD;
        doc.text(String(note.text || ''), textX, rowY + 2.1, { maxWidth: maxW });
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
        drawLeaders(doc, session, leaders, map, transform, captureScale);
    } catch (error) {
        console.warn('[plan-set-callouts] skipped leader overlay', error);
    }

    const size = measureKeyNotesTable(session, lookup, filter);
    const rect = pickKeyNotesTableRect({
        pageW,
        pageH,
        marginsPt: layoutMargins,
        goldPdfRing,
        tableW: size.width,
        tableH: size.height
    });
    drawKeyNotesTable(doc, notes, rect);
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

    try {
        drawLeaders(doc, session, leaders, options.map, options.transform, options.captureScale || 1);
    } catch (error) {
        console.warn('[plan-set-callouts] skipped inset leader overlay', error);
    }

    const size = measureKeyNotesTable(session, sheetId, filter);
    const clipRect = options.clipRect || options.mapRect || null;
    const pageW = options.pageW || doc.internal.pageSize.getWidth();
    const pageH = options.pageH || doc.internal.pageSize.getHeight();
    const rect = pickKeyNotesTableRect({
        pageW,
        pageH,
        marginsPt: options.layoutMargins || {},
        goldPdfRing: options.goldPdfRing || [],
        tableW: Math.min(size.width, (clipRect?.width || pageW) - 16),
        tableH: size.height,
        clipRect
    });
    drawKeyNotesTable(doc, notes, rect);
}

export { PDF_DETAIL_FOOTER_BAND_IN };
