import { describe, expect, it } from 'vitest';
import {
    compactImportBatchSummary,
    describeImportBatch,
    formatImportBatchCounts,
    formatImportBatchDiff,
    importBatchFileLabel
} from '../js/atlas/import/batch-format.js';

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

    it('compactImportBatchSummary keeps counts + diff counts only', () => {
        const snap = compactImportBatchSummary(
            {
                batchDate: '2026-07-01',
                workbookName: 'wb.xlsx',
                atmsName: 'a.csv',
                counts: { hubs: 2, channels: 10, sites: 5, drops: 40, devices: 40, findings: 3 }
            },
            {
                emptyCurrent: false,
                counts: {
                    newIps: 4,
                    missingIps: 1,
                    changedIps: 2,
                    newChannels: 0,
                    missingChannels: 0,
                    newDrops: 3,
                    missingDrops: 1
                },
                newIps: ['10.0.0.1', '10.0.0.2']
            }
        );
        expect(snap.counts.drops).toBe(40);
        expect(snap.diff.newIps).toBe(4);
        expect(snap.diff.missingIps).toBe(1);
        expect(snap.emptyCurrent).toBe(false);
        expect(snap).not.toHaveProperty('newIps');
    });

    it('formats counts and diff lines', () => {
        const batch = {
            summary: {
                counts: { channels: 12, drops: 80, findings: 5 },
                diff: { newIps: 3, missingIps: 1, changedIps: 2 },
                emptyCurrent: false
            }
        };
        expect(formatImportBatchCounts(batch)).toBe('12 ch · 80 drops · 5 findings');
        expect(formatImportBatchDiff(batch)).toBe('+3 / −1 IPs · 2 changed');
        expect(formatImportBatchDiff({ summary: { emptyCurrent: true } })).toBe('Initial import');
        expect(formatImportBatchCounts({})).toBe('');
    });
});
