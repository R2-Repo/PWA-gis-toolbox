import { describe, expect, it } from 'vitest';
import { isMonitorHistorySession } from '../js/atlas/export.js';

describe('atlas ping session history helpers', () => {
    it('hides one-shot sessions from monitor history', () => {
        expect(isMonitorHistorySession({ label: 'Monitor' })).toBe(true);
        expect(isMonitorHistorySession({ label: 'Hub H1' })).toBe(true);
        expect(isMonitorHistorySession({ label: 'one-shot' })).toBe(false);
        expect(isMonitorHistorySession({ label: 'One-Shot' })).toBe(false);
        expect(isMonitorHistorySession({ label: null })).toBe(true);
    });
});
