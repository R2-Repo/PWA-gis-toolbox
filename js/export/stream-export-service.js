/**
 * Streamed workspace export — batch-read IndexedDB chunks, join cold attrs,
 * write GeoJSON/CSV incrementally via OPFS staging (Blob fallback).
 */
import { isWorkspaceLayer, getLayerFeatureCount, getSelectedFields } from '../core/data-model.js';
import { iterateWorkspaceFeatures } from '../workspace/workspace-store.js';
import { createExportStagingSession } from '../workspace/export-staging-store.js';
import { LGID_PROP, isInternalFeatureProp } from '../workspace/feature-identity.js';
import { withBakedSimpleStyle } from './style-baker.js';
import { loadPapaParse } from '../core/libs.js';

export const STREAM_EXPORT_BATCH_SIZE = 500;

/** Formats supported by the streamed workspace path in Build 5. */
export const STREAM_EXPORT_FORMATS = new Set(['geojson', 'csv']);

/**
 * @param {object} dataset
 * @param {string} format
 * @returns {boolean}
 */
export function shouldUseStreamExport(dataset, format) {
    return isWorkspaceLayer(dataset) && STREAM_EXPORT_FORMATS.has(format);
}

function _cleanExportProperties(properties, { keepLgid = true, selectedNames = null } = {}) {
    const out = {};
    for (const [k, v] of Object.entries(properties || {})) {
        if (k === LGID_PROP) {
            if (keepLgid) out[LGID_PROP] = v;
            continue;
        }
        if (isInternalFeatureProp(k)) continue;
        if (selectedNames && !selectedNames.has(k)) continue;
        out[k] = v;
    }
    return out;
}

function _selectedNameSet(dataset) {
    const selected = getSelectedFields(dataset?.schema);
    if (!selected?.length) return null;
    // If every field is selected, skip filtering (also exports cold-only fields).
    const all = dataset.schema?.fields || [];
    if (all.length && selected.length >= all.length) return null;
    return new Set(selected.map((f) => f.name));
}

function _mapGeoJSONFeature(feature, layerStyle, selectedNames) {
    const styled = layerStyle ? withBakedSimpleStyle(feature, layerStyle) : feature;
    const props = _cleanExportProperties(styled.properties, {
        keepLgid: true,
        selectedNames
    });
    // Preserve photo alias used by the standard GeoJSON exporter.
    if (styled.properties?._thumbnailDataUrl && (!selectedNames || selectedNames.has('_thumbnailDataUrl'))) {
        props.photo = styled.properties._thumbnailDataUrl;
    }
    return {
        type: 'Feature',
        geometry: styled.geometry,
        properties: props
    };
}

