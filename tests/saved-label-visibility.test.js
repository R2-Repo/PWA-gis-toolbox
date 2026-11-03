import { describe, expect, it } from 'vitest';
import { prepareLayersFromKitSection } from '../js/core/layer-restore.js';
import { serializeLayerForPersistence } from '../js/core/session-store.js';
import { normalizeStyle } from '../js/map/style-engine.js';
import {
    buildMapLabelLayerSpec,
    resolveEffectiveLabelZoomRange,
    resolveLayerLabels
} from '../js/map/map-labels.js';
import { resolveMapLibreZoomRange } from '../js/map/scale-range.js';

const SAVED_LABELS = {
    enabled: true,
    field: 'NAME',
    placement: 'point',
    minZoom: 13,
    maxZoom: 19,
    size: 14,
    color: '#222222'
};

const layersSection = {
    activeLayerId: 'parcels',
    index: [{
        id: 'parcels',
        name: 'Parcels',
        type: 'spatial',
        visible: true,
        created: '2024-01-01T00:00:00.000Z',
        scaleRangeEnabled: true,
        minScale: 250000,
        maxScale: 5000,
        source: { file: 'parcels.geojson', format: 'geojson' }
    }],
    spatial: {
        parcels: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { NAME: 'Block A' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
                }
            }]
        }
    },
    styles: {
        parcels: {
            mode: 'simple',
            strokeColor: '#336699',
            labels: { ...SAVED_LABELS }
        }
    }
};

describe('saved label zoom and layer visibility', () => {
    it('loads an existing project and applies label zoom inside the layer scale range', async () => {
        const { datasets, styles } = await prepareLayersFromKitSection({ layersSection });
        const dataset = datasets[0];
        const style = normalizeStyle(styles.parcels);

        expect(dataset.scaleRangeEnabled).toBe(true);
        expect(dataset.minScale).toBe(250000);
        expect(dataset.maxScale).toBe(5000);
        expect(style.labels).toMatchObject(SAVED_LABELS);

        const persisted = serializeLayerForPersistence(dataset);
        expect(persisted.scaleRangeEnabled).toBe(true);
        expect(persisted.minScale).toBe(250000);
        expect(persisted.maxScale).toBe(5000);
        expect(persisted.labels).toBeUndefined();

        const labels = resolveLayerLabels(style, dataset);
        const spec = buildMapLabelLayerSpec(dataset.id, 'src-parcels', labels, false);
        expect(spec.minzoom).toBe(13);
        expect(spec.maxzoom).toBe(19);

        const layerZoom = resolveMapLibreZoomRange(dataset, 40);
        expect(layerZoom.minzoom).toBeGreaterThan(0);
        expect(layerZoom.maxzoom).toBeGreaterThan(layerZoom.minzoom);
        const effective = resolveEffectiveLabelZoomRange(style.labels, layerZoom);
        expect(effective.minzoom).toBe(Math.max(13, layerZoom.minzoom));
        expect(effective.maxzoom).toBe(Math.min(19, layerZoom.maxzoom));
    });
});
