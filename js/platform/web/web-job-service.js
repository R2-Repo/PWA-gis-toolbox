import { createJobHandle, nextJobId } from '../jobs/create-job-handle.js';
import { JobCanceledError } from '../jobs/job-errors.js';

/**
 * Web job service.
 * Optional local runners can be registered for tests and browser-safe work.
 *
 * @param {{ runners?: Record<string, (input: unknown, ctx: object) => Promise<unknown>> }} [opts]
 * @returns {import('../contracts.js').JobService}
 */
export function createWebJobService(opts = {}) {
    const runners = opts.runners || {};

    return {
        async start({ operation, input }) {
            const runner = runners[operation];
            if (!runner) {
                throw new Error(
                    `Web job service cannot start "${operation}". ` +
                    'No browser runner is registered for this operation.'
                );
            }

            const id = nextJobId('web');
            return createJobHandle({
                id,
                operation,
                async run(ctx) {
                    if (ctx.signal.aborted) throw new JobCanceledError();
                    const onAbort = () => {};
                    ctx.signal.addEventListener('abort', onAbort, { once: true });
                    try {
                        return await runner(input, ctx);
                    } finally {
                        ctx.signal.removeEventListener('abort', onAbort);
                    }
                }
            });
        }
    };
}
