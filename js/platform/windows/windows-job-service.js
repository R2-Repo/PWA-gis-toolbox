/**
 * Windows job service placeholder for long-running native work.
 */

/** @returns {import('../contracts.js').JobService} */
export function createWindowsJobService() {
    return {
        async start({ operation }) {
            throw new Error(
                `Windows job service cannot start "${operation}" yet. ` +
                'Job infrastructure lands in a later phase.'
            );
        }
    };
}
