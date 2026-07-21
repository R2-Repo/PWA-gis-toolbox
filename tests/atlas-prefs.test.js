import { describe, expect, it } from 'vitest';
import {
    defaultAtlasPrefs,
    normalizeAtlasPrefs,
    serializePrefValue,
    PREF_DASHBOARD_SCOPE,
    PREF_MONITOR_INTERVAL,
    PREF_SESSIONS_RETENTION_DAYS,
    PREF_TRIAGE_MODE
} from '../js/atlas/prefs.js';

describe('atlas prefs', () => {
    it('normalizes allowed values and falls back on junk', () => {
        expect(normalizeAtlasPrefs({
            [PREF_MONITOR_INTERVAL]: 'continuous',
            [PREF_DASHBOARD_SCOPE]: 'selection',
            [PREF_TRIAGE_MODE]: 'stale',
            [PREF_SESSIONS_RETENTION_DAYS]: '7'
        })).toEqual({
            monitorInterval: 'continuous',
            dashScope: 'selection',
            triageMode: 'stale',
            sessionsRetentionDays: 7
        });
        expect(normalizeAtlasPrefs({
            [PREF_MONITOR_INTERVAL]: '999',
            [PREF_DASHBOARD_SCOPE]: 'everywhere',
            [PREF_TRIAGE_MODE]: 'nope',
            [PREF_SESSIONS_RETENTION_DAYS]: '12'
        })).toEqual(defaultAtlasPrefs());
    });

    it('serializes only allow-listed values', () => {
        expect(serializePrefValue(PREF_MONITOR_INTERVAL, 5)).toBe('5');
        expect(serializePrefValue(PREF_MONITOR_INTERVAL, 'continuous')).toBe('continuous');
        expect(serializePrefValue(PREF_MONITOR_INTERVAL, 99)).toBe(null);
        expect(serializePrefValue(PREF_DASHBOARD_SCOPE, 'network')).toBe('network');
        expect(serializePrefValue(PREF_TRIAGE_MODE, 'attention')).toBe('attention');
        expect(serializePrefValue(PREF_SESSIONS_RETENTION_DAYS, 30)).toBe('30');
        expect(serializePrefValue(PREF_SESSIONS_RETENTION_DAYS, 12)).toBe(null);
        expect(serializePrefValue('secret.key', 'x')).toBe(null);
    });
});
