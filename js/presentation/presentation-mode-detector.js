import { decodeScene } from './presentation-scene-codec.js';
import { validatePresentationScene } from './scene-validation.js';

/**
 * @typedef {object} PresentationModeState
 * @property {boolean} isPresentationMode
 * @property {string | null} sceneParam
 * @property {import('./presentation-scene-schema.js').PresentationScene | null} scene
 * @property {string[]} errors
 */

/**
 * @param {string} [search]
 * @returns {PresentationModeState}
 */
export function detectPresentationMode(search = typeof window !== 'undefined' ? window.location.search : '') {
    const params = new URLSearchParams(search);
    const mode = params.get('mode');
    const sceneParam = params.get('scene');

    if (mode !== 'present' || !sceneParam) {
        return {
            isPresentationMode: false,
            sceneParam: null,
            scene: null,
            errors: []
        };
    }

    try {
        const scene = decodeScene(sceneParam);
        const validation = validatePresentationScene(scene);
        if (!validation.ok) {
            return {
                isPresentationMode: true,
                sceneParam,
                scene: null,
                errors: validation.errors
            };
        }
        return {
            isPresentationMode: true,
            sceneParam,
            scene,
            errors: []
        };
    } catch (error) {
        return {
            isPresentationMode: true,
            sceneParam,
            scene: null,
            errors: [error?.message || 'Failed to decode presentation scene']
        };
    }
}

/** Cached result for the current page load. */
let cachedMode = null;

/**
 * @returns {PresentationModeState}
 */
export function getPresentationModeState() {
    if (!cachedMode) {
        cachedMode = detectPresentationMode();
    }
    return cachedMode;
}

export function isPresentationMode() {
    return getPresentationModeState().isPresentationMode;
}
