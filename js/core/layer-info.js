/**
 * Read-only layer summary rows for the Data Preview panel.
 */
import { getLayerFeatureCount, isSpatialLayer, isWorkspaceLayer, isServiceLayer, isLiveVectorLayer } from './data-model.js';
import { resolveLayerDisplayMode } from '../map/layer-display-mode.js';
import { getLayerCrs, isLayerDisplayReady, layerCrsWarning } from '../crs/layer-crs.js';
import { crsLabel } from '../crs/registry.js';
import { formatBytes } from '../import/import-preflight.js';

const FORMAT_LABELS = {
    geojson: 'GeoJSON',
    json: 'JSON',
    csv: 'CSV',
    tsv: 'TSV',
    txt: 'Text',
    xlsx: 'Excel',
    xls: 'Excel',
    kml: 'KML',
    kmz: 'KMZ',
    zip: 'Shapefile (ZIP)',
    xml: 'XML',
    workflow: 'Workflow',
    draw: 'Draw',
    merge: 'Merge',
    'toolbox-kit': 'Toolbox Kit',
    photo: 'Photo Mapper',
    unknown: 'Unknown'
};

function humanizeFormat(format) {
    if (!format) return '—';
    const key = String(format).toLowerCase();
    return FORMAT_LABELS[key] || format;
}

function formatCreated(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
}

function formatSource(layer) {
    const file = layer.source?.file;
    const format = humanizeFormat(layer.source?.format);
    if (file && format && format !== '—') return `${file} (${format})`;
    if (file) return file;
    if (format && format !== '—') return format;
    return '—';
}

/**
 * @param {object|null|undefined} layer
 * @returns {{ id: string, label: string, value: string, warning?: string }[]}
 */
export function getLayerInfoSummary(layer) {
    if (!layer) return [];

    const rows = [];
    const spatial = isSpatialLayer(layer);
    const service = isServiceLayer(layer);
    const liveVector = isLiveVectorLayer(layer);
    const count = getLayerFeatureCount(layer);
    const fieldCount = layer.schema?.fields?.length ?? 0;

    rows.push({
        id: 'type',
        label: 'Type',
        value: service ? `Live service (${layer.service?.kind || 'unknown'})` : spatial ? 'Spatial layer' : 'Table'
    });

    if (service) {
        rows.push({
            id: 'serviceUrl',
            label: 'Service URL',
            value: layer.service?.url || '—'
        });
        rows.push({
            id: 'refresh',
            label: 'Refresh',
            value: layer.service?.refreshMs ? `${Math.round(layer.service.refreshMs / 1000)}s` : '—'
        });
        if (liveVector) {
            rows.push({
                id: 'records',
                label: 'Features in view',
                value: count.toLocaleString(),
                warning: layer._viewportTruncated
                    ? 'Viewport capped at render limits — zoom in for denser areas'
                    : 'Updates as the map pans and zooms'
            });
            rows.push({
                id: 'fields',
                label: 'Fields',
                value: String(fieldCount)
            });
            if (layer.schema?.geometryType) {
                rows.push({
                    id: 'geometry',
                    label: 'Geometry',
                    value: layer.schema.geometryType
                });
            }
        }
    } else {
        rows.push({
            id: 'records',
            label: spatial ? 'Features' : 'Rows',
            value: count.toLocaleString()
        });

        rows.push({
            id: 'fields',
            label: 'Fields',
            value: String(fieldCount)
        });
    }

    if (!service && spatial && layer.schema?.geometryType) {
        rows.push({
            id: 'geometry',
            label: 'Geometry',
            value: layer.schema.geometryType
        });
    }

    if (!service && spatial) {
        const crs = getLayerCrs(layer);
        const crsWarning = layerCrsWarning(layer);
        rows.push({
            id: 'crs',
            label: 'CRS',
            value: crsLabel(crs),
            warning: !isLayerDisplayReady(layer) && crsWarning ? crsWarning : undefined
        });
    }

    rows.push({
        id: 'source',
        label: 'Source',
        value: service ? (layer.service?.url || 'Live service') : formatSource(layer)
    });

    if (layer.source?.fileSize > 0) {
        rows.push({
            id: 'sourceSize',
            label: 'Source size',
            value: formatBytes(layer.source.fileSize)
        });
    }

    const created = formatCreated(layer.created);
    if (created) {
        rows.push({
            id: 'added',
            label: 'Added',
            value: created
        });
    }

    if (!service && spatial) {
        rows.push({
            id: 'storage',
            label: 'Storage',
            value: isWorkspaceLayer(layer) ? 'Workspace (IndexedDB)' : 'In memory'
        });
    }

    if (!service && isWorkspaceLayer(layer)) {
        const display = resolveLayerDisplayMode(layer, null);
        if (display) {
            rows.push({
                id: 'displayMode',
                label: 'Map display',
                value: display.shortLabel,
                warning: display.summary
            });
        }
    }

    return rows;
}

export default { getLayerInfoSummary };
