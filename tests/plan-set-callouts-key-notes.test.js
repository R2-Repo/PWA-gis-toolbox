import { describe, expect, it } from 'vitest';
import {
    defaultFooterReservePt,
    layoutKeyNotesTable,
    layoutKeyNotesTableInRect,
    measureInsetNotesReservePt,
    measureKeyNotesTableSize,
    pickKeyNotesTableRect,
    rectIntersectsPdfRing,
    rectsOverlap,
    splitNotesIntoColumns
} from '../js/widgets/plan-set-callouts/key-notes-layout.js';
import { resolveKeyNotesLayout } from '../js/widgets/plan-set-callouts/pdf-callouts.js';

const TABLOID = { pageW: 1224, pageH: 792 };
const MARGINS = { left: 36, right: 36, top: 36, bottom: 36 };

function notes(count, text = 'Centracom 48 SMF') {
    return Array.from({ length: count }, (_, index) => ({
        noteId: `n${index + 1}`,
        number: index + 1,
        text
    }));
}

function centeredGold() {
    return [
        { x: 280, y: 160 },
        { x: 980, y: 160 },
        { x: 980, y: 620 },
        { x: 280, y: 620 }
    ];
}

function rotatedGold() {
    return [
        { x: 170, y: 155 },
        { x: 1165, y: 85 },
        { x: 1110, y: 670 },
        { x: 95, y: 705 }
    ];
}

describe('key notes table layout', () => {
    it('splits notes down columns then across', () => {
        const columns = splitNotesIntoColumns(notes(10), 3);
        expect(columns.map((col) => col.map((note) => note.number))).toEqual([
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10]
        ]);
    });

    it('grows wider and shorter when more columns are used', () => {
        const one = measureKeyNotesTableSize(notes(12), 1);
        const three = measureKeyNotesTableSize(notes(12), 3);
        expect(three.width).toBeGreaterThan(one.width);
        expect(three.height).toBeLessThan(one.height);
    });

    it('places the table in page white space, not on the gold cutout', () => {
        const goldPdfRing = centeredGold();
        const layout = layoutKeyNotesTable({
            notes: notes(6),
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            goldPdfRing,
            reserveNorthArrow: false
        });
        expect(layout).toBeTruthy();
        expect(rectIntersectsPdfRing(layout.rect, goldPdfRing)).toBe(false);
        expect(layout.rect.y + layout.rect.height).toBeLessThan(TABLOID.pageH - defaultFooterReservePt());
        expect(layout.columnCount).toBe(1);
    });

    it('stays off a rotated parallelogram cutout', () => {
        const goldPdfRing = rotatedGold();
        const layout = layoutKeyNotesTable({
            notes: notes(10),
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            goldPdfRing,
            reserveNorthArrow: false
        });
        expect(layout).toBeTruthy();
        expect(rectIntersectsPdfRing(layout.rect, goldPdfRing)).toBe(false);
        expect(layout.rect.y + layout.rect.height).toBeLessThan(TABLOID.pageH - defaultFooterReservePt() - 4);
    });

    it('adds columns when leftover height is too short for one stack', () => {
        const goldPdfRing = [
            { x: 70, y: 150 },
            { x: 1180, y: 150 },
            { x: 1180, y: 720 },
            { x: 70, y: 720 }
        ];
        const layout = layoutKeyNotesTable({
            notes: notes(12, 'Syringa 144 SMF'),
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            goldPdfRing,
            reserveNorthArrow: false
        });
        expect(layout).toBeTruthy();
        expect(layout.columnCount).toBeGreaterThan(1);
        expect(rectIntersectsPdfRing(layout.rect, goldPdfRing)).toBe(false);
        expect(layout.rect.height).toBeLessThan(150);
    });

    it('is page-specific for different cutout shapes', () => {
        const shared = {
            notes: notes(8),
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            reserveNorthArrow: false
        };
        const a = layoutKeyNotesTable({ ...shared, goldPdfRing: centeredGold() });
        const b = layoutKeyNotesTable({
            ...shared,
            goldPdfRing: [
                { x: 80, y: 80 },
                { x: 520, y: 80 },
                { x: 520, y: 700 },
                { x: 80, y: 700 }
            ]
        });
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        expect(a.rect).not.toEqual(b.rect);
    });

    it('does not cover the reserved north-arrow box', () => {
        const avoid = [{ x: 1120, y: 20, width: 80, height: 70 }];
        const layout = layoutKeyNotesTable({
            notes: notes(4, '1d'),
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            goldPdfRing: [
                { x: 80, y: 80 },
                { x: 700, y: 80 },
                { x: 700, y: 700 },
                { x: 80, y: 700 }
            ],
            avoidRects: avoid,
            reserveNorthArrow: false
        });
        expect(layout).toBeTruthy();
        const hit = !(
            layout.rect.x + layout.rect.width <= avoid[0].x
            || avoid[0].x + avoid[0].width <= layout.rect.x
            || layout.rect.y + layout.rect.height <= avoid[0].y
            || avoid[0].y + avoid[0].height <= layout.rect.y
        );
        expect(hit).toBe(false);
    });

    it('pins DETAILS notes inside a reserved strip, not the map cell', () => {
        const mapRect = { x: 40, y: 50, width: 560, height: 280 };
        const notesRect = { x: 40, y: 338, width: 560, height: 72 };
        const layout = resolveKeyNotesLayout(notes(6), {
            ...TABLOID,
            marginsPt: MARGINS,
            clipRect: mapRect,
            notesRect
        });
        expect(layout).toBeTruthy();
        expect(rectsOverlap(layout.rect, mapRect)).toBe(false);
        expect(layout.rect.y).toBeGreaterThanOrEqual(notesRect.y - 0.01);
        expect(layout.rect.y + layout.rect.height).toBeLessThanOrEqual(notesRect.y + notesRect.height + 0.01);
    });

    it('does not fall back onto the DETAIL map when no notes strip is reserved', () => {
        const mapRect = { x: 40, y: 50, width: 560, height: 300 };
        const layout = resolveKeyNotesLayout(notes(8), {
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            clipRect: mapRect,
            avoidRects: [mapRect]
        });
        if (layout) {
            expect(rectsOverlap(layout.rect, mapRect)).toBe(false);
        }
    });

    it('measures a capped per-cell notes reserve', () => {
        const short = measureInsetNotesReservePt(notes(2), 560, 340);
        const tall = measureInsetNotesReservePt(notes(20), 560, 340);
        expect(short).toBeGreaterThan(0);
        expect(tall).toBeGreaterThan(short);
        expect(tall).toBeLessThanOrEqual(340 * 0.5 + 0.01);
        const pinned = layoutKeyNotesTableInRect(notes(4), {
            x: 10, y: 400, width: 500, height: 80
        });
        expect(pinned.rect.y).toBe(400);
        expect(pinned.rect.height).toBeLessThanOrEqual(80);
    });

    it('returns null instead of dropping a fixed table onto the cutout', () => {
        const goldPdfRing = centeredGold();
        const rect = pickKeyNotesTableRect({
            ...TABLOID,
            marginsPt: MARGINS,
            footerReservePt: defaultFooterReservePt(),
            goldPdfRing,
            tableW: 900,
            tableH: 500,
            reserveNorthArrow: false
        });
        expect(rect).toBeNull();
    });
});
