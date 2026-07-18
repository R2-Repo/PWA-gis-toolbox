/**
 * Web job service stub. Long-running native jobs are Windows-only for now.
 */

/** @returns {import('../contracts.js').JobService} */
export function createWebJobService() {
    return {
        async start({ operation }) {
            throw new Error(
                `Web job service cannot start "${operation}". ` +
                'Long-running native jobs require the Windows desktop application.'
            );
        }
    };
}
