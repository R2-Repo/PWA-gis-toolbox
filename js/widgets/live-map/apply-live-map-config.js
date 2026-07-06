import bus from '../../core/event-bus.js';
import { applyViewportConfig } from '../../url/app-url-bootstrap.js';
import { resolveAppUrlMapInit } from '../../url/app-url-builder.js';
import { applyLiveLayerConfig } from '../../live-layers/live-layer-bootstrap.js';

/**
 * Wait for map style to finish loading after setBasemap or 3D changes.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @param {number} [timeoutMs]
 */
export function waitForMapStyleReady(map, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!map) {
            resolve();
            return;
        }

        const isReady = () => map.loaded?.() && map.isStyleLoaded?.();
        if (isReady()) {
            resolve();
            return;
        }

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            map.off('load', onReady);
            map.off('styledata', onStyleData);
            clearTimeout(timer);
            resolve();
        };

        const onReady = () => {
            if (isReady()) finish();
        };
        const onStyleData = () => {
            if (isReady()) finish();
        };

        map.on('load', onReady);
        map.on('styledata', onStyleData);
        const timer = setTimeout(finish, timeoutMs);
    });
}

/**
 * Apply basemap, dimension, and panel chrome from URL config.
 * @param {object} ctx - widget context
 * @param {import('../../url/app-url-schema.js').AppUrlConfig} config
 */
export async function applyChromeFromConfig(ctx, config) {
    if (config.panel) bus.emit('app-url:panel', config.panel);

    const mapService = ctx.mapService;
    const currentBasemap = mapService.getCurrentBasemap?.();
    const targetBasemap = config.basemap;
    const target3d = config.dim === '3d';
    const current3d = mapService.is3DEnabled?.();

    if (targetBasemap && targetBasemap !== currentBasemap) {
        mapService.setBasemap(targetBasemap);
        await waitForMapStyleReady(mapService.getMap?.());
    }

    if (target3d && !current3d) {
        mapService.enable3D({ animate: false });
        await waitForMapStyleReady(mapService.getMap?.());
    } else if (!target3d && current3d) {
        mapService.disable3D({ animate: false });
        await waitForMapStyleReady(mapService.getMap?.());
    }

    bus.emit('map:chrome', {
        basemap: mapService.getCurrentBasemap?.(),
        is3d: mapService.is3DEnabled?.()
    });
}

/**
 * Apply full live map config: chrome, viewport, and live layers.
 * @param {object} ctx - widget context
 * @param {import('../../url/app-url-schema.js').AppUrlConfig} config
 * @returns {Promise<number>} layer count applied
 */
export async function applyLiveMapConfigToMap(ctx, config) {
    await applyChromeFromConfig(ctx, config);

    const init = resolveAppUrlMapInit(config);
    const map = ctx.mapService.getMap?.();
    if (map?.loaded?.()) {
        await waitForMapStyleReady(map);
        applyViewportConfig(map, init);
    }

    const entries = config.live || [];
    if (!entries.length) return 0;

    await applyLiveLayerConfig(config, { mapService: ctx.mapService });
    return entries.length;
}
