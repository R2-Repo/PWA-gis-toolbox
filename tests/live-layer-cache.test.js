import { describe, expect, it } from 'vitest';
import {
    envelopeContains,
    envelopeFromMapBounds,
    isLiveLayerInRange,
    padEnvelope,
    resolveLiveRefreshMs,
    resolveLiveViewportAction
} from '../js/live-layers/live-layer-cache.js';
import { expandCatalogEntry, resolveLiveLayer } from '../js/live-layers/catalog-schema.js';
import { UDOT_FIBER_CATALOG_ID, UDOT_FIBER_MIN_ZOOM } from '../js/symbology/udot-fiber/constants.js';

describe('live-layer cache', () => {
    it('reuses a padded envelope for zoom-in and skips below min zoom', () => {
        const view = envelopeFromMapBounds({
            getWest: () => -112,
            getSouth: () => 40.5,
            getEast: () => -111.8,
            getNorth: () => 40.7
        });
        const cached = padEnvelope(view);
        expect(envelopeContains(cached, view)).toBe(true);

        const zoomedIn = {
            west: -111.95,
            south: 40.55,
            east: -111.85,
            north: 40.65
        };
        expect(resolveLiveViewportAction({
            zoom: 16,
            minZoom: 14,
            view: zoomedIn,
            cached
        })).toBe('reuse');

        expect(resolveLiveViewportAction({
            zoom: 13.5,
            minZoom: 14,
            view,
            cached
        })).toBe('hide');

        expect(resolveLiveViewportAction({
            zoom: 14,
            minZoom: 14,
            view: { west: -113, south: 39, east: -110, north: 42 },
            cached
        })).toBe('fetch');
    });

    it('treats refreshMs 0 as disabled', () => {
        expect(resolveLiveRefreshMs(0, 300000)).toBe(0);
        expect(resolveLiveRefreshMs(undefined, 300000)).toBe(300000);
        expect(isLiveLayerInRange(14, 14)).toBe(true);
        expect(isLiveLayerInRange(13.9, 14)).toBe(false);
    });

    it('configures UDOT Fiber with neighborhood min zoom and no timer', () => {
        const services = expandCatalogEntry(resolveLiveLayer(UDOT_FIBER_CATALOG_ID));
        expect(services).toHaveLength(6);
        expect(services.every((s) => s.minZoom === UDOT_FIBER_MIN_ZOOM)).toBe(true);
        expect(services.every((s) => s.refreshMs === 0)).toBe(true);
    });
});