function geometryToWKT(geom) {
    if (!geom) return '';
    switch (geom.type) {
        case 'Point':
            return `POINT (${geom.coordinates[0]} ${geom.coordinates[1]})`;
        case 'MultiPoint':
            return `MULTIPOINT (${geom.coordinates.map((c) => `(${c[0]} ${c[1]})`).join(', ')})`;
        case 'LineString':
            return `LINESTRING (${geom.coordinates.map((c) => `${c[0]} ${c[1]}`).join(', ')})`;
        case 'MultiLineString':
            return `MULTILINESTRING (${geom.coordinates.map((ring) => `(${ring.map((c) => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`;
        case 'Polygon':
            return `POLYGON (${geom.coordinates.map((ring) => `(${ring.map((c) => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`;
        case 'MultiPolygon':
            return `MULTIPOLYGON (${geom.coordinates.map((poly) => `(${poly.map((ring) => `(${ring.map((c) => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`).join(', ')})`;
        default:
            return '';
    }
}

function _escapeCsv(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        try { return _escapeCsv(JSON.stringify(value)); } catch { return ''; }
    }
    const s = String(value);
    return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
}

/**
 * Load the full feature set of a workspace layer into memory for the
 * non-streamed exporters (KML/KMZ/Shapefile/Excel/JSON/GPX). Mirrors the
 * streamed-export property contract: internal props stripped, __lgid kept,
 * field selection respected, cold (detached) attributes joined.
 * Callers must enforce MAX_MATERIALIZE_FEATURES before invoking.
 * @param {object} dataset workspace layer handle
 * @param {object} [task]
 * @returns {Promise<{type: 'FeatureCollection', features: object[]}>}
 */
export async function materializeWorkspaceGeoJSON(dataset, task) {
    const layerId = dataset.workspaceLayerId || dataset.id;
    const total = getLayerFeatureCount(dataset) || 0;
    const selectedNames = _selectedNameSet(dataset);
    const features = [];
    let offset = 0;
    while (true) {
        const batch = await iterateWorkspaceFeatures(layerId, offset, STREAM_EXPORT_BATCH_SIZE, {
            includeCold: true
        });
        if (!batch.length) break;
        for (const feature of batch) {
            features.push({
                type: 'Feature',
                geometry: feature.geometry,
                properties: _cleanExportProperties(feature.properties, {
                    keepLgid: true,
                    selectedNames
                })
            });
        }
        offset += batch.length;
        const pct = total > 0 ? Math.round((features.length / total) * 15) : 0;
        task?.updateProgress(10 + Math.min(15, pct), `Loading… ${features.length.toLocaleString()} features`);
        if (batch.length < STREAM_EXPORT_BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, 0));
    }
    return { type: 'FeatureCollection', features };
}

/**
 * Return a copy of a workspace dataset whose `geojson` holds the FULL layer
 * (not the viewport packet). No-op for in-memory datasets. Never mutates the
 * live layer object.
 * @param {object} dataset
 * @param {object} [task]
 */
export async function materializeWorkspaceDatasetForExport(dataset, task) {
    if (!isWorkspaceLayer(dataset)) return dataset;
    const geojson = await materializeWorkspaceGeoJSON(dataset, task);
    return { ...dataset, geojson, _workspaceMaterialized: true };
}

/**
 * @param {object} dataset
 * @param {'geojson'|'csv'} format
 * @param {object} [options]
 * @param {object} [task]
 */
export async function exportWorkspaceLayerStreamed(dataset, format, options = {}, task) {
    if (!shouldUseStreamExport(dataset, format)) {
        throw new Error(`Streamed export does not support format: ${format}`);
    }
    const layerId = dataset.workspaceLayerId || dataset.id;
    const total = getLayerFeatureCount(dataset) || 0;
    const selectedNames = _selectedNameSet(dataset);
    const fileBase = options.filename || dataset.name || 'export';
    const ext = format === 'csv' ? '.csv' : '.geojson';
    const staging = await createExportStagingSession(`${fileBase}${ext}`);

    try {
        if (format === 'geojson') {
            await _writeGeoJSON(staging, layerId, dataset, options, selectedNames, total, task);
        } else {
            await _writeCSV(staging, layerId, options, selectedNames, total, task);
        }
        const { blob } = await staging.finalize();
        const mimeType = format === 'csv' ? 'text/csv' : 'application/geo+json';
        return { blob, mimeType, featureCount: total, staged: staging.supported };
    } catch (err) {
        await staging.abort().catch(() => {});
        throw err;
    }
}

async function _writeGeoJSON(staging, layerId, dataset, options, selectedNames, total, task) {
    const layerStyle = options.style || null;
    const pretty = !options.minify;
    await staging.appendText(pretty
        ? '{\n  "type": "FeatureCollection",\n  "features": [\n'
        : '{"type":"FeatureCollection","features":[');

    let offset = 0;
    let written = 0;
    let first = true;
    while (true) {
        const batch = await iterateWorkspaceFeatures(layerId, offset, STREAM_EXPORT_BATCH_SIZE, {
            includeCold: true
        });
        if (!batch.length) break;
        for (const feature of batch) {
            const out = _mapGeoJSONFeature(feature, layerStyle, selectedNames);
            const json = JSON.stringify(out);
            if (pretty) {
                await staging.appendText(first ? `    ${json}` : `,\n    ${json}`);
            } else {
                await staging.appendText(first ? json : `,${json}`);
            }
            first = false;
            written++;
        }
        offset += batch.length;
        const pct = total > 0 ? Math.round((written / total) * 55) : 0;
        task?.updateProgress(30 + Math.min(55, pct), `Exporting… ${written.toLocaleString()} features`);
        if (batch.length < STREAM_EXPORT_BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, 0));
    }

    await staging.appendText(pretty ? '\n  ]\n}\n' : ']}');
    task?.updateProgress(90, 'Done');
}

async function _writeCSV(staging, layerId, options, selectedNames, total, task) {
    const papa = await loadPapaParse().catch(() => null);
    let headers = null;
    let offset = 0;
    let written = 0;

    while (true) {
        const batch = await iterateWorkspaceFeatures(layerId, offset, STREAM_EXPORT_BATCH_SIZE, {
            includeCold: true
        });
        if (!batch.length) break;

        const rows = batch.map((f) => {
            const row = _cleanExportProperties(f.properties, {
                keepLgid: true,
                selectedNames
            });
            if (options.includeLatLon !== false && f.geometry?.type === 'Point') {
                row.longitude = f.geometry.coordinates[0];
                row.latitude = f.geometry.coordinates[1];
            }
            if (options.includeWKT && f.geometry) {
                row.WKT = geometryToWKT(f.geometry);
            }
            return row;
        });

        if (!headers) {
            const keySet = new Set();
            for (const row of rows) {
                for (const k of Object.keys(row)) keySet.add(k);
            }
            // Stable-ish order: lgid first, then alpha, with lon/lat/WKT last if present.
            headers = [...keySet].sort((a, b) => {
                if (a === LGID_PROP) return -1;
                if (b === LGID_PROP) return 1;
                const tail = new Set(['longitude', 'latitude', 'WKT']);
                if (tail.has(a) && !tail.has(b)) return 1;
                if (tail.has(b) && !tail.has(a)) return -1;
                return a.localeCompare(b);
            });
            if (papa?.unparse) {
                await staging.appendText(papa.unparse({ fields: headers, data: [] }).trimEnd() + '\n');
            } else {
                await staging.appendText(headers.map(_escapeCsv).join(',') + '\n');
            }
        }

        if (papa?.unparse) {
            const body = papa.unparse({ fields: headers, data: rows.map((r) => headers.map((h) => r[h] ?? '')) }, {
                header: false
            });
            await staging.appendText(body.endsWith('\n') ? body : `${body}\n`);
        } else {
            for (const row of rows) {
                await staging.appendText(headers.map((h) => _escapeCsv(row[h])).join(',') + '\n');
            }
        }

        written += rows.length;
        offset += batch.length;
        const pct = total > 0 ? Math.round((written / total) * 55) : 0;
        task?.updateProgress(30 + Math.min(55, pct), `Exporting… ${written.toLocaleString()} features`);
        if (batch.length < STREAM_EXPORT_BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, 0));
    }

    if (!headers) {
        await staging.appendText('');
    }
    task?.updateProgress(90, 'Done');
}

export default {
    STREAM_EXPORT_BATCH_SIZE,
    STREAM_EXPORT_FORMATS,
    shouldUseStreamExport,
    materializeWorkspaceGeoJSON,
    materializeWorkspaceDatasetForExport,
    exportWorkspaceLayerStreamed
};
