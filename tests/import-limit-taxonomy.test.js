import { describe, it, expect } from 'vitest';
import {
    IMPORT_LIMIT_REGISTRY,
    MATERIALIZE_FEATURE_LIMIT,
    STORED_FEATURE_SOFT_LIMIT,
    getLimitEntry
} from '../js/import/import-limit-taxonomy.js';

describe('import-limit-taxonomy', () => {
    it('registers ROUTING / SAFETY / OPERATION entries', () => {
        const kinds = new Set(IMPORT_LIMIT_REGISTRY.map((e) => e.kind));
        expect(kinds.has('ROUTING')).toBe(true);
        expect(kinds.has('SAFETY')).toBe(true);
        expect(kinds.has('OPERATION')).toBe(true);
    });

    it('exposes materialize vs stored soft ceilings', () => {
        expect(MATERIALIZE_FEATURE_LIMIT).toBe(250_000);
        expect(STORED_FEATURE_SOFT_LIMIT).toBe(1_000_000);
        expect(getLimitEntry('MATERIALIZE_FEATURE_LIMIT')?.kind).toBe('OPERATION');
        expect(getLimitEntry('STORED_FEATURE_SOFT_LIMIT')?.kind).toBe('ROUTING');
        expect(getLimitEntry('SOURCE_OPEN_MAX_BYTES')?.kind).toBe('SAFETY');
    });
});
