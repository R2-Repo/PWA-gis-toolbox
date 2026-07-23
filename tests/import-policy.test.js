import { describe, expect, it } from 'vitest';
import {
    canUseDesktopPathImport,
    classifyImportFiles,
    exceedsBrowserImportStrongLimit,
    getNativeFilePath,
    shouldRouteFileViaDesktopPath
} from '../js/import/import-policy.js';
import { TEXT_STRONG_BYTES } from '../js/import/import-preflight.js';

function fakeFile(name, size, path = null) {
    const file = { name, size };
    if (path) file.path = path;
    return file;
}

const webPlatform = {
    runtime: 'web',
    os: 'browser',
    capabilities: {
        nativeFiles: { available: false },
        largeDatasetProcessing: { available: false }
    }
};

const desktopReady = {
    runtime: 'windows',
    os: 'windows',
    capabilities: {
        nativeFiles: { available: true },
        largeDatasetProcessing: { available: true }
    }
};

describe('import-policy', () => {
    it('does not enable desktop path import on web', () => {
        expect(canUseDesktopPathImport(webPlatform)).toBe(false);
        expect(canUseDesktopPathImport(null)).toBe(false);
    });

    it('enables desktop path import when windows + caps are available', () => {
        expect(canUseDesktopPathImport(desktopReady)).toBe(true);
    });

    it('reads native path from File-like objects', () => {
        expect(getNativeFilePath(fakeFile('a.geojson', 10, 'C:\\\\data\\\\a.geojson'))).toBe(
            'C:\\\\data\\\\a.geojson'
        );
        expect(getNativeFilePath(fakeFile('a.geojson', 10))).toBeNull();
    });

    it('keeps large files on the memory path for PWA (reject later via preflight)', () => {
        const big = fakeFile('big.geojson', TEXT_STRONG_BYTES + 1, 'C:\\\\big.geojson');
        expect(exceedsBrowserImportStrongLimit(big)).toBe(true);
        expect(shouldRouteFileViaDesktopPath(big, webPlatform)).toBe(false);
        const classified = classifyImportFiles([big], webPlatform);
        expect(classified.memoryFiles).toHaveLength(1);
        expect(classified.pathFiles).toHaveLength(0);
    });

    it('routes large files with paths to desktop path import', () => {
        const big = fakeFile('big.geojson', TEXT_STRONG_BYTES + 1, 'C:\\\\data\\\\big.geojson');
        expect(shouldRouteFileViaDesktopPath(big, desktopReady)).toBe(true);
        const classified = classifyImportFiles([big], desktopReady);
        expect(classified.pathFiles).toHaveLength(1);
        expect(classified.pathFiles[0].path).toBe('C:\\\\data\\\\big.geojson');
        expect(classified.memoryFiles).toHaveLength(0);
    });

    it('blocks large desktop files without a path', () => {
        const big = fakeFile('big.geojson', TEXT_STRONG_BYTES + 1);
        const classified = classifyImportFiles([big], desktopReady);
        expect(classified.blockedLargeNoPath).toHaveLength(1);
        expect(classified.pathFiles).toHaveLength(0);
        expect(classified.memoryFiles).toHaveLength(0);
    });

    it('keeps small desktop files on the in-memory import path', () => {
        const small = fakeFile('small.geojson', 1024, 'C:\\\\small.geojson');
        const classified = classifyImportFiles([small], desktopReady);
        expect(classified.memoryFiles).toHaveLength(1);
        expect(classified.pathFiles).toHaveLength(0);
    });
});
