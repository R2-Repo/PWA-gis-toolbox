/**
 * Per-page PROJECT KEY NOTES placement: white space only.
 * Stays off the gold map cutout and title-block footer; adds columns when height is tight.
 */

import { PDF_DETAIL_FOOTER_BAND_IN, PDF_DETAIL_FOOTER_GAP_IN } from '../sheet-cutting/sheet-pdf-orientation.js';
import { pointInPdfRing } from '../sheet-cutting/sheet-pdf-placement.js';
import {
    CALLOUT_PDF_TABLE_COL_GUTTER,
    CALLOUT_PDF_TABLE_CUTOUT_GAP,
    CALLOUT_PDF_TABLE_MAX_COL_W,
    CALLOUT_PDF_TABLE_MAX_COLS,
    CALLOUT_PDF_TABLE_MIN_COL_W,
    CALLOUT_PDF_TABLE_MIN_W,
    CALLOUT_PDF_TABLE_PAD,
    CALLOUT_PDF_TABLE_PAGE_INSET,
    CALLOUT_PDF_TABLE_ROW_H,
    CALLOUT_PDF_TABLE_TITLE_H
} from './callout-style.js';

const CORNERS = ['tl', 'tr', 'bl', 'br'];
const NORTH_ARROW_SIZE_PT = 28;

export function defaultFooterReservePt() {
    return (PDF_DETAIL_FOOTER_BAND_IN + PDF_DETAIL_FOOTER_GAP_IN) * 72;
}

export function northArrowAvoidRect(pageW, marginsPt = {}, sizePt = NORTH_ARROW_SIZE_PT) {
    const cx = pageW - (Number(marginsPt.right) || 0) - sizePt * 0.6;
    const cy = (Number(marginsPt.top) || 0) + sizePt * 0.9;
    return {
        x: cx - sizePt * 0.75,
        y: cy - sizePt * 1.55,
        width: sizePt * 1.5,
        height: sizePt * 2.35
    };
}

export function ringBounds(ring = []) {
    if (!ring.length) return null;
    const xs = ring.map((point) => point.x);
    const ys = ring.map((point) => point.y);
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
    };
}

export function rectsOverlap(a, b, gap = 0) {
    if (!a || !b) return false;
    return !(
        a.x + a.width <= b.x - gap
        || b.x + b.width <= a.x - gap
        || a.y + a.height <= b.y - gap
        || b.y + b.height <= a.y - gap
    );
}

function inflateRect(rect, pad) {
    return {
        x: rect.x - pad,
        y: rect.y - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2
    };
}

function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, c, eps = 0.05) {
    return (
        Math.min(a.x, c.x) - eps <= b.x
        && b.x <= Math.max(a.x, c.x) + eps
        && Math.min(a.y, c.y) - eps <= b.y
        && b.y <= Math.max(a.y, c.y) + eps
    );
}

function segmentsIntersect(a, b, c, d) {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
    if (Math.abs(o1) < 1e-6 && onSegment(a, c, b)) return true;
    if (Math.abs(o2) < 1e-6 && onSegment(a, d, b)) return true;
    if (Math.abs(o3) < 1e-6 && onSegment(c, a, d)) return true;
    if (Math.abs(o4) < 1e-6 && onSegment(c, b, d)) return true;
    return false;
}

function rectCorners(rect) {
    return [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height }
    ];
}

function pointInRect(point, rect) {
    return (
        point.x >= rect.x
        && point.x <= rect.x + rect.width
        && point.y >= rect.y
        && point.y <= rect.y + rect.height
    );
}

/**
 * True when an axis-aligned rect overlaps a PDF polygon (either containment).
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {{ x: number, y: number }[]} ring
 * @returns {boolean}
 */
export function rectIntersectsPdfRing(rect, ring = []) {
    if (!rect || !ring.length) return false;
    const corners = rectCorners(rect);
    if (corners.some((point) => pointInPdfRing(point.x, point.y, ring))) return true;
    if (ring.some((point) => pointInRect(point, rect))) return true;
    const edges = [
        [corners[0], corners[1]],
        [corners[1], corners[2]],
        [corners[2], corners[3]],
        [corners[3], corners[0]]
    ];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j];
        const b = ring[i];
        if (!Number.isFinite(a?.x) || !Number.isFinite(b?.x)) continue;
        for (const [c, d] of edges) {
            if (segmentsIntersect(a, b, c, d)) return true;
        }
    }
    return false;
}

