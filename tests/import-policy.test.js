import { describe, expect, it } from 'vitest';
import {
    classifyImportFiles,
    exceedsBrowserImportStrongLimit
} from '../js/import/import-policy.js';
import { TEXT_STRONG_BYTES } from '../js/import/import-preflight.js';

function fakeFile(name, size) {
    return { name, size };
}

describe('import-policy', () => {
    it('keeps large files on the memory path for PWA (reject later via preflight)', () => {
        const big = fakeFile('big.geojson', TEXT_STRONG_BYTES + 1);
        expect(exceedsBrowserImportStrongLimit(big)).toBe(true);
        const classified = classifyImportFiles([big]);
        expect(classified.memoryFiles).toHaveLength(1);
    });

    it('keeps small files on the in-memory import path', () => {
        const small = fakeFile('small.geojson', 1024);
        const classified = classifyImportFiles([small]);
        expect(classified.memoryFiles).toHaveLength(1);
    });
});
