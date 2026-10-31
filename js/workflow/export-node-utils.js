/**
 * Export workflow node — format resolution, filename defaults, empty checks.
 */
import { getAvailableFormats } from '../export/exporter.js';
import { getLayerFeatureCount } from '../core/data-model.js';

export function describeInputKind(dataset) {
    if (!dataset) return 'dataset';
    const isSpatial = (dataset.type === 'spatial'
        || dataset.type === 'spatial-chunked'
        || dataset.storage === 'workspace')
        && dataset.schema?.geometryType;
    return isSpatial ? 'spatial' : 'table';
}

export function pickDefaultExportFormatKey(dataset) {
    const formats = getAvailableFormats(dataset);
    if (!formats.length) return 'geojson';
    const prefer = describeInputKind(dataset) === 'table' ? 'csv' : 'geojson';
    if (formats.some((f) => f.key === prefer)) return prefer;
    return formats[0].key;
}

export function formatAvailableForDataset(dataset, format) {
    if (!format) return false;
    return getAvailableFormats(dataset).some((f) => f.key === format);
}

export function formatMismatchMessage(format, dataset) {
    const kind = describeInputKind(dataset);
    const labels = getAvailableFormats(dataset).map((f) => f.label);
    const hint = labels.length ? labels.join(', ') : 'none';
    return `Format "${format}" is not available for ${kind} data. Available formats: ${hint}.`;
}

export function isExportInputEmpty(dataset) {
    if (!dataset) return true;
    const counted = getLayerFeatureCount(dataset);
    if (counted > 0) return false;
    if (dataset.type === 'spatial' || dataset.type === 'spatial-chunked') {
        return !(dataset.geojson?.features?.length);
    }
    if (dataset.type === 'table') {
        return !(dataset.rows?.length);
    }
    if (dataset.storage === 'workspace') {
        return counted === 0;
    }
    return true;
}

/** Base filename without extension (exporter appends format extension). */
export function resolveExportFilenameBase(dataset, config = {}) {
    const configured = String(config.filename ?? '').trim();
    if (configured) {
        return configured.replace(/\.[^./\\]+$/, '');
    }
    const fromName = String(dataset?.name ?? 'export').trim() || 'export';
    return fromName.replace(/\.[^./\\]+$/, '');
}

export function buildExportOptions(dataset, config = {}) {
    const options = {
        filename: resolveExportFilenameBase(dataset, config)
    };
    const format = config.format;
    if (format === 'shapefile' || config.targetCrs) {
        options.targetCrs = config.targetCrs || dataset?.schema?.crs || 'EPSG:4326';
        if (dataset?.schema?.crs) {
            options.sourceCrs = dataset.schema.crs;
        }
    }
    return options;
}

export function getFormatLabel(formatKey, dataset) {
    const match = getAvailableFormats(dataset).find((f) => f.key === formatKey);
    return match?.label || formatKey;
}