export function pageSafeRect({
    pageW,
    pageH,
    marginsPt = {},
    footerReservePt,
    clipRect = null
} = {}) {
    const inset = CALLOUT_PDF_TABLE_PAGE_INSET;
    const footerY = pageH - (footerReservePt ?? defaultFooterReservePt());
    const left = (clipRect ? clipRect.x : (Number(marginsPt.left) || 0)) + inset;
    const top = (clipRect ? clipRect.y : (Number(marginsPt.top) || 0)) + inset;
    const right = (clipRect ? clipRect.x + clipRect.width : pageW - (Number(marginsPt.right) || 0)) - inset;
    const bottom = Math.min(
        clipRect ? clipRect.y + clipRect.height - inset : pageH - inset,
        footerY - inset
    );
    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
}

function insideSafe(rect, safe, eps = 0.6) {
    return (
        rect.x >= safe.x - eps
        && rect.y >= safe.y - eps
        && rect.x + rect.width <= safe.x + safe.width + eps
        && rect.y + rect.height <= safe.y + safe.height + eps
    );
}

function resolveAvoidRects(params = {}) {
    const list = [...(params.avoidRects || [])];
    if (params.reserveNorthArrow !== false && !params.clipRect) {
        list.push(northArrowAvoidRect(params.pageW, params.marginsPt || {}));
    }
    return list.filter((rect) => rect && rect.width > 0 && rect.height > 0);
}

export function rectIsClear(rect, goldPdfRing = [], avoidRects = [], cutoutGap = CALLOUT_PDF_TABLE_CUTOUT_GAP) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    if (goldPdfRing.length && rectIntersectsPdfRing(inflateRect(rect, cutoutGap), goldPdfRing)) {
        return false;
    }
    return avoidRects.every((other) => !rectsOverlap(rect, other, 4));
}

function rectAtCorner(corner, safe, width, height) {
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    switch (corner) {
        case 'tr':
            return { x: safe.x + safe.width - w, y: safe.y, width: w, height: h };
        case 'bl':
            return { x: safe.x, y: safe.y + safe.height - h, width: w, height: h };
        case 'br':
            return { x: safe.x + safe.width - w, y: safe.y + safe.height - h, width: w, height: h };
        default:
            return { x: safe.x, y: safe.y, width: w, height: h };
    }
}

