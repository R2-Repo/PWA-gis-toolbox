/**
 * Browser file service stubs.
 * Existing import/export paths use the browser File API directly.
 */

/** @returns {import('../contracts.js').FileService} */
export function createWebFileService() {
    return {
        async open() {
            return { canceled: true };
        },
        async save() {
            return { canceled: true };
        }
    };
}
