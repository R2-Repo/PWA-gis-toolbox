/**
 * Export registry — dispatches to format-specific exporters
 */
import logger from '../core/logger.js';
import { getSelectedFields, applyFieldSelection, isWorkspaceLayer, getLayerFeatureCount } from '../core/data-model.js';
import { isCoverageRasterLayer } from '../core/coverage-raster-layer.js';
import { TaskRunner } from '../core/task-runner.js';
import { exportGeoJSON } from './geojson-exporter.js';
import { exportCSV } from './csv-exporter.js';
import { exportExcel } from './excel-exporter.js';
import { exportKML, exportMultiLayerKML } from './kml-exporter.js';
import { exportGPX } from './gpx-exporter.js';
import { exportKMZ, exportMultiLayerKMZ } from './kmz-exporter.js';
import { exportJSON } from './json-exporter.js';
import { exportShapefile } from './shapefile-exporter.js';
import {
    exportCoverageKMZ,
    exportCoverageRasterZip,
    exportMixedCoverageMultiLayerKMZ
} from './coverage-raster-exporter.js';
import {
    shouldUseStreamExport,
    exportWorkspaceLayerStreamed,
    materializeWorkspaceDatasetForExport
} from './stream-export-service.js';
import { MAX_MATERIALIZE_FEATURES } from '../tools/gis-layer-context.js';

// Optional map API adapter for style lookup (mapService).
let _mapApi = null;
export function setExportMapManager(mm) { _mapApi = mm; }

const EXPORTERS = {
    geojson: { fn: exportGeoJSON, label: 'GeoJSON', ext: '.geojson', spatial: true },
    json: { fn: exportJSON, label: 'JSON', ext: '.json', spatial: false },
    csv: { fn: exportCSV, label: 'CSV', ext: '.csv', spatial: false },
    xlsx: { fn: exportExcel, label: 'Excel (.xlsx)', ext: '.xlsx', spatial: false },
    kml: { fn: exportKML, label: 'KML', ext: '.kml', spatial: true },
    gpx: { fn: exportGPX, label: 'GPX', ext: '.gpx', spatial: true },
    kmz: { fn: exportKMZ, label: 'KMZ', ext: '.kmz', spatial: true },
    shapefile: { fn: exportShapefile, label: 'Shapefile (.shp)', ext: '.zip', spatial: true },
    'coverage-kmz': { fn: exportCoverageKMZ, label: 'KMZ (Coverage Overlay)', ext: '.kmz', spatial: true, coverageOnly: true },
    'coverage-raster': { fn: exportCoverageRasterZip, label: 'Georeferenced PNG (.zip)', ext: '.zip', spatial: true, coverageOnly: true }
};

const COVERAGE_RASTER_HIDDEN_FORMATS = new Set(['kml', 'kmz', 'gpx', 'shapefile', 'csv', 'xlsx']);

/**
 * Get available export formats for a dataset
 */
export function getAvailableFormats(dataset) {
    const isSpatial = (dataset.type === 'spatial' || dataset.type === 'spatial-chunked' || dataset.storage === 'workspace')
        && dataset.schema?.geometryType;
    const coverageRaster = isCoverageRasterLayer(dataset);
    const formats = [];

    for (const [key, exp] of Object.entries(EXPORTERS)) {
        if (exp.coverageOnly && !coverageRaster) continue;
        if (coverageRaster && COVERAGE_RASTER_HIDDEN_FORMATS.has(key)) continue;
        if (exp.spatial && !isSpatial) continue;
        formats.push({ key, label: exp.label, ext: exp.ext });
    }

    return formats;
}

/**
 * Export a dataset to a specific format
 */
