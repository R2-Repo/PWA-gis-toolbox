import { describe, expect, it } from 'vitest';
import {
    classifyImportFiles,
    exceedsBrowserImportStrongLimit
} from '../js/import/import-policy.js';
import { TEXT_STRONG_BYTES } from '../js/import/import-preflight.js';

function fakeFile(name, size, path = null) {
    const file = { name, size };
    if (path) file.path = path;
    return file;
}

describe('import-policy', () => {
    it('keeps large files on the memory path for PWA (reject later via preflight)', () => {
        const big = fakeFile('big.geojson', TEXT_STRONG_BYTES + 1, 'C:\\\\big.geojson');
        expect(exceedsBrowserImportStrongLimit(big)).toBe(true);
        const classified = classifyImportFiles([big]);
        expect(classified.memoryFiles).toHaveLength(1);
        expect(classified.pathFiles).toHaveLength(0);
        expect(classified.blockedLargeNoPath).toHaveLength(0);
    });

    it('keeps small path-like files on the in-memory import path', () => {
        const small = fakeFile('small.geojson', 1024, 'C:\\\\small.geojson');
        const classified = classifyImportFiles([small]);
        expect(classified.memoryFiles).toHaveLength(1);
        expect(classified.pathFiles).toHaveLength(0);

        const backed = fakeFile('small.geojson', 1024, 'C:\\\\small.geojson');
        backed.__pathBacked = true;
        const classifiedBacked = classifyImportFiles([backed]);
        expect(classifiedBacked.memoryFiles).toHaveLength(1);
        expect(classifiedBacked.pathFiles).toHaveLength(0);
    });
});
