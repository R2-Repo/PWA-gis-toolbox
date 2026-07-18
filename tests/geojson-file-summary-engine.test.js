import { describe, expect, it } from 'vitest';
import {
    basenameFromPath,
    formatByteSize,
    formatSummaryResult,
    validateGeoJsonPath
} from '../js/widgets/geojson-file-summary/engine.js';
import { createWebPlatform } from '../js/platform/web/web-platform.js';
import { hasRequiredCapabilities } from '../js/platform/contracts.js';

describe('geojson-file-summary engine', () => {
    it('validates geojson paths', () => {
        expect(validateGeoJsonPath('').ok).toBe(false);
        expect(validateGeoJsonPath('C:\\data\\layer.geojson').ok).toBe(true);
        expect(validateGeoJsonPath('/tmp/layer.json').ok).toBe(true);
        expect(validateGeoJsonPath('/tmp/layer.txt').ok).toBe(false);
    });

    it('formats sidecar output for the dialog', () => {
        const formatted = formatSummaryResult({
            path: 'C:\\data\\roads.geojson',
            rootType: 'FeatureCollection',
            featureCount: 3,
            geometryTypes: { LineString: 2, Point: 1 },
            propertyKeys: ['name', 'id'],
            byteSize: 2048
        });
        expect(formatted.featureCount).toBe(3);
        expect(formatted.geometryTypeEntries[0]).toEqual({ type: 'LineString', count: 2 });
        expect(formatByteSize(formatted.byteSize)).toBe('2.0 KB');
        expect(basenameFromPath(formatted.path)).toBe('roads.geojson');
    });

    it('is hidden on the web runtime via required capabilities', () => {
        const { platform } = createWebPlatform();
        expect(hasRequiredCapabilities(platform, ['pythonCompute', 'nativeFiles'])).toBe(false);
    });
});
