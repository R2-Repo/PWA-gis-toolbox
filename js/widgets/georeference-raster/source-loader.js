/**
 * Image source loading and working-resolution preview.
 */

import { WORKING_MAX_EDGE, buildSourceFingerprint } from './engine.js';

const IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp'
]);

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export function isImageGeorefFile(file) {
    if (!file) return false;
    if (file.type && IMAGE_TYPES.has(file.type.toLowerCase())) return true;
    return IMAGE_EXT.test(file.name || '');
}

export function isPdfGeorefFile(file) {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    return /\.pdf$/i.test(file.name || '');
}

export function detectGeorefFileKind(file) {
    if (isPdfGeorefFile(file)) return 'pdf';
    if (isImageGeorefFile(file)) return 'image';
    return null;
}

function revokeUrl(url) {
    if (url && String(url).startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* ignore */
        }
    }
}

async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Could not create a working preview from this image.'));
                return;
            }
            resolve(blob);
        }, type, quality);
    });
}

async function downscaleBitmap(bitmap, maxEdge, mime) {
    const scale = maxEdge / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare an image preview.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const type = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : 0.92);
    return { blob, width, height };
}

/**
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, pageIndex?: number }} [options]
 */
export async function loadImageSource(file, options = {}) {
    if (!file) throw new Error('Choose an image to georeference.');
    const maxEdge = options.maxEdge ?? WORKING_MAX_EDGE;
    const pageIndex = options.pageIndex ?? 0;
    const mime = file.type || 'image/png';

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error('This image could not be opened. Try PNG, JPEG, or WebP.');
    }

    const width = bitmap.width;
    const height = bitmap.height;
    const originalUrl = URL.createObjectURL(file);
    let workingBlob = file instanceof Blob ? file : null;
    let workingUrl = originalUrl;
    let workingWidth = width;
    let workingHeight = height;
    let extraWorkingUrl = null;

    try {
        if (Math.max(width, height) > maxEdge) {
            const scaled = await downscaleBitmap(bitmap, maxEdge, mime);
            extraWorkingUrl = URL.createObjectURL(scaled.blob);
            workingUrl = extraWorkingUrl;
            workingBlob = scaled.blob;
            workingWidth = scaled.width;
            workingHeight = scaled.height;
        }
    } finally {
        bitmap.close?.();
    }

    return {
        kind: 'image',
        name: file.name || 'image',
        mime,
        file,
        width,
        height,
        workingWidth,
        workingHeight,
        workingUrl,
        workingBlob,
        originalUrl,
        pageIndex,
        pageCount: 1,
        thumbnails: [],
        fingerprint: buildSourceFingerprint(file, width, height, pageIndex),
        dispose() {
            revokeUrl(originalUrl);
            if (extraWorkingUrl && extraWorkingUrl !== originalUrl) revokeUrl(extraWorkingUrl);
        }
    };
}

export function disposeSource(source) {
    source?.dispose?.();
}

export default {
    isImageGeorefFile,
    isPdfGeorefFile,
    detectGeorefFileKind,
    loadImageSource,
    disposeSource
};
