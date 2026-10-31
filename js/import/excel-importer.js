/**
 * Excel (.xlsx) importer using SheetJS
 */
import { createTableDataset, createSpatialDataset } from '../core/data-model.js';
import { AppError, ErrorCategory } from '../core/error-handler.js';
import {
    parseCoordValue,
    detectAnyCoordinateColumns
} from './coord-detect.js';
import { projectedTableCrsMetadata } from './import-crs.js';
import { LIMITS } from './import-limits.js';
import { parseXlsxArrayBuffer, sanitizeExcelRow } from './xlsx-parse-lib.js';

const XLSX_PARSE_TIMEOUT_MS = 60_000;

function assertWithinParseBudget(byteLength, fileName) {
    if (!Number.isFinite(byteLength) || byteLength <= LIMITS.xlsxMaxParseBytes) return;
    throw new AppError(
        `"${fileName}" is too large to parse as Excel in the browser (limit ${LIMITS.xlsxMaxParseBytes} bytes). Split or export CSV externally.`,
        ErrorCategory.OUT_OF_MEMORY,
        { fileName, bytes: byteLength, limit: LIMITS.xlsxMaxParseBytes }
    );
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ timeoutMs?: number, fileName?: string }} [options]
 */
export function parseXlsxBuffer(buffer, options = {}) {
    const timeoutMs = options.timeoutMs ?? XLSX_PARSE_TIMEOUT_MS;
    assertWithinParseBudget(buffer.byteLength, options.fileName || 'workbook.xlsx');

    if (typeof Worker === 'undefined') {
        return Promise.resolve(parseXlsxArrayBuffer(buffer));
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const worker = new Worker(new URL('./xlsx-parse.worker.js', import.meta.url), { type: 'module' });
        const copy = buffer.slice(0);

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            worker.terminate();
            reject(new AppError('Excel parse timed out', ErrorCategory.TIMEOUT));
        }, timeoutMs);

        worker.onmessage = (event) => {
            if (event.data?.requestId !== requestId) return;
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.terminate();
            if (event.data.error) {
                reject(new AppError(event.data.error, ErrorCategory.PARSE_FAILED));
                return;
            }
            resolve(event.data);
        };

        worker.onerror = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.terminate();
            reject(new AppError(err.message || 'Excel worker failed', ErrorCategory.PARSE_FAILED));
        };

        worker.postMessage({ buffer: copy, requestId }, [copy]);
    });
}

function _detectCoordInfo(fields, rows) {
    return detectAnyCoordinateColumns(fields, rows);
}

export async function importExcel(file, task, options = {}) {
    task.updateProgress(20, 'Reading Excel file...');

    const buffer = options.buffer ?? await file.arrayBuffer();
    const declaredSize = Math.max(file.size ?? 0, buffer.byteLength);
    assertWithinParseBudget(declaredSize, file.name);

    task.updateProgress(40, 'Parsing workbook...');
    let parsed;
    try {
        parsed = await parseXlsxBuffer(buffer.slice(0), { fileName: file.name });
    } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError('Failed to parse Excel file: ' + e.message, ErrorCategory.PARSE_FAILED);
    }

    const { sheetName, sheetNames, rows: rawRows } = parsed;
    const rows = rawRows.map(sanitizeExcelRow);

    if (rows.length === 0) {
        throw new AppError('Excel sheet is empty', ErrorCategory.PARSE_FAILED);
    }

    const fields = Object.keys(rows[0]);
    const name = file.name.replace(/\.(xlsx|xls)$/i, '') + (sheetNames.length > 1 ? `_${sheetName}` : '');

    task.updateProgress(70, `Parsing sheet: ${sheetName}...`);
    const coordInfo = _detectCoordInfo(fields, rows);

    if (coordInfo) {
        const features = rows.map(row => {
            const lat = parseCoordValue(row[coordInfo.latField]);
            const lon = parseCoordValue(row[coordInfo.lonField]);
            const geom = (!isNaN(lat) && !isNaN(lon))
                ? { type: 'Point', coordinates: [lon, lat] }
                : null;
            return { type: 'Feature', geometry: geom, properties: { ...row } };
        });
        const fc = { type: 'FeatureCollection', features };
        const crsMeta = coordInfo.projected
            ? projectedTableCrsMetadata(options.sourceCrs)
            : { crs: 'EPSG:4326', crsDetected: 'default' };
        const ds = createSpatialDataset(name, fc, {
            file: file.name, format: 'xlsx', sheet: sheetName,
            sheets: sheetNames, coordDetected: coordInfo,
            crsDetected: crsMeta.crsDetected,
            crsWarning: crsMeta.crsWarning
        }, { crs: crsMeta.crs });
        ds._coordInfo = coordInfo;
        ds._sheets = sheetNames;
        return ds;
    }

    const ds = createTableDataset(name, rows, fields, {
        file: file.name, format: 'xlsx', sheet: sheetName, sheets: sheetNames
    });
    ds._sheets = sheetNames;
    return ds;
}
