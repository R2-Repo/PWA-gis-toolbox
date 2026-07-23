import { describe, expect, it } from 'vitest';
import { createWebPlatform } from '../js/platform/web/web-platform.js';
import { createWindowsPlatform } from '../js/platform/windows/windows-platform.js';
import { hasCapability } from '../js/platform/contracts.js';
import { formatBytes } from '../js/library/gis-library.js';
import { resolveLibrarySourceKind, pmtilesDatasetFromItem } from '../js/map/layer-source/adapters.js';
import { isPmTilesLayer } from '../js/core/data-model.js';

describe('gis library platform', () => {
    it('keeps gisLibrary unavailable on web', () => {
        const { platform, services } = createWebPlatform();
        expect(hasCapability(platform, 'gisLibrary')).toBe(false);
        expect(platform.capabilities.gisLibrary.available).toBe(false);
        return expect(services.gisCatalog.listItems()).rejects.toThrow(/Windows desktop/i);
    });

    it('marks gisLibrary available on windows when Tauri is absent still exposes service shape', () => {
        const { platform, services } = createWindowsPlatform();
        // Without live Tauri, capability may be false; service must still exist for IPC wiring.
        expect(services.gisCatalog).toBeTruthy();
        expect(typeof services.gisCatalog.open).toBe('function');
        expect(typeof services.gisCatalog.ingestPath).toBe('function');
        expect(typeof services.gisCatalog.listItems).toBe('function');
        expect(platform.capabilities.gisLibrary).toBeTruthy();
    });

    it('formats byte sizes', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    });

    it('resolves pmtiles adapter when tilePath is set', () => {
        const item = {
            id: 'abc',
            displayName: 'Roads',
            tilePath: 'C:/gis-library/tiles/abc/layer.pmtiles',
            bbox: [-112, 40, -111, 41],
            manifest: { tileSourceLayer: 'default', tileMinZoom: 0, tileMaxZoom: 12 }
        };
        expect(resolveLibrarySourceKind(item)).toBe('pmtiles');
        expect(resolveLibrarySourceKind({ id: 'x' })).toBe('geojson-preview');
        const layer = pmtilesDatasetFromItem(item);
        expect(isPmTilesLayer(layer)).toBe(true);
        expect(layer.pmtiles.path).toContain('layer.pmtiles');
        expect(layer.pmtiles.sourceLayer).toBe('default');
    });
});
