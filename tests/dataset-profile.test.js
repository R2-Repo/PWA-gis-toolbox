import { describe, it, expect } from 'vitest';
import {
    countGeometryCoordinates,
    expandBboxWithGeometry,
    buildDatasetProfileFromFeatures,
    buildProfilePressures,
    profileForGeometryClass,
    profileSuggestsTiledDisplay,
    createProfileAccumulator,
    observeFeatureForProfile,
    finalizeDatasetProfile,
    DATASET_PROFILE_VERSION
} from '../js/import/dataset-profile.js';

describe('dataset-profile', () => {
    it('counts coordinates for points, lines, and polygons', () => {
        expect(countGeometryCoordinates({ type: 'Point', coordinates: [-111, 40] })).toBe(1);
        expect(countGeometryCoordinates({
            type: 'LineString',
            coordinates: [[0, 0], [1, 1], [2, 2]]
        })).toBe(3);
        expect(countGeometryCoordinates({
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
        })).toBe(5);
    });

    it('expands bbox across features', () => {
        let bbox = null;
        bbox = expandBboxWithGeometry(bbox, { type: 'Point', coordinates: [-112, 39] });
        bbox = expandBboxWithGeometry(bbox, { type: 'Point', coordinates: [-110, 41] });
        expect(bbox).toEqual([-112, 39, -110, 41]);
    });

    it('builds a profile from features with separate pressures', () => {
        const features = [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-111, 40] }, properties: { a: 1 } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-111.1, 40.1] }, properties: { a: 2 } },
            {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: Array.from({ length: 50 }, (_, i) => [i, i])
                },
                properties: { a: 3 }
            }
        ];
        const profile = buildDatasetProfileFromFeatures(features, {
            importMethod: 'standard',
            format: 'geojson',
            fileSize: 5_000_000,
            fieldCount: 12
        });
        expect(profile.version).toBe(DATASET_PROFILE_VERSION);
        expect(profile.featureCount).toBe(3);
        expect(profile.coordCount).toBe(52);
        expect(profile.geometryClassCounts.point).toBe(2);
        expect(profile.geometryClassCounts.line).toBe(1);
        expect(profile.pressures.feature).toBe('low');
        expect(profile.pressures.attribute).toBe('low');
        expect(profile.import.method).toBe('standard');
        expect(Array.isArray(profile.bbox)).toBe(true);
    });

    it('labels high feature / geometry pressure without a single score', () => {
        const pressures = buildProfilePressures({
            featureCount: 300_000,
            avgCoordsPerFeature: 100,
            coordCount: 3_000_000,
            fieldCount: 90,
            fileSize: 250 * 1024 * 1024
        });
        expect(pressures.feature).toBe('high');
        expect(pressures.geometry).toBe('high');
        expect(pressures.attribute).toBe('high');
        expect(pressures.storage).toBe('high');
    });

    it('slices global stats into a geometry-class profile', () => {
        const profile = profileForGeometryClass({
            featureCount: 100,
            coordCount: 1000,
            maxCoordsInFeature: 50,
            bbox: [-1, -1, 1, 1],
            geometryTypes: ['Point', 'LineString']
        }, 'point', 40, {
            importMethod: 'stream',
            format: 'geojson',
            fileSize: 8_000_000,
            fieldCount: 5
        });
        expect(profile.featureCount).toBe(40);
        expect(profile.coordCount).toBe(400);
        expect(profile.geometryClassCounts.point).toBe(40);
        expect(profile.import.method).toBe('stream');
    });

    it('suggests tiled display for dense moderate layers', () => {
        expect(profileSuggestsTiledDisplay({ datasetProfile: null }, 60_000)).toBe(true);
        expect(profileSuggestsTiledDisplay({
            datasetProfile: {
                coordCount: 100,
                avgCoordsPerFeature: 2,
                pressures: { geometry: 'low' }
            }
        }, 20_000)).toBe(false);
        expect(profileSuggestsTiledDisplay({
            datasetProfile: {
                coordCount: 900_000,
                avgCoordsPerFeature: 45,
                pressures: { geometry: 'moderate' }
            }
        }, 20_000)).toBe(true);
    });

    it('accumulates via observe helpers', () => {
        const acc = createProfileAccumulator();
        observeFeatureForProfile(acc, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {}
        });
        const profile = finalizeDatasetProfile(acc, { importMethod: 'stream', format: 'csv' });
        expect(profile.featureCount).toBe(1);
        expect(profile.coordCount).toBe(1);
    });
});
