/**
 * CSV exporter using PapaParse
 * Supports lat/lon columns for points, optional WKT column
 */
import { loadPapaParse } from '../core/libs.js';
import { isWorkspaceLayer } from '../core/data-model.js';

export async function exportCSV(dataset, options = {}, task) {
    // Workspace layers are routed through stream-export-service by exporter.js.
    if (isWorkspaceLayer(dataset)) {
        const { exportWorkspaceLayerStreamed } = await import('./stream-export-service.js');
        return exportWorkspaceLayerStreamed(dataset, 'csv', options, task);
    }

    const rows = getRowsForCSV(dataset, options);
    const papa = await loadPapaParse().catch(() => null);
    if (!papa?.unparse) {
        // Fallback: manual CSV
        const text = manualCSV(rows);
        task?.updateProgress(90);
        return { text, mimeType: 'text/csv' };
    }
    const text = papa.unparse(rows);
    task?.updateProgress(90, 'Done');
    return { text, mimeType: 'text/csv' };
}

function getRowsForCSV(dataset, options) {
    let rows;
    if (dataset.type === 'spatial' && dataset.geojson?.features) {
        rows = dataset.geojson.features.map(f => {
            const row = { ...f.properties };
            // Add lat/lon for points
            if (options.includeLatLon !== false && f.geometry?.type === 'Point') {
                row.longitude = f.geometry.coordinates[0];
                row.latitude = f.geometry.coordinates[1];
            }
            // Add WKT column
            if (options.includeWKT && f.geometry) {
                row.WKT = geometryToWKT(f.geometry);
            }
            return row;
        });
    } else if (dataset.rows) {
        rows = dataset.rows;
    } else {
        rows = [];
    }
    return rows;
}

function geometryToWKT(geom) {
    if (!geom) return '';
    switch (geom.type) {
        case 'Point':
            return `POINT (${geom.coordinates[0]} ${geom.coordinates[1]})`;
        case 'MultiPoint':
            return `MULTIPOINT (${geom.coordinates.map(c => `(${c[0]} ${c[1]})`).join(', ')})`;
        case 'LineString':
            return `LINESTRING (${geom.coordinates.map(c => `${c[0]} ${c[1]}`).join(', ')})`;
        case 'MultiLineString':
            return `MULTILINESTRING (${geom.coordinates.map(ring => `(${ring.map(c => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`;
        case 'Polygon':
            return `POLYGON (${geom.coordinates.map(ring => `(${ring.map(c => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`;
        case 'MultiPolygon':
            return `MULTIPOLYGON (${geom.coordinates.map(poly => `(${poly.map(ring => `(${ring.map(c => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`).join(', ')})`;
        default:
            return '';
    }
}

function manualCSV(rows) {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = v => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\n');
}
