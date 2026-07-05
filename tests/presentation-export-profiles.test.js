import { describe, expect, it } from 'vitest';
import {
    EXPORT_PROFILES,
    estimateSceneDurationMs,
    validateSceneForExport
} from '../js/presentation/presentation-export-profiles.js';
import { buildEmbedCode } from '../js/presentation/presentation-export.js';

const baseScene = {
    animations: [
        { type: 'flyToFeature', durationMs: 8000, delayMs: 0 },
        { type: 'rotateAroundFeature', durationMs: 12000, delayMs: 0 }
    ]
};

describe('presentation export profiles', () => {
    it('estimates total animation duration including delays', () => {
        expect(estimateSceneDurationMs(baseScene.animations)).toBe(20000);
        expect(estimateSceneDurationMs([
            { durationMs: 5000, delayMs: 2000 }
        ])).toBe(7000);
    });

    it('allows url/embed for longer multi-step presentations', () => {
        const scene = {
            animations: Array.from({ length: 4 }, (_, i) => ({
                type: 'rotateAroundFeature',
                durationMs: 8000,
                delayMs: 0,
                id: String(i)
            }))
        };
        expect(validateSceneForExport(scene, 'url').ok).toBe(true);
        expect(validateSceneForExport(scene, 'embed').ok).toBe(true);
        expect(validateSceneForExport(scene, 'gif').ok).toBe(false);
    });

    it('blocks gif when duration exceeds profile limit', () => {
        const scene = {
            animations: [{ type: 'flyToFeature', durationMs: 25000, delayMs: 0 }]
        };
        const result = validateSceneForExport(scene, 'gif');
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/20 seconds/);
    });

    it('blocks gif and video when there is no animation', () => {
        const scene = { animations: [] };
        expect(validateSceneForExport(scene, 'gif').ok).toBe(false);
        expect(validateSceneForExport(scene, 'mp4').ok).toBe(false);
        expect(validateSceneForExport(scene, 'poster').ok).toBe(true);
    });

    it('builds iframe embed markup', () => {
        const code = buildEmbedCode('https://example.com/?mode=present&scene=abc');
        expect(code).toContain('<iframe');
        expect(code).toContain('width="800"');
        expect(code).toContain('https://example.com/?mode=present&scene=abc');
    });

    it('exposes expected export profiles', () => {
        expect(EXPORT_PROFILES.gif.maxDurationSec).toBe(20);
        expect(EXPORT_PROFILES.mp4.maxDurationSec).toBe(60);
    });
});
