import { describe, expect, it } from 'vitest';
import {
    shouldUseStreamExport,
    STREAM_EXPORT_FORMATS
} from '../js/export/stream-export-service.js';
import { LGID_PROP } from '../js/workspace/feature-identity.js';

describe('stream-export-service', () => {
    it('enables streamed path only for workspace geojson/csv', () => {
        const ws = { storage: 'workspace', type: 'spatial-chunked' };
        const mem = { type: 'spatial', geojson: { type: 'FeatureCollection', features: [] } };
        expect(shouldUseStreamExport(ws, 'geojson')).toBe(true);
        expect(shouldUseStreamExport(ws, 'csv')).toBe(true);
        expect(shouldUseStreamExport(ws, 'kml')).toBe(false);
        expect(shouldUseStreamExport(mem, 'geojson')).toBe(false);
        expect(STREAM_EXPORT_FORMATS.has('geojson')).toBe(true);
    });

    it('keeps __lgid in cleaned export properties helper contract', async () => {
        // Smoke: dynamic import of staging session memory fallback
        const { createExportStagingSession } = await import('../js/workspace/export-staging-store.js');
        const session = await createExportStagingSession('demo.geojson');
        expect(session.supported).toBe(false); // node test env — no OPFS
        await session.appendText('{"type":"FeatureCollection","features":[');
        await session.appendText(JSON.stringify({
            type: 'Feature',
            geometry: null,
            properties: { [LGID_PROP]: 'id-1', name: 'A' }
        }));
        await session.appendText(']}');
        const { blob, fileName } = await session.finalize();
        expect(fileName).toBe('demo.geojson');
        const text = await blob.text();
        expect(text).toContain('__lgid');
        expect(text).toContain('id-1');
    });
});
