import { downloadBlob } from '../export/exporter.js';
import { buildPresentationUrl } from './presentation-scene-codec.js';
import {
    validateSceneForExport,
    summarizeExportAvailability,
    EXPORT_PROFILES
} from './presentation-export-profiles.js';
import {
    capturePresentationFrames,
    recordPresentationVideo,
    capturePresentationPoster
} from './presentation-capture.js';
import { buildGifBlob } from '../map/map-export.js';

export {
    EXPORT_PROFILES,
    validateSceneForExport,
    summarizeExportAvailability,
    estimateSceneDurationMs
} from './presentation-export-profiles.js';

/**
 * @param {string} presentationUrl
 * @param {object} [options]
 * @param {number} [options.width]
 * @param {number} [options.height]
 */
export function buildEmbedCode(presentationUrl, options = {}) {
    const width = options.width ?? 800;
    const height = options.height ?? 600;
    const safeUrl = presentationUrl.replace(/"/g, '&quot;');
    return `<iframe src="${safeUrl}" width="${width}" height="${height}" style="border:0" allowfullscreen loading="lazy" title="GIS Toolbox presentation"></iframe>`;
}

export function buildPresentationExportFilename(ext) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate())
    ].join('-') + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    return `gis-toolbox-presentation-${stamp}.${ext}`;
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationScene} scene
 * @param {string} [baseUrl]
 */
export function getEmbedCodeForScene(scene, baseUrl, options = {}) {
    const url = buildPresentationUrl(scene, baseUrl);
    return buildEmbedCode(url, options);
}

/**
 * @param {object} options
 * @param {import('maplibre-gl').Map} options.map
 * @param {object} options.mapService
 * @param {import('./presentation-scene-schema.js').PresentationScene} options.scene
 * @param {import('./animation-engine.js').PresentationAnimationEngine} options.engine
 * @param {(progress: number) => void} [options.onProgress]
 */
export async function exportPresentationGif(options) {
    const { scene } = options;
    const validation = validateSceneForExport(scene, 'gif');
    if (!validation.ok) {
        throw new Error(validation.errors[0]);
    }

    const frames = await capturePresentationFrames({
        ...options,
        onProgress: options.onProgress
    });
    if (!frames.length) {
        throw new Error('No frames captured for GIF export.');
    }

    const durationMs = validation.durationMs || 1000;
    const frameDelayMs = Math.max(40, Math.round(durationMs / frames.length));
    const blob = await buildGifBlob(frames, frameDelayMs);
    const filename = buildPresentationExportFilename('gif');
    downloadBlob(blob, filename);

    return {
        filename,
        frames: frames.length,
        width: frames[0]?.width,
        height: frames[0]?.height,
        frameDelayMs
    };
}

/**
 * @param {object} options
 */
export async function exportPresentationVideo(options) {
    const { scene } = options;
    const validation = validateSceneForExport(scene, 'mp4');
    if (!validation.ok) {
        throw new Error(validation.errors[0]);
    }

    const result = await recordPresentationVideo(options);
    const filename = buildPresentationExportFilename(result.ext);
    downloadBlob(result.blob, filename);

    return {
        filename,
        ext: result.ext,
        mimeType: result.mimeType,
        durationMs: result.durationMs
    };
}

/**
 * @param {object} options
 */
export async function exportPresentationPoster(options) {
    const { scene } = options;
    const validation = validateSceneForExport(scene, 'poster');
    if (!validation.ok) {
        throw new Error(validation.errors[0]);
    }

    const canvas = await capturePresentationPoster({
        ...options,
        maxWidth: EXPORT_PROFILES.poster.maxWidth ?? 4096
    });

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => {
            if (value) resolve(value);
            else reject(new Error('Poster export failed'));
        }, 'image/png');
    });

    const filename = buildPresentationExportFilename('png');
    downloadBlob(blob, filename);

    return {
        filename,
        width: canvas.width,
        height: canvas.height
    };
}
