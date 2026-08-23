import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SHEET_TEMPLATE,
    createSheetCuttingSession,
    generateSheetSet
} from '../js/widgets/sheet-cutting/engine.js';
import {
    addInsetView,
    assignOverlappingSheets,
    assignParentSheet,
    buildInsetCalloutFeatures,
    computeInsetQuadrantRects,
    formatDetailsPageLabel,
    formatInsetParentSheetsLabel,
    formatInsetScaleLabel,
    formatSeeDetailsLabel,
    formatSeeSheetsLabel,
    insetLetterFromIndex,
    packInsetPages,
    placeInsetLabelOutsideBox,
    polygonFromInsetView,
    relabelInsetViews,
    removeInsetView,
    validateInsetViews
} from '../js/widgets/sheet-cutting/inset-views.js';

globalThis.turf = turf;

function sheetFrame(id, number, ring) {
    return turf.polygon([ring], { sheet_id: id, sheet_number: number });
}

describe('sheet cutter inset views', () => {
    const west = sheetFrame('s1', 1, [
        [-112.0, 40.0],
        [-111.95, 40.0],
        [-111.95, 40.02],
        [-112.0, 40.02],
        [-112.0, 40.0]
    ]);
    const east = sheetFrame('s2', 2, [
        [-111.95, 40.0],
        [-111.9, 40.0],
        [-111.9, 40.02],
        [-111.95, 40.02],
        [-111.95, 40.0]
    ]);

    it('letters continue past Z', () => {
        expect(insetLetterFromIndex(0)).toBe('A');
        expect(insetLetterFromIndex(25)).toBe('Z');
        expect(insetLetterFromIndex(26)).toBe('AA');
    });

    it('assigns the parent sheet with the largest overlap', () => {
        const box = turf.bboxPolygon([-111.995, 40.005, -111.952, 40.015]);
        const parent = assignParentSheet(box, [west, east]);
        expect(parent.parentSheetId).toBe('s1');
        expect(parent.parentSheetNumber).toBe(1);
        expect(assignOverlappingSheets(box, [west, east]).map((entry) => entry.parentSheetId)).toEqual(['s1']);
    });

    it('stores every overlapping parent and keeps the largest as parentSheetId', () => {
        const box = turf.bboxPolygon([-111.98, 40.005, -111.93, 40.015]);
        const session = addInsetView({ sheets: { insetViews: [] } }, box, [west, east]);
        const view = session.sheets.insetViews[0];
        expect(view.parentSheetId).toBe('s1');
        expect(view.parentSheetNumber).toBe(1);
        expect(view.parentSheetIds).toEqual(['s1', 's2']);
        expect(view.parentSheetNumbers).toEqual([1, 2]);
        expect(formatInsetParentSheetsLabel(view)).toBe('Sheets 01, 02');
        expect(formatSeeSheetsLabel(view.parentSheetNumbers)).toBe('SEE SHEETS 01, 02');
    });

    it('ignores a sliver nick on the adjacent sheet', () => {
        const box = turf.bboxPolygon([-111.99, 40.005, -111.94995, 40.015]);
        const parents = assignOverlappingSheets(box, [west, east]);
        expect(parents.map((entry) => entry.parentSheetId)).toEqual(['s1']);
        const session = addInsetView({ sheets: { insetViews: [] } }, box, [west, east]);
        expect(session.sheets.insetViews[0].parentSheetIds).toEqual(['s1']);
        expect(session.sheets.insetViews[0].parentSheetNumbers).toEqual([1]);
        expect(formatSeeSheetsLabel(1)).toBe('SEE SHEET 01');
    });

    it('emits a clipped outline and DETAIL A label on each overlapping sheet', () => {
        const box = turf.bboxPolygon([-111.98, 40.005, -111.93, 40.015]);
        const session = addInsetView({ sheets: { insetViews: [] } }, box, [west, east]);
        const view = session.sheets.insetViews[0];
        const features = buildInsetCalloutFeatures([view], { [view.insetId]: 1 }, {
            frameFeatures: [west, east]
        });
        const outlines = features.filter((feature) => feature.properties.feature_type === 'inset_outline');
        const labels = features.filter((feature) => feature.properties.feature_type === 'inset_label');
        expect(outlines).toHaveLength(2);
        expect(labels).toHaveLength(2);
        expect(outlines.map((feature) => feature.properties.parent_sheet_id).sort()).toEqual(['s1', 's2']);
        expect(labels.every((feature) => feature.properties.inset_label === 'DETAIL A')).toBe(true);
        expect(labels.every((feature) => feature.properties.see_details === 'SEE DETAILS 01')).toBe(true);
        expect(turf.booleanIntersects(outlines[0], outlines[1])).toBe(true);
        for (const outline of outlines) {
            const frame = outline.properties.parent_sheet_id === 's1' ? west : east;
            expect(turf.booleanContains(frame, turf.center(outline))).toBe(true);
        }
        for (const label of labels) {
            const frame = label.properties.parent_sheet_id === 's1' ? west : east;
            expect(turf.booleanPointInPolygon(label, box, { ignoreBoundary: true })).toBe(false);
            expect(turf.booleanPointInPolygon(label, frame)).toBe(true);
        }
    });

    it('rejects a box that misses every sheet polygon', () => {
        const session = {
            sheets: { insetViews: [], sheets: [{ sheetId: 's1', sheetNumber: 1, sheetType: 'detail' }] }
        };
        expect(() => addInsetView(session, turf.bboxPolygon([-111.7, 40.0, -111.6, 40.01]), [west, east]))
            .toThrow(/overlaps a sheet polygon/);
    });

    it('adds, labels, and relabels after delete', () => {
        let session = { sheets: { insetViews: [] } };
        const a = turf.bboxPolygon([-111.99, 40.002, -111.98, 40.01]);
        const b = turf.bboxPolygon([-111.93, 40.002, -111.92, 40.01]);
        session = addInsetView(session, a, [west, east]);
        session = addInsetView(session, b, [west, east]);
        expect(session.sheets.insetViews.map((view) => view.label)).toEqual(['A', 'B']);
        expect(session.sheets.insetViews[0].parentSheetNumber).toBe(1);
        expect(session.sheets.insetViews[1].parentSheetNumber).toBe(2);

        session = removeInsetView(session, session.sheets.insetViews[0].insetId);
        expect(session.sheets.insetViews).toHaveLength(1);
        expect(session.sheets.insetViews[0].label).toBe('A');
        expect(session.sheets.insetViews[0].parentSheetNumber).toBe(2);
    });

    it('packs four boxes per page and maps SEE DETAILS page numbers', () => {
        const views = relabelInsetViews(Array.from({ length: 5 }, (_, i) => ({
            insetId: `i${i}`,
            bbox: [-112, 40, -111.99, 40.01]
        })));
        const packed = packInsetPages(views);
        expect(packed.totalInsetPages).toBe(2);
        expect(packed.pages[0].quadrants.filter(Boolean)).toHaveLength(4);
        expect(packed.pages[1].quadrants.filter(Boolean)).toHaveLength(1);
        expect(packed.pages[1].quadrants[1]).toBeNull();
        expect(packed.detailsPageByInsetId.i0).toBe(1);
        expect(packed.detailsPageByInsetId.i4).toBe(2);
        expect(packed.pages[1].title).toBe('DETAILS 02 of 02');
    });

    it('builds corridor callout polygons and labels', () => {
        const session = addInsetView(
            { sheets: { insetViews: [] } },
            turf.bboxPolygon([-111.99, 40.002, -111.98, 40.01]),
            [west]
        );
        const view = session.sheets.insetViews[0];
        const features = buildInsetCalloutFeatures([view], { [view.insetId]: 1 }, { frameFeatures: [west] });
        expect(features.some((feature) => feature.properties.feature_type === 'inset_outline')).toBe(true);
        const label = features.find((feature) => feature.properties.feature_type === 'inset_label');
        expect(label.properties.inset_label).toBe('DETAIL A');
        expect(label.properties.see_details).toBe('SEE DETAILS 01');
        expect(label.properties.label_text).toContain('DETAIL A');
        expect(label.properties.label_anchor).toBeTruthy();
        expect(formatSeeDetailsLabel(3)).toBe('SEE DETAILS 03');
        expect(formatDetailsPageLabel(1, 2)).toBe('DETAILS 01 of 02');
    });

    it('reserves a notes strip under the map without overlapping it', () => {
        const cells = computeInsetQuadrantRects(1224, 792, {
            left: 36,
            right: 36,
            top: 36,
            bottom: 50
        }, { notesReservePt: [72, 0, 48, 0] });
        expect(cells[0].notesRect).toBeTruthy();
        expect(cells[1].notesRect).toBeNull();
        expect(cells[0].notesRect.y).toBeGreaterThanOrEqual(
            cells[0].mapRect.y + cells[0].mapRect.height
        );
        expect(cells[0].mapRect.y + cells[0].mapRect.height)
            .toBeLessThanOrEqual(cells[0].notesRect.y + 0.01);
        expect(cells[0].mapRect.height).toBeLessThan(cells[1].mapRect.height);
        expect(
            cells[0].notesRect.y + cells[0].notesRect.height
        ).toBeLessThanOrEqual(cells[0].chromeRect.y + cells[0].chromeRect.height + 0.01);
    });

    it('lays out four non-overlapping quadrant cells', () => {
        const cells = computeInsetQuadrantRects(1224, 792, {
            left: 36,
            right: 36,
            top: 36,
            bottom: 50
        });
        expect(cells).toHaveLength(4);
        expect(cells[0].mapRect.y).toBeGreaterThan(cells[0].chromeRect.y);
        expect(cells[1].chromeRect.x).toBeGreaterThan(cells[0].chromeRect.x + cells[0].chromeRect.width - 0.01);
        expect(cells[2].chromeRect.y).toBeGreaterThan(cells[0].chromeRect.y + cells[0].chromeRect.height - 0.01);
        const used = cells.reduce((sum, cell) => sum + cell.chromeRect.width * cell.chromeRect.height, 0);
        const frame = (1224 - 72) * (792 - 86);
        expect(used).toBeLessThan(frame);
        expect(used).toBeGreaterThan(frame * 0.9);
    });

    it('formats a per-cell scale from bbox width', () => {
        const box = turf.bboxPolygon([-112.0, 40.0, -111.99, 40.005]);
        const label = formatInsetScaleLabel(box, 216);
        expect(label).toMatch(/^1" = [\d,]+ ft$/);
    });

    it('warns when a detail box parent sheet is gone', () => {
        const warnings = validateInsetViews({
            sheets: {
                insetViews: [{
                    insetId: 'x',
                    label: 'A',
                    bbox: [-111.99, 40.002, -111.98, 40.01],
                    geometry: turf.bboxPolygon([-111.99, 40.002, -111.98, 40.01]).geometry,
                    parentSheetId: 'missing',
                    parentSheetNumber: 9
                }]
            }
        }, [west]);
        expect(warnings[0]).toMatch(/no longer in this set/);
    });

    it('clears inset views when corridor sheets are regenerated', () => {
        const routeLine = turf.lineString([
            [-111.9, 40.75],
            [-111.89, 40.75],
            [-111.88, 40.751]
        ]);
        let session = createSheetCuttingSession({ projectName: 'Insets' });
        session = {
            ...session,
            routeLine,
            sheets: {
                ...session.sheets,
                template: { ...DEFAULT_SHEET_TEMPLATE },
                insetViews: [{
                    insetId: 'stale',
                    label: 'A',
                    bbox: [-111.9, 40.75, -111.89, 40.751],
                    geometry: turf.bboxPolygon([-111.9, 40.75, -111.89, 40.751]).geometry,
                    parentSheetId: 'old',
                    parentSheetNumber: 1
                }]
            }
        };
        session = generateSheetSet(session);
        expect(session.sheets.insetViews).toEqual([]);
        expect(session.sheets.sheets.length).toBeGreaterThan(0);
    });

    it('round-trips stored geometry from bbox', () => {
        const box = turf.bboxPolygon([-111.99, 40.002, -111.98, 40.01]);
        const session = addInsetView({ sheets: { insetViews: [] } }, box, [west]);
        const restored = polygonFromInsetView(session.sheets.insetViews[0]);
        expect(restored.geometry.type).toBe('Polygon');
        expect(turf.booleanIntersects(restored, west)).toBe(true);
    });

    it('places DETAIL text outside the box and inside the sheet', () => {
        const box = turf.bboxPolygon([-111.99, 40.005, -111.98, 40.012]);
        const placed = placeInsetLabelOutsideBox(box, west, []);
        expect(placed).toBeTruthy();
        expect(turf.booleanPointInPolygon(placed.point, box, { ignoreBoundary: true })).toBe(false);
        expect(turf.booleanPointInPolygon(placed.point, west)).toBe(true);
        const center = turf.center(box);
        expect(turf.distance(placed.point, center, { units: 'feet' })).toBeGreaterThan(8);
    });

    it('moves the label off a blocking feature on the preferred side', () => {
        const box = turf.bboxPolygon([-111.99, 40.005, -111.98, 40.012]);
        const northBlock = turf.bboxPolygon([-111.995, 40.012, -111.975, 40.019]);
        const placed = placeInsetLabelOutsideBox(box, west, [northBlock]);
        expect(placed).toBeTruthy();
        expect(turf.booleanPointInPolygon(placed.point, box, { ignoreBoundary: true })).toBe(false);
        expect(turf.booleanPointInPolygon(placed.point, west)).toBe(true);
        expect(turf.booleanPointInPolygon(placed.point, northBlock, { ignoreBoundary: true })).toBe(false);
        expect(placed.bearing === 0).toBe(false);
    });

    it('keeps sequential labels off neighboring detail boxes', () => {
        const a = turf.bboxPolygon([-111.99, 40.002, -111.985, 40.008]);
        const b = turf.bboxPolygon([-111.984, 40.002, -111.979, 40.008]);
        let session = addInsetView({ sheets: { insetViews: [] } }, a, [west]);
        session = addInsetView(session, b, [west]);
        const features = buildInsetCalloutFeatures(
            session.sheets.insetViews,
            { [session.sheets.insetViews[0].insetId]: 1, [session.sheets.insetViews[1].insetId]: 1 },
            { frameFeatures: [west] }
        );
        const labels = features.filter((feature) => feature.properties.feature_type === 'inset_label');
        const outlines = features.filter((feature) => feature.properties.feature_type === 'inset_outline');
        expect(labels).toHaveLength(2);
        for (const label of labels) {
            for (const outline of outlines) {
                expect(turf.booleanPointInPolygon(label, outline, { ignoreBoundary: true })).toBe(false);
            }
            expect(turf.booleanPointInPolygon(label, west)).toBe(true);
        }
        expect(turf.distance(labels[0], labels[1], { units: 'feet' })).toBeGreaterThan(20);
    });
});
