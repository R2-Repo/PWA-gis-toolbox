import { describe, expect, it } from 'vitest';
import { describeImportBatch, importBatchFileLabel } from '../js/atlas/import/batch-format.js';

describe('atlas import batch format', () => {
    it('labels workbook + ATMS files', () => {
        expect(importBatchFileLabel({
            workbookName: 'FiberSwitchLocation 2026-07-01.xlsx',
            atmsName: 'ATMS.csv'
        })).toBe('FiberSwitchLocation 2026-07-01.xlsx + ATMS.csv');
        expect(importBatchFileLabel({ workbookName: ' alone.xlsx ', atmsName: '' })).toBe('alone.xlsx');
        expect(importBatchFileLabel(null)).toBe('');
        expect(importBatchFileLabel({})).toBe('Import');
    });

    it('describeImportBatch prefers batchDate as title', () => {
        const d = describeImportBatch({
            batchDate: '2026-07-01',
            workbookName: 'wb.xlsx',
            atmsName: 'atms.csv'
        });
        expect(d.title).toBe('2026-07-01');
        expect(d.files).toBe('wb.xlsx + atms.csv');
    });
});
