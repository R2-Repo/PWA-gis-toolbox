import { describe, expect, it } from 'vitest';
import { getSelectedFields } from '../js/core/data-model.js';

describe('getSelectedFields', () => {
    it('returns empty array when schema is missing', () => {
        expect(getSelectedFields(undefined)).toEqual([]);
        expect(getSelectedFields(null)).toEqual([]);
        expect(getSelectedFields({})).toEqual([]);
    });

    it('returns selected fields in order', () => {
        const schema = {
            fields: [
                { name: 'b', selected: true, order: 2 },
                { name: 'a', selected: true, order: 1 },
                { name: 'c', selected: false, order: 3 }
            ]
        };
        expect(getSelectedFields(schema).map((f) => f.name)).toEqual(['a', 'b']);
    });
});
