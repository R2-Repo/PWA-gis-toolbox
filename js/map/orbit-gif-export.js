/**
 * Scripted camera orbit recorded as a GIF.
 * Uses the map in this window. Frame encoding stays in map-export.js.
 */

import { downloadBlob } from '../export/exporter.js';
import {
    buildGifBlob,
    buildMapExportFilename,
    captureLiveFrame,
    scaleCanvasToImageData,
    suspendMapInteractions
} from './map-export.js';

export const ORBIT_GIF_DURATION_MS = 4800;
export const ORBIT_GIF_FRAME_COUNT = 12;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function nextPaint() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
            return;
        }
        setTimeout(resolve, 16);
    });
}

/**
 * Sample the live map while it eases through one full turn.
 * @param {import('maplibre-gl').Map} map
 * @param {object} mapService
 * @param {{ startBearing: number, durationMs: number, frameCount: number }} options
 */
export async function captureOrbitFrames(map, mapService, options) {
    const durationMs = Math.max(0, options.durationMs);
    const frameCount = Math.max(2, options.frameCount);
    const step = frameCount > 1 ? durationMs / (frameCount - 1) : 0;
    const resume = suspendMapInteractions(map);
    const frames = [];

    let settled = false;
    const finish = () => {
        settled = true;
    };
    if (typeof map.once === 'function') map.once('moveend', finish);

    try {
        map.easeTo?.({
            bearing: options.startBearing + 360,
            duration: durationMs,
            easing: (t) => t,
            essential: true,
            freezeElevation: true
        });

        for (let i = 0; i < frameCount; i++) {
            frames.push(scaleCanvasToImageData(captureLiveFrame(map, mapService)));
            if (i < frameCount - 1 && durationMs > 0) {
                await nextPaint();
                await sleep(step);
            }
        }

        if (!settled && durationMs > 0) {
            await Promise.race([
                new Promise((resolve) => {
                    if (settled) resolve();
                    else if (typeof map.once === 'function') map.once('moveend', resolve);
                    else resolve();
                }),
                sleep(durationMs + 500)
            ]);
        }
    } finally {
        if (typeof map.off === 'function') map.off('moveend', finish);
        resume?.();
    }

    return frames;
}

/**
 * @param {object} mapService
 * @param {{ durationMs?: number, frameCount?: number }} [options]
 */
export async function exportOrbitGif(mapService, options = {}) {
    const map = mapService?.getMap?.();
    if (!map || typeof map.getCenter !== 'function') {
        throw new Error('Map is not ready');
    }
    const center = map.getCenter();
    if (!center || !Number.isFinite(center.lng) || !Number.isFinite(center.lat)) {
        throw new Error('Map is not ready');
    }
    if (typeof mapService.prepareOrbitView !== 'function') {
        throw new Error('Map is not ready');
    }

    const durationMs = options.durationMs ?? ORBIT_GIF_DURATION_MS;
    const frameCount = options.frameCount ?? ORBIT_GIF_FRAME_COUNT;
    let prepared;
    try {
        prepared = await withTimeout(mapService.prepareOrbitView(
            { lng: center.lng, lat: center.lat },
            { duration: 0 }
        ), 8000);
    } catch (err) {
        throw err instanceof Error ? err : new Error('Map is not ready');
    }
    const startBearing = Number.isFinite(prepared?.startBearing)
        ? prepared.startBearing
        : (map.getBearing?.() ?? 0);

    const frames = await captureOrbitFrames(map, mapService, {
        startBearing,
        durationMs,
        frameCount
    });
    if (frames.length < 2) {
        throw new Error('Orbit GIF needs more than one frame');
    }

    const frameDelayMs = Math.max(40, Math.round((durationMs || 1000) / frames.length));
    const blob = await buildGifBlob(frames, frameDelayMs);
    const filename = buildMapExportFilename('gif');
    downloadBlob(blob, filename);
    return {
        filename,
        frames: frames.length,
        width: frames[0]?.width,
        height: frames[0]?.height,
        frameDelayMs
    };
}
