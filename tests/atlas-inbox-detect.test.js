import { describe, expect, it } from 'vitest';
import {
    detectInboxPair,
    extractDateFromFilename,
    pickNewestAtmsCsv,
    pickNewestWorkbook
} from '../js/atlas/import/detect-inbox-files.js';

describe('atlas inbox file detection', () => {
    it('extracts dates from FiberSwitchLocation filenames', () => {
        expect(extractDateFromFilename('FiberSwitchLocation 2026-07-18.xlsx')).toBe('2026-07-18');
        expect(extractDateFromFilename('other.xlsx')).toBe(null);
    });

    it('picks newest workbook by date in name', () => {
        const files = [
            { name: 'FiberSwitchLocation 2026-07-01.xlsx', ext: 'xlsx', modifiedMs: 100 },
            { name: 'FiberSwitchLocation 2026-07-18.xlsx', ext: 'xlsx', modifiedMs: 50 },
            { name: 'notes.xlsx', ext: 'xlsx', modifiedMs: 999 }
        ];
        expect(pickNewestWorkbook(files).name).toBe('FiberSwitchLocation 2026-07-18.xlsx');
    });

    it('picks ATMS csv by name hints', () => {
        const files = [
            { name: 'random.csv', ext: 'csv', modifiedMs: 200 },
            { name: 'ATMS Master Device List.csv', ext: 'csv', modifiedMs: 100 }
        ];
        expect(pickNewestAtmsCsv(files).name).toBe('ATMS Master Device List.csv');
    });

    it('detects a pair together', () => {
        const pair = detectInboxPair([
            { name: 'FiberSwitchLocation 2026-07-18.xlsx', ext: 'xlsx', path: 'a.xlsx', modifiedMs: 1 },
            { name: 'ATMS_export.csv', ext: 'csv', path: 'b.csv', modifiedMs: 1 }
        ]);
        expect(pair.workbook.path).toBe('a.xlsx');
        expect(pair.atms.path).toBe('b.csv');
    });
});
