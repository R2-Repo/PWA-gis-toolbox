import { describe, expect, it } from 'vitest';
import { coercePropertyValue, validateBulkUpdate } from '../js/widgets/bulk-update/engine.js';

describe('edit-session prerequisites', () => {
    it('validates bulk update inputs used by workspace writeback', () => {
        expect(validateBulkUpdate({ selectedIndices: [], updates: [{ field: 'a', value: 1 }] }).valid).toBe(false);
        expect(validateBulkUpdate({ selectedIndices: [0], updates: [] }).valid).toBe(false);
        const ok = validateBulkUpdate({
            selectedIndices: [0, 2],
            updates: [{ field: 'owner', value: 'X' }]
        });
        expect(ok.valid).toBe(true);
        expect(ok.safeUpdates).toHaveLength(1);
    });

    it('coerces numeric form values like the feature editor path', () => {
        expect(coercePropertyValue('42')).toBe(42);
        expect(coercePropertyValue('')).toBe('');
        expect(coercePropertyValue('abc')).toBe('abc');
    });
});
