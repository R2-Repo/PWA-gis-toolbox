import { describe, expect, it } from 'vitest';
import { usesTimelinePlayback } from '../js/presentation/presentation-timeline-engine.js';

describe('presentation timeline engine', () => {
    it('detects timeline playback from compiled steps', () => {
        expect(usesTimelinePlayback([
            { startAtMs: 0, options: { timelineMode: 'sequential' } },
            { startAtMs: 4000, options: { timelineMode: 'overlap' } }
        ])).toBe(true);
    });

    it('uses legacy playback for preset single steps', () => {
        expect(usesTimelinePlayback([
            { durationMs: 8000, delayMs: 0, options: {} }
        ])).toBe(false);
    });
});