export async function exportDataset(dataset, format, options = {}) {
    const exp = EXPORTERS[format];
    if (!exp) throw new Error(`Unknown export format: ${format}`);

    logger.info('Exporter', 'Starting export', {
        format,
        name: dataset.name,
        type: dataset.type,
        featureCount: dataset.geojson?.features?.length ?? dataset.rows?.length ?? null
    });

    const task = new TaskRunner(`Export ${format.toUpperCase()}`, 'Exporter');
    return task.run(async (t) => {
        t.updateProgress(10, 'Preparing data...');

        // Auto-attach photo data for photo datasets
        if (dataset._photoExportData && format === 'kmz' && !options.photos) {
            options.photos = dataset._photoExportData;
            options.embedThumbnails = !dataset._useFullSize;
            options.skipFieldSelection = true;
        }

        // Auto-attach layer style for spatial exports
        if (!options.style && _mapApi) {
            const layerStyle = _mapApi.getLayerStyle(dataset.id);
            if (layerStyle) options.style = layerStyle;
        }

        // Workspace GeoJSON/CSV: streamed path (joins cold attrs, OPFS staging).
        if (shouldUseStreamExport(dataset, format)) {
            t.updateProgress(30, `Generating ${format}...`);
            const result = await exportWorkspaceLayerStreamed(dataset, format, options, t);
            logger.info('Exporter', 'Streamed export complete', {
                format,
                name: dataset.name,
                size: result.blob?.size,
                staged: result.staged
            });
            const filename = (options.filename || dataset.name || 'export') + exp.ext;
            downloadBlob(result.blob, filename);
            return { filename, size: result.blob?.size || 0 };
        }

        // Non-streamed formats on oversized workspace layers cannot materialize.
        if (
            isWorkspaceLayer(dataset)
            && getLayerFeatureCount(dataset) > MAX_MATERIALIZE_FEATURES
            && !['geojson', 'csv'].includes(format)
        ) {
            throw new Error(
                `"${dataset.name}" has ${getLayerFeatureCount(dataset).toLocaleString()} features — `
                + `export as GeoJSON or CSV (streamed). Other formats are limited to `
                + `${MAX_MATERIALIZE_FEATURES.toLocaleString()} features.`
            );
        }

        // Workspace layers keep only the viewport packet (or nothing, when
        // tiled) in layer.geojson — load the full layer from the store before
        // running any non-streamed exporter.
        if (isWorkspaceLayer(dataset)) {
            t.updateProgress(15, 'Loading full layer...');
            dataset = await materializeWorkspaceDatasetForExport(dataset, t);
        }

        // Apply field selection if not photo export
        let exportData = dataset;
        if (!options.skipFieldSelection) {
            exportData = applyFieldSelectionToDataset(dataset);
        }

        // For text-based formats, flatten attachment objects to filenames
        if (['csv', 'xlsx', 'shapefile'].includes(format)) {
            exportData = _flattenAttachments(exportData);
        }

        t.updateProgress(30, `Generating ${format}...`);
        const result = await exp.fn(exportData, options, t);

        logger.info('Exporter', 'Export complete', {
            format,
            name: dataset.name,
            size: result.blob?.size || result.text?.length
        });

        // Trigger download
        const filename = (options.filename || dataset.name || 'export') + exp.ext;
        downloadBlob(result.blob || new Blob([result.text], { type: result.mimeType || 'application/octet-stream' }), filename);

        return { filename, size: result.blob?.size || result.text?.length };
    });
}

function applyFieldSelectionToDataset(dataset) {
    if (isWorkspaceLayer(dataset)) {
        return dataset;
    }
    if (dataset.type === 'spatial' && dataset.geojson?.features) {
        const fc = {
            type: 'FeatureCollection',
            features: applyFieldSelection(dataset.geojson.features, dataset.schema)
        };
        return { ...dataset, geojson: fc };
    }
    if (!dataset.rows) return dataset;
    // Table
    const selected = getSelectedFields(dataset.schema);
    const fieldNames = selected.map(f => f.name);
    const outputNames = selected.map(f => f.outputName);
    const rows = dataset.rows.map(r => {
        const row = {};
        fieldNames.forEach((f, i) => { row[outputNames[i]] = r[f] ?? null; });
        return row;
    });
    return { ...dataset, rows };
}

/**
 * Flatten attachment objects to plain filenames for text-based exports (CSV, Excel, Shapefile).
 */
