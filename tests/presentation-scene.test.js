import { describe, expect, it } from 'vitest';
import { createDefaultScene, compactScene, expandScene, resolvePresentationMapInit, resolvePresentationCameraOverrides } from '../js/presentation/presentation-scene-schema.js';
import { encodeScene, decodeScene, buildPresentationUrl } from '../js/presentation/presentation-scene-codec.js';
import { validatePresentationScene, summarizeFeatures, countVertices } from '../js/presentation/scene-validation.js';
import { detectPresentationMode } from '../js/presentation/presentation-mode-detector.js';

const sampleFeatures = {
    type: 'FeatureCollection',
    features: [{
        type: 'Feature',
        properties: { name: 'Site A' },
        geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
    }]
};

describe('presentation scene codec', () => {
    it('round-trips a compact scene through base64url encoding', () => {
        const scene = createDefaultScene({
            features: sampleFeatures,
            animations: [{
                id: 'step-1',
                type: 'flyToFeature',
                durationMs: 2000,
                delayMs: 0,
                easing: 'easeInOut',
                target: 'allFeatures'
            }]
        });
        const encoded = encodeScene(scene);
        const decoded = decodeScene(encoded);
        expect(decoded.version).toBe(scene.version);
        expect(decoded.mode).toBe('present');
        expect(decoded.features.features).toHaveLength(1);
        expect(decoded.animations[0].type).toBe('flyToFeature');
    });

    it('builds a presentation URL with mode and scene params', () => {
        const scene = createDefaultScene({ features: sampleFeatures });
        const url = buildPresentationUrl(scene);
        expect(url).toContain('mode=present');
        expect(url).toContain('scene=');
    });

    it('expands compact keys into a full scene object', () => {
        const scene = createDefaultScene({
            features: sampleFeatures,
            mapView: { basemap: 'satellite', enable3D: true }
        });
        const compact = compactScene(scene);
        const expanded = expandScene(compact);
        expect(expanded.layout.showLogo).toBe(true);
        expect(expanded.features.features[0].geometry.type).toBe('Point');
        expect(expanded.mapView.basemap).toBe('satellite');
        expect(expanded.mapView.enable3D).toBe(true);
    });

    it('derives map init options from a saved camera', () => {
        const scene = createDefaultScene({
            camera: {
                useCurrent: false,
                fitToFeatures: false,
                center: [-122.4, 37.8],
                zoom: 16,
                pitch: 60,
                bearing: 45
            },
            mapView: { basemap: 'satellite', enable3D: true }
        });
        const init = resolvePresentationMapInit(scene);
        expect(init).toEqual({
            basemap: 'satellite',
            center: [-122.4, 37.8],
            zoom: 16,
            pitch: 60,
            bearing: 45,
            enable3D: true
        });
        expect(resolvePresentationCameraOverrides(scene.camera)).toEqual({
            center: [-122.4, 37.8],
            zoom: 16,
            pitch: 60,
            bearing: 45
        });
    });
});

describe('presentation scene validation', () => {
    it('counts vertices for nested coordinates', () => {
        expect(countVertices([1, 2])).toBe(1);
        expect(countVertices([[1, 2], [3, 4]])).toBe(2);
    });

    it('accepts small feature collections', () => {
        const result = validatePresentationScene(createDefaultScene({ features: sampleFeatures }));
        expect(result.ok).toBe(true);
        expect(result.summary.featureCount).toBe(1);
    });

    it('rejects oversized feature collections', () => {
        const many = {
            type: 'FeatureCollection',
            features: Array.from({ length: 30 }, (_, i) => ({
                type: 'Feature',
                properties: { id: i },
                geometry: { type: 'Point', coordinates: [-111 + i * 0.01, 40.7] }
            }))
        };
        const result = validatePresentationScene(createDefaultScene({ features: many }));
        expect(result.ok).toBe(false);
        expect(result.errors.some((msg) => msg.includes('Too many features'))).toBe(true);
    });

    it('summarizes geometry types', () => {
        const summary = summarizeFeatures(sampleFeatures);
        expect(summary.geometryTypes).toEqual(['Point']);
        expect(summary.vertexCount).toBe(1);
    });
});

describe('presentation mode detector', () => {
    it('detects presentation mode from URL search params', () => {
        const scene = createDefaultScene({ features: sampleFeatures });
        const encoded = encodeScene(scene);
        const state = detectPresentationMode(`?mode=present&scene=${encoded}`);
        expect(state.isPresentationMode).toBe(true);
        expect(state.scene?.features.features).toHaveLength(1);
        expect(state.errors).toEqual([]);
    });

    it('returns normal mode when params are absent', () => {
        const state = detectPresentationMode('');
        expect(state.isPresentationMode).toBe(false);
    });

    it('returns errors for invalid scene payloads', () => {
        const state = detectPresentationMode('?mode=present&scene=not-valid');
        expect(state.isPresentationMode).toBe(true);
        expect(state.scene).toBeNull();
        expect(state.errors.length).toBeGreaterThan(0);
    });
});
