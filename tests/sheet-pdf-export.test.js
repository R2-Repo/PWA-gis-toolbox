import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SHEET_EXPORT_DPI,
    DEFAULT_SHEET_TEMPLATE,
    computePrintablePageDimensionsIn,
    computeSheetExportPixelDimensions
} from '../js/widgets/sheet-cutting/engine.js';
import { sanitizeExportFilename } from '../js/export/folder-export.js';
import { buildSheetPageFilename } from '../js/widgets/sheet-cutting/sheet-pdf-export.js';

describe('sheet export sizing', () => {
    it('computes printable tabloid landscape dimensions with margins', () => {
        const dims = computePrintablePageDimensionsIn(DEFAULT_SHEET_TEMPLATE);
        expect(dims.pageWidthIn).toBe(17);
        expect(dims.pageHeightIn).toBe(11);
        expect(dims.printableWidthIn).toBe(16);
        expect(dims.printableHeightIn).toBe(10);
    });

    it('targets 150 DPI pixel dimensions by default', () => {
        const dims = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE);
        expect(dims.dpi).toBe(DEFAULT_SHEET_EXPORT_DPI);
        expect(dims.widthPx).toBe(2400);
        expect(dims.heightPx).toBe(1500);
        expect(dims.marginsPt.left).toBe(36);
    });

    it('clamps custom DPI into a safe range', () => {
        const low = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE, 48);
        const high = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE, 600);
        expect(low.dpi).toBe(72);
        expect(high.dpi).toBe(300);
    });
});

describe('sheet export filenames', () => {
    it('sanitizes unsafe filename characters', () => {
        expect(sanitizeExportFilename('My Project: Phase 1')).toBe('My_Project_Phase_1');
    });

    it('builds per-sheet PDF filenames', () => {
        expect(buildSheetPageFilename('Fiber Route', 'sheet_03')).toBe('Fiber_Route_sheet_03.pdf');
        expect(buildSheetPageFilename('Fiber Route', 'overview')).toBe('Fiber_Route_overview.pdf');
    });
});
