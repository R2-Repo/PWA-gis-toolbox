import { compactScene, expandScene, PRESENTATION_BASE_URL } from './presentation-scene-schema.js';

function toBase64Url(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationScene} scene
 */
export function encodeScene(scene) {
    const json = JSON.stringify(compactScene(scene));
    const bytes = new TextEncoder().encode(json);
    return toBase64Url(bytes);
}

/**
 * @param {string} encoded
 */
export function decodeScene(encoded) {
    if (!encoded || typeof encoded !== 'string') {
        throw new Error('Presentation scene parameter is missing');
    }
    const bytes = fromBase64Url(encoded.trim());
    const json = new TextDecoder().decode(bytes);
    const compact = JSON.parse(json);
    return expandScene(compact);
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationScene} scene
 */
export function estimateEncodedSceneLength(scene) {
    const encoded = encodeScene(scene);
    const base = PRESENTATION_BASE_URL;
    return `${base}?mode=present&scene=${encoded}`.length;
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationScene} scene
 * @param {string} [baseUrl]
 */
export function buildPresentationUrl(scene, baseUrl = PRESENTATION_BASE_URL) {
    const encoded = encodeScene(scene);
    const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : 'https://gis-toolbox.com');
    url.search = '';
    url.searchParams.set('mode', 'present');
    url.searchParams.set('scene', encoded);
    return url.toString();
}
