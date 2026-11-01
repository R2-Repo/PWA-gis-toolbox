import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    addArcgisPictureMarkerGlyphLayer,
    arcgisPictureMarkerImageIds,
    arcgisPictureMarkerPointLayerParts,
    loadPictureMarker,
    registerPictureMarkers,
    releaseArcgisPictureMarkerImages
} from '../js/arcgis/picture-markers.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function createMockMap() {
    const images = new Set();
    const layers = new Map();
    return {
        images,
        layers,
        hasImage: (id) => images.has(id),
        addImage: (id) => { images.add(id); },
        removeImage: (id) => { images.delete(id); },
        getLayer: (id) => layers.get(id) || null,
        addLayer: (spec) => { layers.set(spec.id, spec); }
    };
}

describe('ArcGIS picture marker map layers', () => {
    beforeEach(() => {
        class FakeImage {
            set src(_v) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal('Image', FakeImage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('registers each marker image once', async () => {
        const map = createMockMap();
        const pack = {
            markers: [
                { imageId: 'arcgis-pms-a', imageData: PNG, contentType: 'image/png' },
                { imageId: 'arcgis-pms-b', imageData: PNG, contentType: 'image/png' }
            ]
        };
        await registerPictureMarkers(map, pack);
        await registerPictureMarkers(map, pack);
        expect(map.images.has('arcgis-pms-a')).toBe(true);
        expect(map.images.has('arcgis-pms-b')).toBe(true);
        expect(map.images.size).toBe(2);
    });

    it('adds glyph symbol layer and circle filter excludes stamped features', () => {
        const map = createMockMap();
        const layerIds = [];
        const pointFilter = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
        const parts = arcgisPictureMarkerPointLayerParts({
            idBase: 'layer-1',
            sourceId: 'src-layer-1',
            pointGeomFilter: pointFilter
        });
        addArcgisPictureMarkerGlyphLayer(map, parts.glyphLayerSpec, layerIds);
        expect(layerIds).toEqual(['layer-1-pms-glyph']);
        expect(map.layers.get('layer-1-pms-glyph')?.layout?.['icon-image']).toEqual(['get', '_udotGlyph']);
        expect(JSON.stringify(parts.circleFilter)).toContain('_udotGlyph');
    });

    it('releases images not retained by other layers', async () => {
        const map = createMockMap();
        const pack = { markers: [{ imageId: 'arcgis-pms-x', imageData: PNG, contentType: 'image/png' }] };
        await loadPictureMarker(map, pack.markers[0]);
        expect(map.hasImage('arcgis-pms-x')).toBe(true);
        releaseArcgisPictureMarkerImages(map, pack, new Set());
        expect(map.hasImage('arcgis-pms-x')).toBe(false);
        await loadPictureMarker(map, pack.markers[0]);
        releaseArcgisPictureMarkerImages(map, pack, arcgisPictureMarkerImageIds(pack));
        expect(map.hasImage('arcgis-pms-x')).toBe(true);
    });
});