function maxWidthForHeight(corner, safe, height, goldPdfRing, avoidRects) {
    if (height < 8 || height > safe.height + 0.75) return 0;
    let lo = 0;
    let hi = safe.width;
    let best = 0;
    for (let i = 0; i < 22; i += 1) {
        const mid = (lo + hi) / 2;
        const rect = rectAtCorner(corner, safe, mid, height);
        if (insideSafe(rect, safe) && rectIsClear(rect, goldPdfRing, avoidRects)) {
            best = mid;
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return best;
}

function alignRectInPocket(pocket, width, height, corner) {
    const w = Math.min(width, pocket.width);
    const h = Math.min(height, pocket.height);
    switch (corner) {
        case 'tr':
            return { x: pocket.x + pocket.width - w, y: pocket.y, width: w, height: h };
        case 'bl':
            return { x: pocket.x, y: pocket.y + pocket.height - h, width: w, height: h };
        case 'br':
            return {
                x: pocket.x + pocket.width - w,
                y: pocket.y + pocket.height - h,
                width: w,
                height: h
            };
        default:
            return { x: pocket.x, y: pocket.y, width: w, height: h };
    }
}

function whiteRectsFromCorner(corner, safe, goldPdfRing, avoidRects) {
    const found = [];
    const push = (width, height) => {
        if (width < 12 || height < 12) return;
        const rect = rectAtCorner(corner, safe, width, height);
        if (!insideSafe(rect, safe) || !rectIsClear(rect, goldPdfRing, avoidRects)) return;
        found.push({ ...rect, corner });
    };

    push(maxWidthForHeight(corner, safe, safe.height, goldPdfRing, avoidRects), safe.height);
    const steps = 14;
    for (let i = 0; i <= steps; i += 1) {
        const height = 20 + ((safe.height - 20) * i) / steps;
        push(maxWidthForHeight(corner, safe, height, goldPdfRing, avoidRects), height);
    }
    return found;
}

export function measureKeyNotesColumnWidth(notes = []) {
    const longest = notes.reduce((max, note) => Math.max(max, String(note.text || '').length), 12);
    return Math.min(
        CALLOUT_PDF_TABLE_MAX_COL_W,
        Math.max(CALLOUT_PDF_TABLE_MIN_COL_W, 72 + longest * 5.2)
    );
}

/** Max fraction of a DETAILS cell reserved for PROJECT KEY NOTES. */
export const INSET_NOTES_MAX_CELL_FRACTION = 0.32;

/**
 * Height (pt) to reserve under a DETAIL map for that box's key notes.
 * Extra columns shrink the table when a single stack would exceed the cap.
 *
 * @param {object[]} [notes]
 * @param {number} [cellWidth]
 * @param {number} [cellHeight]
 * @returns {number}
 */
export function measureInsetNotesReservePt(notes = [], cellWidth = 0, cellHeight = 0) {
    if (!notes.length || cellWidth < 8 || cellHeight < 8) return 0;
    const minTable = CALLOUT_PDF_TABLE_PAD * 2 + CALLOUT_PDF_TABLE_TITLE_H + CALLOUT_PDF_TABLE_ROW_H;
    const maxH = Math.max(
        minTable,
        Math.min(cellHeight * INSET_NOTES_MAX_CELL_FRACTION, cellHeight * 0.5)
    );
    let best = null;
    for (let cols = 1; cols <= CALLOUT_PDF_TABLE_MAX_COLS; cols += 1) {
        const size = measureKeyNotesTableSize(notes, cols);
        if (size.width <= cellWidth + 0.6 && size.height <= maxH + 0.6) {
            return size.height;
        }
        best = size;
    }
    return best ? Math.min(maxH, best.height) : 0;
}

/**
 * Pin PROJECT KEY NOTES inside a reserved strip. Never used for the map cell.
 *
 * @param {object[]} notes
 * @param {{ x: number, y: number, width: number, height: number }|null} notesRect
 * @returns {{
 *   rect: { x: number, y: number, width: number, height: number },
 *   columnCount: number,
 *   columnWidth: number,
 *   columns: object[][],
 *   notes: object[]
 * }|null}
 */
export function layoutKeyNotesTableInRect(notes = [], notesRect = null) {
    if (!notes.length || !notesRect || notesRect.width < 8 || notesRect.height < 8) {
        return null;
    }
    const chrome = CALLOUT_PDF_TABLE_PAD * 2 + CALLOUT_PDF_TABLE_TITLE_H;
    const rowsFit = Math.max(1, Math.floor((notesRect.height - chrome) / CALLOUT_PDF_TABLE_ROW_H));
    const columnCount = Math.min(
        CALLOUT_PDF_TABLE_MAX_COLS,
        Math.max(1, Math.ceil(notes.length / rowsFit))
    );
    const innerW = notesRect.width - CALLOUT_PDF_TABLE_PAD * 2
        - (columnCount - 1) * CALLOUT_PDF_TABLE_COL_GUTTER;
    const colW = Math.max(8, innerW / columnCount);
    const size = measureKeyNotesTableSize(
        notes,
        columnCount,
        Math.min(CALLOUT_PDF_TABLE_MAX_COL_W, colW)
    );
    return {
        rect: {
            x: notesRect.x,
            y: notesRect.y,
            width: notesRect.width,
            height: Math.min(notesRect.height, size.height)
        },
        columnCount,
        columnWidth: size.columnWidth,
        columns: splitNotesIntoColumns(notes, columnCount),
        notes
    };
}

export function measureKeyNotesTableSize(notes = [], columnCount = 1, columnWidth = null) {
    const cols = Math.max(1, Math.min(CALLOUT_PDF_TABLE_MAX_COLS, Number(columnCount) || 1));
    const rows = Math.max(1, Math.ceil(Math.max(notes.length, 1) / cols));
    const colW = columnWidth ?? measureKeyNotesColumnWidth(notes);
    return {
        width: Math.max(
            CALLOUT_PDF_TABLE_MIN_W,
            CALLOUT_PDF_TABLE_PAD * 2 + cols * colW + (cols - 1) * CALLOUT_PDF_TABLE_COL_GUTTER
        ),
        height: CALLOUT_PDF_TABLE_PAD * 2 + CALLOUT_PDF_TABLE_TITLE_H + rows * CALLOUT_PDF_TABLE_ROW_H,
        columnWidth: colW,
        columnCount: cols,
        rowCount: rows
    };
}

export function splitNotesIntoColumns(notes = [], columnCount = 1) {
    const cols = Math.max(1, Number(columnCount) || 1);
    const rows = Math.max(1, Math.ceil(notes.length / cols));
    const columns = Array.from({ length: cols }, () => []);
    notes.forEach((note, index) => {
        columns[Math.min(cols - 1, Math.floor(index / rows))].push(note);
    });
    return columns;
}

function tryFitNotesInPocket(notes, pocket) {
    const chrome = CALLOUT_PDF_TABLE_PAD * 2 + CALLOUT_PDF_TABLE_TITLE_H;
    const rowsFit = Math.floor((pocket.height - chrome) / CALLOUT_PDF_TABLE_ROW_H);
    if (rowsFit < 1) return null;
    const columnCount = Math.min(
        CALLOUT_PDF_TABLE_MAX_COLS,
        Math.max(1, Math.ceil(notes.length / rowsFit))
    );
    const innerW = pocket.width - CALLOUT_PDF_TABLE_PAD * 2 - (columnCount - 1) * CALLOUT_PDF_TABLE_COL_GUTTER;
    const colW = innerW / columnCount;
    if (colW < CALLOUT_PDF_TABLE_MIN_COL_W) return null;
    const columnWidth = Math.min(CALLOUT_PDF_TABLE_MAX_COL_W, colW);
    const size = measureKeyNotesTableSize(notes, columnCount, columnWidth);
    if (size.width > pocket.width + 0.6 || size.height > pocket.height + 0.6) return null;
    return {
        rect: alignRectInPocket(pocket, size.width, size.height, pocket.corner || 'tl'),
        columnCount,
        columnWidth,
        columns: splitNotesIntoColumns(notes, columnCount),
        notes
    };
}

function candidateRectsForSize(safe, size, goldBounds) {
    const { width: w, height: h } = size;
    const rects = CORNERS.map((corner) => rectAtCorner(corner, safe, w, h));
    if (goldBounds) {
        const gap = CALLOUT_PDF_TABLE_CUTOUT_GAP;
        rects.push(
            { x: goldBounds.minX - gap - w, y: safe.y, width: w, height: h },
            { x: goldBounds.maxX + gap, y: safe.y, width: w, height: h },
            { x: safe.x, y: goldBounds.minY - gap - h, width: w, height: h },
            { x: safe.x, y: goldBounds.maxY + gap, width: w, height: h },
            { x: goldBounds.minX - gap - w, y: safe.y + safe.height - h, width: w, height: h },
            { x: goldBounds.maxX + gap, y: safe.y + safe.height - h, width: w, height: h }
        );
    }
    return rects;
}

/**
 * Place a fixed-size table in page white space (outside gold + footer).
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
    clipRect = null,
    avoidRects = [],
    reserveNorthArrow
} = {}) {
    const params = {
        pageW,
        pageH,
        marginsPt,
        footerReservePt,
        clipRect,
        avoidRects,
        reserveNorthArrow
    };
    const safe = pageSafeRect(params);
    const avoid = resolveAvoidRects(params);
    const size = { width: tableW, height: tableH };
    const goldBounds = ringBounds(goldPdfRing);
    for (const rect of candidateRectsForSize(safe, size, goldBounds)) {
        if (insideSafe(rect, safe) && rectIsClear(rect, goldPdfRing, avoid)) {
            return rect;
        }
    }
    return null;
}

/**
 * Page-specific key-notes layout: position + column split that fits white space.
 * @returns {{
 *   rect: { x: number, y: number, width: number, height: number },
 *   columnCount: number,
 *   columnWidth: number,
 *   columns: object[][],
 *   notes: object[]
 * }|null}
 */
export function layoutKeyNotesTable({
    notes = [],
    pageW,
    pageH,
    marginsPt = {},
    footerReservePt,
    goldPdfRing = [],
    clipRect = null,
    avoidRects = [],
    reserveNorthArrow
} = {}) {
    if (!notes.length || !pageW || !pageH) return null;
    const params = {
        pageW,
        pageH,
        marginsPt,
        footerReservePt,
        clipRect,
        avoidRects,
        reserveNorthArrow
    };
    const safe = pageSafeRect(params);
    if (safe.width < CALLOUT_PDF_TABLE_MIN_W || safe.height < 40) return null;
    const avoid = resolveAvoidRects(params);

    let best = null;
    for (const corner of CORNERS) {
        const pockets = whiteRectsFromCorner(corner, safe, goldPdfRing, avoid);
        let cornerBest = null;
        for (const pocket of pockets) {
            const fit = tryFitNotesInPocket(notes, pocket);
            if (!fit) continue;
            if (
                !cornerBest
                || fit.columnCount < cornerBest.columnCount
                || (fit.columnCount === cornerBest.columnCount && fit.rect.width < cornerBest.rect.width)
            ) {
                cornerBest = fit;
            }
        }
        if (cornerBest) {
            best = cornerBest;
            break;
        }
    }

    if (best) return best;

    for (let cols = 1; cols <= CALLOUT_PDF_TABLE_MAX_COLS; cols += 1) {
        const size = measureKeyNotesTableSize(notes, cols);
        const rect = pickKeyNotesTableRect({
            ...params,
            tableW: size.width,
            tableH: size.height
        });
        if (!rect) continue;
        return {
            rect,
            columnCount: cols,
            columnWidth: size.columnWidth,
            columns: splitNotesIntoColumns(notes, cols),
            notes
        };
    }

    return null;
}