function _flattenAttachments(dataset) {
    const _flatten = (props) => {
        const out = { ...props };
        for (const k of Object.keys(out)) {
            if (out[k] && typeof out[k] === 'object' && out[k]._att) {
                out[k] = out[k].name || '[attachment]';
            }
        }
        return out;
    };
    if (dataset.geojson?.features && !dataset.rows) {
        const fc = {
            type: 'FeatureCollection',
            features: dataset.geojson.features.map(f => ({
                ...f,
                properties: _flatten(f.properties || {})
            }))
        };
        return { ...dataset, geojson: fc };
    }
    if (dataset.rows) {
        return { ...dataset, rows: dataset.rows.map(r => _flatten(r)) };
    }
    return dataset;
}

/**
 * Materialize any workspace-backed layers in a multi-layer export list so the
 * KML/KMZ builders see full features instead of the viewport packet.
 * @param {Array<{dataset, style}>} layers
 * @param {object} [task]
 */
async function _materializeLayersForExport(layers, task) {
    const out = [];
    for (const entry of layers) {
        const { dataset } = entry;
        if (!isWorkspaceLayer(dataset)) {
            out.push(entry);
            continue;
        }
        const count = getLayerFeatureCount(dataset);
        if (count > MAX_MATERIALIZE_FEATURES) {
            throw new Error(
                `"${dataset.name}" has ${count.toLocaleString()} features — multi-layer export is `
                + `limited to ${MAX_MATERIALIZE_FEATURES.toLocaleString()} features per layer. `
                + 'Export that layer individually as GeoJSON or CSV.'
            );
        }
        out.push({ ...entry, dataset: await materializeWorkspaceDatasetForExport(dataset, task) });
    }
    return out;
}

/**
 * Export multiple layers as a single multi-folder KMZ.
 * @param {Array<{dataset, style}>} layers - { dataset, style } per layer
 * @param {object} options - { filename }
 */
export async function exportMultiLayerKMZFile(layers, options = {}) {
    logger.info('Exporter', 'Starting multi-layer KMZ export', { layers: layers.length });
    const task = new TaskRunner('Export Multi-Layer KMZ', 'Exporter');
    return task.run(async (t) => {
        t.updateProgress(10, 'Preparing layers...');
        layers = await _materializeLayersForExport(layers, t);

        const coverageLayers = layers.filter(({ dataset }) => isCoverageRasterLayer(dataset));
        const vectorLayers = layers.filter(({ dataset }) => !isCoverageRasterLayer(dataset));

        let result;
        if (coverageLayers.length) {
            result = await exportMixedCoverageMultiLayerKMZ(coverageLayers, vectorLayers, options, t);
        } else {
            result = await exportMultiLayerKMZ(layers, options, t);
        }

        logger.info('Exporter', 'Multi-layer KMZ export complete', {
            layers: layers.length, size: result.blob?.size
        });

        const filename = (options.filename || 'export') + '.kmz';
        downloadBlob(result.blob, filename);
        return { filename, size: result.blob?.size };
    });
}

/**
 * Export multiple layers as one multi-folder KML document.
 * @param {Array<{dataset, style}>} layers
 * @param {object} options - { filename }
 */
export async function exportMultiLayerKMLFile(layers, options = {}) {
    logger.info('Exporter', 'Starting multi-layer KML export', { layers: layers.length });
    const task = new TaskRunner('Export Multi-Layer KML', 'Exporter');
    return task.run(async (t) => {
        t.updateProgress(10, 'Preparing layers...');
        layers = await _materializeLayersForExport(layers, t);
        const result = await exportMultiLayerKML(layers, options, t);

        logger.info('Exporter', 'Multi-layer KML export complete', {
            layers: layers.length, size: result.text?.length
        });

        const filename = (options.filename || 'export') + '.kml';
        downloadBlob(new Blob([result.text], { type: result.mimeType || 'application/vnd.google-earth.kml+xml' }), filename);
        return { filename, size: result.text?.length };
    });
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

export default { getAvailableFormats, exportDataset, exportMultiLayerKMZFile, exportMultiLayerKMLFile, downloadBlob };
