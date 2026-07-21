import { describe, expect, it } from 'vitest';
import {
    atlasMapKindFilterExpression,
    matchesMapPingFilter,
    statusesForMapPingFilter
} from '../js/atlas/map-ping-filter.js';

describe('atlas map ping filter', () => {
    it('maps modes to status lists', () => {
        expect(statusesForMapPingFilter('all')).toBe(null);
        expect(statusesForMapPingFilter('unreachable')).toEqual(['unreachable']);
        expect(statusesForMapPingFilter('warning')).toEqual(['warning']);
        expect(statusesForMapPingFilter('untested')).toEqual(['untested', 'pending']);
        expect(statusesForMapPingFilter('attention')).toEqual([
            'unreachable',
            'warning',
            'untested',
            'pending'
        ]);
    });

    it('matches statuses and always keeps selected', () => {
        expect(matchesMapPingFilter('reachable', 'attention')).toBe(false);
        expect(matchesMapPingFilter('unreachable', 'attention')).toBe(true);
        expect(matchesMapPingFilter('reachable', 'attention', { selected: true })).toBe(true);
        expect(matchesMapPingFilter('untested', 'all')).toBe(true);
    });

    it('builds MapLibre kind filters', () => {
        expect(atlasMapKindFilterExpression('drop', 'all')).toEqual([
            '==',
            ['get', 'atlasKind'],
            'drop'
        ]);
        const filtered = atlasMapKindFilterExpression('hub', 'unreachable');
        expect(filtered[0]).toBe('all');
        expect(filtered[1]).toEqual(['==', ['get', 'atlasKind'], 'hub']);
        expect(filtered[2][0]).toBe('any');
        expect(filtered[2][2]).toEqual(['in', ['get', 'pingStatus'], ['literal', ['unreachable']]]);
    });
});
