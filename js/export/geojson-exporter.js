/**
 * GeoJSON exporter — supports workspace-backed layers via streamed path.
 */
import { withBakedSimpleStyle } from './style-baker.js';
import { isWorkspaceLayer } from '../core/data-model.js';

const EXPORT_BATCH_SIZE = 500;

function _cleanFeatureProperties(styled, layerStyle) {
    return Object.fromEntries(
        Object.entries(styled.properties || {}).filter(([k]) => {
            if (k === '_thumbnailDataUrl') return true;
            // Stable workspace identity — kept for export restoration / reimport.
            if (k === '__lgid') return true;
            return !k.startsWith('_');
        }).map(([k, v]) => [k === '_thumbnailDataUrl' ? 'photo' : k, v])
    );
}

function _mapFeatureForExport(f, layerStyle) {
    const styled = layerStyle ? withBakedSimpleStyle(f, layerStyle) : f;
    return {
        ...styled,
        properties: _cleanFeatureProperties(styled, layerStyle)
    };
}

export async function exportGeoJSON(dataset, options = {}, task) {
    const layerStyle = options.style || null;

    // Workspace layers are routed through stream-export-service by exporter.js.
    // Keep a thin fallback for direct callers.
    if (isWorkspaceLayer(dataset)) {
        const { exportWorkspaceLayerStreamed } = await import('./stream-export-service.js');
        return exportWorkspaceLayerStreamed(dataset, 'geojson', { ...options, style: layerStyle }, task);
    }

    const source = dataset.geojson || {
        type: 'FeatureCollection',
        features: (dataset.rows || []).map(r => ({
            type: 'Feature', geometry: null, properties: r
        }))
    };

    const featureCount = source.features?.length || 0;
    if (featureCount > EXPORT_BATCH_SIZE && !options.minify) {
        const parts = ['{\n  "type": "FeatureCollection",\n  "features": [\n'];
        for (let i = 0; i < featureCount; i++) {
            const out = _mapFeatureForExport(source.features[i], layerStyle);
            parts.push(i === 0 ? '    ' : ',\n    ', JSON.stringify(out));
            if (i % EXPORT_BATCH_SIZE === 0) {
                task?.updateProgress(30 + Math.round((i / featureCount) * 55), `Exporting… ${i.toLocaleString()}/${featureCount.toLocaleString()}`);
                await new Promise((r) => setTimeout(r, 0));
            }
        }
        parts.push('\n  ]\n}');
        task?.updateProgress(90, 'Done');
        return { text: parts.join(''), mimeType: 'application/geo+json' };
    }

    const geojson = {
        ...source,
        features: source.features.map((f) => _mapFeatureForExport(f, layerStyle))
    };

    const text = JSON.stringify(geojson, null, options.minify ? 0 : 2);
    task?.updateProgress(90, 'Done');
    return { text, mimeType: 'application/geo+json' };
}

export default { exportGeoJSON };
