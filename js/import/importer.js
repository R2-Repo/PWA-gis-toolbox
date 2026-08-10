/**
 * Import registry — detects format and dispatches to the right importer
 */
import logger from '../core/logger.js';
import { TaskRunner, getActiveTask } from '../core/task-runner.js';
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { importGeoJSON } from './geojson-importer.js';
import { importCSV } from './csv-importer.js';
import { importExcel } from './excel-importer.js';
import { importKML } from './kml-importer.js';
import { importGPX } from './gpx-importer.js';
import { importKMZ } from './kmz-importer.js';
import { importShapefile } from './shapefile-importer.js';
import { importJSON } from './json-importer.js';
import { loadJSZip } from '../core/libs.js';
import { readFilePayload } from './file-payload.js';
import { MAX_IMPORT_FEATURES } from './import-preflight.js';
import { guardFilesBeforeImport } from './import-guard.js';
import { assertFileReadable } from './import-memory-budget.js';
import { assertZipBufferWithinBudget } from './zip-utils.js';
import { filterImportResult } from './import-field-filter.js';
import { applyImportCrsMetadata } from './import-crs.js';

function _enforceFeatureCap(result, fileName) {
    const datasets = Array.isArray(result) ? result : [result];
    for (const ds of datasets) {
        if (!ds) continue;
        if (ds.type === 'spatial') {
            const n = ds.geojson?.features?.length || 0;
            if (n > MAX_IMPORT_FEATURES) {
                throw new AppError(
                    `"${fileName}" has ${n.toLocaleString()} features — exceeds the ${MAX_IMPORT_FEATURES.toLocaleString()} feature limit. Split or simplify the file externally.`,
                    ErrorCategory.OUT_OF_MEMORY,
                    { fileName, featureCount: n }
                );
            }
        } else if (ds.type === 'table') {
            const n = ds.rows?.length || 0;
            if (n > MAX_IMPORT_FEATURES) {
                throw new AppError(
                    `"${fileName}" has ${n.toLocaleString()} rows — exceeds the ${MAX_IMPORT_FEATURES.toLocaleString()} row limit. Split or simplify the file externally.`,
                    ErrorCategory.OUT_OF_MEMORY,
                    { fileName, rowCount: n }
                );
            }
        }
    }
}

function _xmlTextLooksLikeKml(text) {
    const head = text.trim().slice(0, 12000);
    if (/<kml[\s/>]/i.test(head)) return true;
    if (/http:\/\/www\.opengis\.net\/kml\/2\.[0-3]/i.test(head)) return true;
    if (/urn:googleearth:documentation:/i.test(head)) return true;
    return false;
}

async function importXML(file, task, payloadOpts = {}) {
    const text = payloadOpts.text ?? await file.text();
    if (!_xmlTextLooksLikeKml(text)) {
        throw new AppError(
            'This XML file does not appear to be KML. Expected a root <kml> element (OGC KML namespace).',
            ErrorCategory.UNSUPPORTED_FORMAT,
            { fileName: file.name }
        );
    }
    return importKML(text, task, {
        sourceFileName: file.name,
        text,
        importMode: payloadOpts.importMode
    });
}

/**
 * Sniff a .zip archive: shapefile vs KMZ-style (contains .kml).
 * @param {ArrayBuffer} buffer
 * @returns {Promise<'shapefile'|'kmz'|null>}
 */
export async function detectZipKindFromBuffer(buffer, fileName = '') {
    const JSZipLib = await loadJSZip();
    if (!JSZipLib?.loadAsync) return null;

    if (fileName) {
        await assertZipBufferWithinBudget(buffer, JSZipLib, fileName);
    }

    let zip;
    try {
        zip = await JSZipLib.loadAsync(buffer);
    } catch {
        return null;
    }

    let hasKml = false;
    let hasShp = false;
    zip.forEach((path, entry) => {
        if (entry.dir) return;
        const low = path.toLowerCase();
        if (low.endsWith('.kml')) hasKml = true;
        if (low.endsWith('.shp')) hasShp = true;
    });

    if (hasShp) return 'shapefile';
    if (hasKml) return 'kmz';
    return null;
}

/** @deprecated use detectZipKindFromBuffer after single read */
export async function detectZipKind(file) {
    const buffer = await file.arrayBuffer();
    return detectZipKindFromBuffer(buffer);
}

