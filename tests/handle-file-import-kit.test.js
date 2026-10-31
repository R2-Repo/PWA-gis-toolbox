/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { importProjectKitMock } = vi.hoisted(() => ({
    importProjectKitMock: vi.fn()
}));

vi.mock('../js/import/project-kit-file-import.js', () => ({
    importProjectKitFromFile: (...args) => importProjectKitMock(...args)
}));

describe('handleFileImport kit-only imports', () => {
    beforeEach(() => {
        importProjectKitMock.mockReset();
    });

    it('does not call onComplete until importProjectKit resolves', async () => {
        let resolveImport;
        const importDone = new Promise((resolve) => {
            resolveImport = resolve;
        });
        importProjectKitMock.mockReturnValue(importDone);

        const onComplete = vi.fn();
        const kitFile = new File(['kit'], 'project.gis-toolbox', { type: 'application/octet-stream' });

        const { handleFileImport } = await import('../js/tools/tool-handlers.js');
        const importPromise = handleFileImport([kitFile], null, { onComplete });

        await Promise.resolve();
        expect(onComplete).not.toHaveBeenCalled();
        expect(importProjectKitMock).toHaveBeenCalledTimes(1);

        resolveImport(undefined);
        await importPromise;

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('does not call onComplete when importProjectKit throws', async () => {
        importProjectKitMock.mockRejectedValue(new Error('kit failed'));

        const onComplete = vi.fn();
        const kitFile = new File(['kit'], 'project.gis-toolbox', { type: 'application/octet-stream' });

        const { handleFileImport } = await import('../js/tools/tool-handlers.js');
        await handleFileImport([kitFile], null, { onComplete });

        expect(onComplete).not.toHaveBeenCalled();
    });
});
