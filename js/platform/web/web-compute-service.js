/** Web compute provider. */

/** @returns {import('../contracts.js').ComputeService} */
export function createWebComputeService() {
    return {
        async run(operation) {
            throw new Error(
                `Web compute provider has no handler for operation "${operation}". ` +
                'No browser implementation is registered for this operation.'
            );
        }
    };
}