async function importZip(file, task, payloadOpts = {}) {
    const buffer = payloadOpts.buffer ?? await file.arrayBuffer();
    const kind = await detectZipKindFromBuffer(buffer, file.name);
    if (kind === 'kmz') {
        return importKMZ(file, task, { buffer, importMode: payloadOpts.importMode });
    }
    if (kind === 'shapefile') {
        return importShapefile(file, task, { buffer });
    }
    throw new AppError(
        'This ZIP is neither a shapefile (.shp/.dbf/.shx) nor a KMZ archive (.kml inside ZIP).',
        ErrorCategory.UNSUPPORTED_FORMAT,
        { fileName: file.name }
    );
}

const FORMAT_MAP = {
    geojson: importGeoJSON,
    json: importJSON,
    csv: importCSV,
    tsv: importCSV,
    txt: importCSV,
    xlsx: importExcel,
    xls: importExcel,
    kml: importKML,
    gpx: importGPX,
    kmz: importKMZ,
    zip: importZip,
    xml: importXML
};

export function detectFormat(file) {
    const name = file.name.toLowerCase();
    const ext = name.split('.').pop();
    if (ext === 'geojson') return 'geojson';
    if (ext === 'json') return 'json';
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
    if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
    if (ext === 'kml') return 'kml';
    if (ext === 'gpx') return 'gpx';
    if (ext === 'kmz') return 'kmz';
    if (ext === 'zip') return 'zip';
    if (ext === 'xml') return 'xml';
    return null;
}

function _payloadOptionsForImporter(format, payload) {
    if (!payload) return {};
    if (payload.kind === 'text') {
        if (format === 'kml' || format === 'gpx') {
            return { sourceFileName: undefined, text: payload.data };
        }
        if (format === 'xml') {
            return { text: payload.data };
        }
        return { text: payload.data };
    }
    if (payload.kind === 'buffer') {
        return { buffer: payload.data };
    }
    return {};
}

/**
 * Core import logic — does not wrap in task.run (for batch imports).
 * @param {File} file
 * @param {import('../core/task-runner.js').TaskRunner} task
 * @param {{ format?: string, payload?: object, fileIndex?: number, fileCount?: number }} [options]
 */
export async function importFileCore(file, task, options = {}) {
    const format = options.format ?? detectFormat(file);
    if (!format) {
        throw new AppError(
            `Unsupported file format: ${file.name}`,
            ErrorCategory.UNSUPPORTED_FORMAT,
            { fileName: file.name }
        );
    }

    const importer = FORMAT_MAP[format === 'tsv' || format === 'txt' ? 'csv' : format];
    if (!importer) {
        throw new AppError(`No importer for format: ${format}`, ErrorCategory.UNSUPPORTED_FORMAT);
    }

    const fileIndex = options.fileIndex ?? 0;
    const fileCount = options.fileCount ?? 1;
    const prefix = fileCount > 1 ? `File ${fileIndex + 1}/${fileCount}: ` : '';

    task.updateProgress(
        Math.round((fileIndex / Math.max(fileCount, 1)) * 90),
        `${prefix}Reading ${file.name}...`,
        fileIndex,
        fileCount,
        { fileName: file.name, fileSize: file.size, fileIndex, fileCount }
    );
    logger.info('Importer', 'Starting import', { file: file.name, format, size: file.size });

    assertFileReadable(file, format);

    const payload = options.payload ?? await readFilePayload(file, format);
    const payloadOpts = _payloadOptionsForImporter(format, payload);

    let result;
    if (format === 'kml') {
        const text = payload?.kind === 'text' ? payload.data : await file.text();
        result = await importKML(text, task, {
            sourceFileName: file.name,
            text,
            importMode: options.importMode
        });
    } else if (format === 'xml') {
        result = await importXML(file, task, { ...payloadOpts, importMode: options.importMode });
    } else if (format === 'zip') {
        result = await importZip(file, task, { ...payloadOpts, importMode: options.importMode });
    } else if (format === 'kmz') {
        result = await importKMZ(file, task, { ...payloadOpts, importMode: options.importMode });
    } else if (format === 'json') {
        let parsed;
        if (payload?.kind === 'text') {
            try {
                parsed = JSON.parse(payload.data);
            } catch (e) {
                throw new AppError('Invalid JSON', ErrorCategory.PARSE_FAILED, { file: file.name });
            }
            result = await importJSON(file, task, { text: payload.data, parsed });
        } else {
            result = await importJSON(file, task);
        }
    } else if (format === 'geojson') {
        if (payload?.kind === 'text') {
            result = await importGeoJSON(file, task, { sourceFileName: file.name, text: payload.data });
        } else {
            result = await importGeoJSON(file, task);
        }
    } else if (format === 'gpx') {
        if (payload?.kind === 'text') {
            result = await importGPX(file, task, { sourceFileName: file.name, text: payload.data });
        } else {
            result = await importGPX(file, task);
        }
    } else {
        result = await importer(file, task, payloadOpts);
    }

    if (payload?.kind === 'text') payload.data = null;
    if (payload?.kind === 'buffer') payload.data = null;

    result = applyImportCrsMetadata(result, options);

    if (options.selectedFields?.length) {
        result = filterImportResult(result, options.selectedFields);
    }

    _enforceFeatureCap(result, file.name);

    if (file.size > 0) {
        const stampFileSize = (dataset) => {
            if (!dataset?.source) return;
            dataset.source.fileSize = file.size;
        };
        if (Array.isArray(result)) {
            result.forEach(stampFileSize);
        } else if (result) {
            stampFileSize(result);
        }
    }

    if (Array.isArray(result)) {
        logger.info('Importer', 'Import complete (multi-layer)', {
            file: file.name, format, layers: result.length,
            totalFeatures: result.reduce((sum, r) => sum + (r.geojson?.features?.length || 0), 0)
        });
    } else {
        logger.info('Importer', 'Import complete', {
            file: file.name, format,
            type: result.type,
            features: result.type === 'spatial' ? result.geojson?.features?.length : result.rows?.length,
            fields: result.schema?.fields?.length
        });
    }

    return result;
}

