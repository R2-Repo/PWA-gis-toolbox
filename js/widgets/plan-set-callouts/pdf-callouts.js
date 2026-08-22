/**
 * Draw per-sheet callout leaders + PROJECT KEY NOTES on corridor and DETAILS PDFs.
 * Overlay only — does not change sheet-cutting polygons.
 */

import { PDF_DETAIL_FOOTER_BAND_IN, PDF_DETAIL_FOOTER_GAP_IN } from '../sheet-cutting/sheet-pdf-orientation.js';
import { pointInPdfRing } from '../sheet-cutting/sheet-pdf-placement.js';
import { leadersForSheet, notesUsedOnSheet } from './leader-placement.js';

const TABLE_PAD = 6;
const ROW_H = 12;
const TITLE_H = 14;
const CIRCLE_R = 5.5;
const CIRCLE_GAP = 13;

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
 * @param {string} sheetId
 * @param {object} [options]
 * @returns {{ width: number, height: number }}
 */
export function measureKeyNotesTable(session, sheetId, options = {}) {
    const notes = notesUsedOnSheet(session, sheetId, options);
    const rows = Math.max(notes.length, 1);
    const longest = notes.reduce((max, note) => Math.max(max, String(note.text || '').length), 12);
    return {
        width: Math.min(240, 72 + longest * 4.2),
        height: TABLE_PAD * 2 + TITLE_H + rows * ROW_H
    };
}

function drawLeaders(doc, leaders, session, map, transform, captureScale) {
    if (!map || !transform?.projectLngLat) return;
    const notesById = new Map((session.notes || []).map((note) => [note.noteId, note]));
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(0.6);
    for (const leader of leaders) {
        if (!leader.anchor || !leader.bubble) continue;
        const from = transform.projectLngLat(map, leader.anchor[0], leader.anchor[1], captureScale);
        const to = transform.projectLngLat(map, leader.bubble[0], leader.bubble[1], captureScale);
        doc.line(from.x, from.y, to.x, to.y);
        const numbers = (leader.noteIds || [])
            .map((id) => notesById.get(id)?.number)
            .filter((value) => Number.isFinite(value));
        numbers.forEach((number, index) => {
            const cx = to.x + index * CIRCLE_GAP;
            const cy = to.y;
            doc.setFillColor(255, 255, 255);
            doc.circle(cx, cy, CIRCLE_R, 'FD');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(20, 20, 20);
            doc.text(String(number), cx, cy + 2.2, { align: 'center' });
        });
    }
}

function drawKeyNotesTable(doc, notes, rect) {
    if (!rect) return;
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
        const cx = rect.x + TABLE_PAD + CIRCLE_R;
        doc.setFillColor(255, 255, 255);
        doc.circle(cx, rowY, CIRCLE_R, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text(String(note.number), cx, rowY + 2.2, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        const textX = cx + CIRCLE_R + 5;
        const maxW = rect.width - (textX - rect.x) - TABLE_PAD;
        doc.text(String(note.text || ''), textX, rowY + 2.4, { maxWidth: maxW });
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
    const sheetId = options.sheetId || options.sheet?.sheetId;
    if (!session || !sheetId || !doc) return;

    const filter = {
        insetViews: options.insetViews || [],
        page: 'corridor'
    };
    const leaders = leadersForSheet(session, sheetId, filter);
    const notes = notesUsedOnSheet(session, sheetId, filter);
    if (!leaders.length && !notes.length) return;

    const map = options.map;
    const transform = options.transform;
    const captureScale = options.captureScale || 1;
    const pageW = options.pageW || doc.internal.pageSize.getWidth();
    const pageH = options.pageH || doc.internal.pageSize.getHeight();
    const layoutMargins = options.layoutMargins || {};
    const goldPdfRing = options.goldPdfRing || [];

    drawLeaders(doc, leaders, session, map, transform, captureScale);

    const size = measureKeyNotesTable(session, sheetId, filter);
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

    drawLeaders(doc, leaders, session, options.map, options.transform, options.captureScale || 1);

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
