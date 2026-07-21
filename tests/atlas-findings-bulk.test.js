import { describe, expect, it } from 'vitest';
import { applyFindingStatusPatch } from '../js/atlas/findings-status.js';

describe('atlas finding bulk status', () => {
    it('patches only selected ids and sets resolvedAt for Resolved', () => {
        const findings = [
            { id: 'a', status: 'Open', resolvedAt: null },
            { id: 'b', status: 'Open', resolvedAt: null },
            { id: 'c', status: 'Reviewed', resolvedAt: null }
        ];
        const next = applyFindingStatusPatch(findings, ['a', 'c'], 'Resolved', '2026-07-21T00:00:00.000Z');
        expect(next.find((f) => f.id === 'a')).toMatchObject({
            status: 'Resolved',
            resolvedAt: '2026-07-21T00:00:00.000Z'
        });
        expect(next.find((f) => f.id === 'b')?.status).toBe('Open');
        expect(next.find((f) => f.id === 'c')?.status).toBe('Resolved');
    });

    it('ignores unknown status', () => {
        const findings = [{ id: 'a', status: 'Open' }];
        expect(applyFindingStatusPatch(findings, ['a'], 'Nope')).toEqual(findings);
    });
});
