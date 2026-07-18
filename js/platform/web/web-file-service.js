/**
 * Browser file service stubs. Desktop will replace these with native dialogs.
 * Existing import/export paths continue to use the browser File API directly.
 */

/** @returns {import('../contracts.js').FileService} */
export function createWebFileService() {
    return {
        async open() {
            return { canceled: true };
        },
        async save() {
            return { canceled: true };
        },
        async selectFolder() {
            return { canceled: true };
        },
        async revealInExplorer() {
            // Not available in the browser.
        },
        async writeTempGeoJson() {
            throw new Error('Temporary GeoJSON materialization requires the Windows desktop application.');
        },
        async removeTempFile() {
            // No-op in the browser.
        }
    };
}
