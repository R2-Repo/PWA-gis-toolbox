/**
 * Windows compute provider placeholder.
 * Native Python/GPU ops will register here in later phases.
 */

/** @returns {import('../contracts.js').ComputeService} */
export function createWindowsComputeService() {
    return {
        async run(operation) {
            throw new Error(
                `Windows compute provider has no handler for "${operation}" yet. ` +
                'Python/GPU sidecars are not packaged in this build.'
            );
        }
    };
}
