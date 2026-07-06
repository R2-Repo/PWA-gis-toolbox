/** @typedef {'url' | 'embed' | 'gif' | 'mp4' | 'poster'} PresentationExportProfileId */

import { estimateTimelineDurationMs } from './presentation-sequence-compiler.js';

/**
 * @typedef {object} PresentationExportProfile
 * @property {PresentationExportProfileId} id
 * @property {string} label
 * @property {number | null} maxSteps
 * @property {number | null} maxDurationSec
 * @property {number | null} maxWidth
 * @property {boolean} [interactive]
 * @property {boolean} [requiresAnimation]
 */

/** @type {Record<PresentationExportProfileId, PresentationExportProfile>} */
export const EXPORT_PROFILES = {
    url: {
        id: 'url',
        label: 'Presentation URL',
        maxSteps: 5,
        maxDurationSec: null,
        maxWidth: null,
        interactive: true
    },
    embed: {
        id: 'embed',
        label: 'Embed code',
        maxSteps: 5,
        maxDurationSec: null,
        maxWidth: null,
        interactive: true
    },
    gif: {
        id: 'gif',
        label: 'GIF',
        maxSteps: 3,
        maxDurationSec: 20,
        maxWidth: 1280,
        requiresAnimation: true
    },
    mp4: {
        id: 'mp4',
        label: 'Video',
        maxSteps: 5,
        maxDurationSec: 60,
        maxWidth: 1920,
        requiresAnimation: true
    },
    poster: {
        id: 'poster',
        label: 'Poster image',
        maxSteps: null,
        maxDurationSec: null,
        maxWidth: 4096
    }
};

/**
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep[]} animations
 */
export function estimateSceneDurationMs(animations = []) {
    return estimateTimelineDurationMs(animations);
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationScene} scene
 * @param {PresentationExportProfileId} profileId
 */
export function validateSceneForExport(scene, profileId) {
    const profile = EXPORT_PROFILES[profileId];
    if (!profile) {
        return { ok: false, errors: [`Unknown export profile: ${profileId}`], warnings: [] };
    }

    const errors = [];
    const warnings = [];
    const animations = scene?.animations || [];
    const stepCount = animations.length;
    const durationMs = estimateSceneDurationMs(animations);
    const durationSec = durationMs / 1000;

    if (profile.maxSteps != null && stepCount > profile.maxSteps) {
        errors.push(
            `${profile.label} allows up to ${profile.maxSteps} animation step${profile.maxSteps === 1 ? '' : 's'} (this presentation has ${stepCount}).`
        );
    }

    if (profile.maxDurationSec != null && durationSec > profile.maxDurationSec) {
        errors.push(
            `${profile.label} works best under ${profile.maxDurationSec} seconds (this presentation is about ${Math.ceil(durationSec)}s).`
        );
    }

    if (profile.requiresAnimation && stepCount === 0) {
        errors.push(`${profile.label} requires at least one animation step.`);
    }

    if (profileId === 'gif' && durationSec > 15 && durationSec <= (profile.maxDurationSec ?? 20)) {
        warnings.push('Long GIF exports may produce large files.');
    }

    if (profileId === 'mp4' && durationSec > 45 && durationSec <= (profile.maxDurationSec ?? 60)) {
        warnings.push('Long video exports may take a minute to record.');
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        profile,
        stepCount,
        durationMs,
        durationSec
    };
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationScene} scene
 */
export function summarizeExportAvailability(scene) {
    /** @type {Record<string, ReturnType<typeof validateSceneForExport>>} */
    const byProfile = {};
    for (const profileId of Object.keys(EXPORT_PROFILES)) {
        byProfile[profileId] = validateSceneForExport(scene, profileId);
    }
    return byProfile;
}

export function listExportProfiles() {
    return Object.values(EXPORT_PROFILES);
}
