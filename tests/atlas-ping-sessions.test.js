import { describe, expect, it } from 'vitest';
import {
    formatSessionEndLabel,
    isMonitorHistorySession,
    sessionsOlderThan
} from '../js/atlas/export.js';

describe('atlas ping session history helpers', () => {
    it('hides one-shot sessions from monitor history', () => {
        expect(isMonitorHistorySession({ label: 'Monitor' })).toBe(true);
        expect(isMonitorHistorySession({ label: 'Hub H1' })).toBe(true);
        expect(isMonitorHistorySession({ label: 'one-shot' })).toBe(false);
        expect(isMonitorHistorySession({ label: 'One-Shot' })).toBe(false);
        expect(isMonitorHistorySession({ label: null })).toBe(true);
    });

    it('filters sessions older than N days', () => {
        const now = Date.now();
        const sessions = [
            { id: 'new', startedAt: new Date(now - 2 * 86400000).toISOString() },
            { id: 'old', startedAt: new Date(now - 40 * 86400000).toISOString() },
            { id: 'active', startedAt: new Date(now - 100 * 86400000).toISOString() }
        ];
        const stale = sessionsOlderThan(sessions, 30, { excludeSessionId: 'active' });
        expect(stale.map((s) => s.id)).toEqual(['old']);
    });

    it('labels incomplete sessions without stoppedAt', () => {
        const old = {
            id: 's1',
            startedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
            stoppedAt: null
        };
        expect(formatSessionEndLabel(old)).toBe('incomplete');
        expect(formatSessionEndLabel({ id: 'live', startedAt: new Date().toISOString() }, 'live')).toBe('active');
        expect(formatSessionEndLabel({
            id: 'done',
            startedAt: new Date().toISOString(),
            stoppedAt: '1700000000'
        })).not.toBe('incomplete');
    });
});
