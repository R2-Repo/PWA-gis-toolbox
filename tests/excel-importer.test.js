import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { LIMITS } from '../js/import/import-limits.js';
import { importExcel } from '../js/import/excel-importer.js';
import { sanitizeExcelRow } from '../js/import/xlsx-parse-lib.js';
import { TaskRunner } from '../js/core/task-runner.js';

function buildXlsxBuffer(rows) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('excel importer hardening', () => {
    it('drops unsafe keys when sanitizing parsed rows', () => {
        const row = sanitizeExcelRow({ __proto__: 'polluted', constructor: 'x', lat: 40, lon: -111 });
        expect(Object.prototype.hasOwnProperty.call(row, '__proto__')).toBe(false);
        expect('__proto__' in row).toBe(false);
        expect(row.lat).toBe(40);
    });

    it('does not allow __proto__ header cells to pollute imported table rows', async () => {
        const buffer = buildXlsxBuffer([{ __proto__: 'polluted', name: 'A' }]);
        const file = new File([buffer], 'proto.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const task = new TaskRunner('test', 'Import');
        const ds = await importExcel(file, task);
        expect(ds.type).toBe('table');
        expect(ds.rows[0].name).toBe('A');
        expect('__proto__' in ds.rows[0]).toBe(false);
    });

    it('refuses workbooks over the parse byte cap before parsing', async () => {
        const buffer = buildXlsxBuffer([{ a: 1 }]);
        const file = new File([buffer], 'big.xlsx');
        Object.defineProperty(file, 'size', { value: LIMITS.xlsxMaxParseBytes + 1 });
        const task = new TaskRunner('test', 'Import');
        await expect(importExcel(file, task)).rejects.toMatchObject({
            category: 'OUT_OF_MEMORY'
        });
    });

    it('imports a normal coordinate sheet', async () => {
        const buffer = buildXlsxBuffer([
            { lat: 40.1, lon: -111.9, name: 'A' },
            { lat: 40.2, lon: -111.8, name: 'B' }
        ]);
        const file = new File([buffer], 'points.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const task = new TaskRunner('test', 'Import');
        const ds = await importExcel(file, task);
        expect(ds.type).toBe('spatial');
        expect(ds.geojson.features).toHaveLength(2);
    });
});
