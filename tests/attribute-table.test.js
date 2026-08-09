import { describe, expect, it } from 'vitest';
import {
    ATTRIBUTE_TABLE_PAGE_SIZE,
    clampAttributePageOffset,
    compareAttributeValues,
    normalizeAttributeTableQuery,
    recordsToAttributeRows,
    resolveAttributeTableFields,
    rowMatchesAttributeQuery,
    sortAttributeRows
} from '../js/workspace/attribute-table.js';
import { LGID_PROP } from '../js/workspace/feature-identity.js';

describe('attribute-table helpers', () => {
    it('uses a modest default page size', () => {
        expect(ATTRIBUTE_TABLE_PAGE_SIZE).toBe(100);
    });

    it('resolves fields with identity + schema + cold + sample extras', () => {
        const fields = resolveAttributeTableFields({
            schemaFieldNames: ['name', 'route'],
            coldFields: ['notes', 'name'],
            sampleRows: [{ name: 'A', extra: 1, _skip: true }],
            includeIdentity: true
        });
        expect(fields[0]).toBe('_featureIndex');
        expect(fields[1]).toBe(LGID_PROP);
        expect(fields).toContain('name');
        expect(fields).toContain('route');
        expect(fields).toContain('notes');
        expect(fields).toContain('extra');
        expect(fields).not.toContain('_skip');
    });

    it('joins cold properties into attribute rows', () => {
        const attrByIndex = new Map([
            [10, { featureIndex: 10, lgid: 'g-1', properties: { name: 'Pole', route: 'I-15' } }],
            [11, { featureIndex: 11, lgid: 'g-2', properties: { name: 'Box' } }]
        ]);
        const coldByLgid = new Map([
            ['g-1', { notes: 'hidden-on-map', route: 'should-not-win' }]
        ]);
        const rows = recordsToAttributeRows(attrByIndex, coldByLgid, {
            includeCold: true,
            startIndex: 10,
            count: 3
        });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            _featureIndex: 10,
            [LGID_PROP]: 'g-1',
            name: 'Pole',
            route: 'I-15',
            notes: 'hidden-on-map'
        });
        expect(rows[1].name).toBe('Box');
        expect(rows[2]).toEqual({ _featureIndex: 12 });
    });

    it('can omit cold properties', () => {
        const attrByIndex = new Map([
            [0, { featureIndex: 0, lgid: 'g', properties: { name: 'A' } }]
        ]);
        const coldByLgid = new Map([['g', { secret: 1 }]]);
        const rows = recordsToAttributeRows(attrByIndex, coldByLgid, {
            includeCold: false,
            startIndex: 0,
            count: 1
        });
        expect(rows[0].secret).toBeUndefined();
        expect(rows[0].name).toBe('A');
    });

    it('clamps page offsets to valid page starts', () => {
        expect(clampAttributePageOffset(-5, 250, 100)).toBe(0);
        expect(clampAttributePageOffset(50, 250, 100)).toBe(50);
        expect(clampAttributePageOffset(999, 250, 100)).toBe(200);
        expect(clampAttributePageOffset(0, 0, 100)).toBe(0);
    });

    it('matches free-text and field filters', () => {
        const row = { name: 'Main St', route: 'I-15', notes: '' };
        expect(rowMatchesAttributeQuery(row, normalizeAttributeTableQuery({ text: 'main' }))).toBe(true);
        expect(rowMatchesAttributeQuery(row, normalizeAttributeTableQuery({ text: 'missing' }))).toBe(false);
        expect(rowMatchesAttributeQuery(row, normalizeAttributeTableQuery({
            field: 'route',
            fieldOp: 'equals',
            fieldValue: 'i-15'
        }))).toBe(true);
        expect(rowMatchesAttributeQuery(row, normalizeAttributeTableQuery({
            field: 'notes',
            fieldOp: 'is_empty'
        }))).toBe(true);
        expect(rowMatchesAttributeQuery(row, normalizeAttributeTableQuery({
            text: 'main',
            field: 'route',
            fieldOp: 'contains',
            fieldValue: '80'
        }))).toBe(false);
    });

    it('sorts attribute rows by field', () => {
        const rows = [
            { name: 'b', n: 2 },
            { name: 'a', n: 10 },
            { name: 'c', n: 1 }
        ];
        expect(sortAttributeRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['a', 'b', 'c']);
        expect(sortAttributeRows(rows, 'n', 'desc').map((r) => r.n)).toEqual([10, 2, 1]);
        expect(compareAttributeValues(null, 'x')).toBe(1);
    });
});