export async function importFile(file, options = {}) {
    if (!options.skipGuard && !options._batchMode) {
        const guard = await guardFilesBeforeImport([file], {
            source: options.source || 'importFile',
            getLayers: options.getLayers
        });
        if (guard.cancelled) return null;
    }

    if (options.task && options._batchMode) {
        return importFileCore(file, options.task, options);
    }

    const task = options.task || new TaskRunner(`Import ${file.name}`, 'Importer');
    return task.run(async (t) => importFileCore(file, t, options));
}

/**
 * @param {File[]} files
 * @param {{ task?: import('../core/task-runner.js').TaskRunner, onFileImported?: (file: File, result: object|object[]|null, index: number) => Promise<void>|void }} [options]
 */
export async function importFiles(files, options = {}) {
    let lastResult = { datasets: [], errors: [], cancelled: false };

    const runBatch = async (task) => {
        const results = [];
        const errors = [];
        let cancelled = false;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (task.cancelled || getActiveTask()?.cancelled) {
                cancelled = true;
                break;
            }

            try {
                task.throwIfCancelled();
                const ds = await importFileCore(file, task, {
                    fileIndex: i,
                    fileCount: files.length,
                    _batchMode: true,
                    importMode: options.importMode,
                    useWorkspace: options.useWorkspace,
                    selectedFields: options.selectedFields
                });

                if (ds === null || task.cancelled) {
                    cancelled = true;
                    break;
                }

                if (ds) {
                    if (Array.isArray(ds)) results.push(...ds);
                    else results.push(ds);
                }

                if (options.onFileImported) {
                    await options.onFileImported(file, ds, i);
                }
            } catch (e) {
                if (e?.cancelled || task.cancelled || getActiveTask()?.cancelled) {
                    cancelled = true;
                    break;
                }
                errors.push({ file: file.name, error: e });
                logger.error('Importer', 'File import failed', { file: file.name, error: e.message });
            }
        }

        lastResult = { datasets: results, errors, cancelled };
        return lastResult;
    };

    if (options.task) {
        return runBatch(options.task);
    }

    const batchTask = new TaskRunner(`Import ${files.length} file(s)`, 'Importer');
    const ret = await batchTask.run(runBatch);
    if (ret === null) {
        return { ...lastResult, cancelled: true };
    }
    return ret;
}

export default { importFile, importFileCore, importFiles, detectFormat, detectZipKind, detectZipKindFromBuffer };
