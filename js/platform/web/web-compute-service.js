/**
 * Web compute provider. Shared widgets that need acceleration can later
 * branch through this contract; native Windows ops live in js/platform/windows/.
 */

/** @returns {import('../contracts.js').ComputeService} */
export function createWebComputeService() {
    return {
        async run(operation) {
            throw new Error(
                `Web compute provider has no handler for operation "${operation}". ` +
                'This operation requires the Windows desktop application.'
            );
        }
    };
}
