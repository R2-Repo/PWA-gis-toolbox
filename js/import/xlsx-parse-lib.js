/**
 * Shared XLSX parse helpers (main thread + worker).
 */
import { read, utils } from 'xlsx';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeExcelRow(raw) {
    const row = Object.create(null);
    for (const [key, value] of Object.entries(raw || {})) {
        if (UNSAFE_KEYS.has(key)) continue;
        row[key] = value;
    }
    return row;
}

export function parseXlsxArrayBuffer(buffer) {
    const workbook = read(buffer, { type: 'array', cellDates: true });
    const sheetNames = workbook.SheetNames || [];
    if (!sheetNames.length) {
        throw new Error('Excel file contains no sheets');
    }
    const sheetName = sheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = utils.sheet_to_json(sheet, { defval: null });
    const rows = rawRows.map(sanitizeExcelRow);
    const fields = rows.length ? Object.keys(rows[0]) : [];
    return { sheetName, sheetNames, rows, fields };
}

export default { sanitizeExcelRow, parseXlsxArrayBuffer };
