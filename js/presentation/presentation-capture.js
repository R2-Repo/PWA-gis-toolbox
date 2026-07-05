import { PresentationAnimationEngine } from './animation-engine.js';
import {
    buildGifBlob,
    captureLiveFrame,
    ensureMapFrameReady,
    GIF_MAX_WIDTH,
    scaleCanvasToImageData,
    suspendMapInteractions
} from '../map/map-export.js';
import { estimateSceneDurationMs } from './presentation-export-profiles.js';

const GIF_CAPTURE_FPS = 20;
const VIDEO_CAPTURE_FPS = 30;
const CAPTURE_TAIL_MS = 400;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} options
 * @param {import('maplibre-gl').Map} options.map
 * @param {object} options.mapService
 * @param {import('./presentation-scene-schema.js').PresentationScene} options.scene
 * @param {PresentationAnimationEngine} [options.engine]
 * @param {number} [options.fps]
 * @param {number} [options.maxWidth]
 * @param {() => boolean} [options.shouldStop]
 * @param {(progress: number) => void} [options.onProgress]
 */
export async function capturePresentationFrames(options) {
    const {
        map,
        mapService,
        scene,
        engine: existingEngine,
        fps = GIF_CAPTURE_FPS,
        maxWidth = GIF_MAX_WIDTH,
        shouldStop,
        onProgress
    } = options;

    const engine = existingEngine ?? new PresentationAnimationEngine({
        map,
        features: scene.features,
        style: scene.style
    });
    const ownsEngine = !existingEngine;

    if (!existingEngine) {
        await engine.applyCamera(scene.camera);
    }

    const totalMs = Math.max(
        estimateSceneDurationMs(scene.animations),
        scene.animations?.length ? 1000 : 0
    ) + CAPTURE_TAIL_MS;
    const frameIntervalMs = 1000 / fps;
    const expectedFrames = Math.max(1, Math.ceil(totalMs / frameIntervalMs));

    const frames = [];
    const resumeInteractions = suspendMapInteractions(map);
    let playbackError = null;

    const playbackPromise = (async () => {
        try {
            if (scene.animations?.length) {
                await engine.playSequence(scene.animations);
            }
        } catch (error) {
            playbackError = error;
        }
    })();

    const startTime = performance.now();
    try {
        while (true) {
            if (shouldStop?.()) break;
            const elapsed = performance.now() - startTime;
            if (elapsed >= totalMs) break;

            await ensureMapFrameReady(map);
            const frameCanvas = captureLiveFrame(map, mapService);
            frames.push(scaleCanvasToImageData(frameCanvas, maxWidth));
            onProgress?.(Math.min(1, frames.length / expectedFrames));

            await sleep(frameIntervalMs);
        }
    } finally {
        resumeInteractions();
    }

    await playbackPromise;
    if (playbackError) throw playbackError;
    if (ownsEngine) engine.cleanup();

    return frames;
}

/**
 * @returns {string}
 */
export function pickVideoMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

/**
 * @param {object} options
 * @param {import('maplibre-gl').Map} options.map
 * @param {import('./presentation-scene-schema.js').PresentationScene} options.scene
 * @param {PresentationAnimationEngine} options.engine
 * @param {(progress: number) => void} [options.onProgress]
 */
export async function recordPresentationVideo(options) {
    const { map, scene, engine, onProgress } = options;
    const mimeType = pickVideoMimeType();
    if (!mimeType) {
        throw new Error('Video recording is not supported in this browser.');
    }

    const canvas = map.getCanvas();
    if (!canvas?.captureStream) {
        throw new Error('Video recording is not supported in this browser.');
    }

    const stream = canvas.captureStream(VIDEO_CAPTURE_FPS);
    const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000
    });

    const chunks = [];
    recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
    };

    const blobPromise = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder.onerror = () => reject(new Error('Video recording failed'));
    });

    const totalMs = estimateSceneDurationMs(scene.animations) || 1000;
    const resumeInteractions = suspendMapInteractions(map);
    onProgress?.(0);

    recorder.start(250);
    try {
        if (scene.animations?.length) {
            await engine.playSequence(scene.animations);
        } else {
            await sleep(500);
        }
    } finally {
        resumeInteractions();
    }

    recorder.stop();
    const blob = await blobPromise;
    onProgress?.(1);

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    return { blob, ext, mimeType, durationMs: totalMs };
}

/**
 * @param {object} options
 * @param {import('maplibre-gl').Map} options.map
 * @param {object} options.mapService
 * @param {import('./presentation-scene-schema.js').PresentationScene} options.scene
 * @param {PresentationAnimationEngine} options.engine
 * @param {number} [options.maxWidth]
 */
export async function capturePresentationPoster(options) {
    const { map, mapService, scene, engine, maxWidth = 4096 } = options;

    if (scene.animations?.length) {
        await engine.playSequence(scene.animations);
    }

    await ensureMapFrameReady(map);
    return captureLiveFrame(map, mapService);
}

export { estimateSceneDurationMs };
