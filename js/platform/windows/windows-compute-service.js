import { NATIVE_OPERATIONS, isKnownNativeOperation } from '../jobs/allowed-operations.js';
import { JobCanceledError, isJobCanceledError } from '../jobs/job-errors.js';

/**
 * Windows compute provider — routes allow-listed operations through the job service.
 *
 * @param {import('../contracts.js').JobService} jobs
 * @returns {import('../contracts.js').ComputeService}
 */
export function createWindowsComputeService(jobs) {
    return {
        async run(operation, input, opts = {}) {
            if (!isKnownNativeOperation(operation)) {
                throw new Error(
                    `Windows compute provider has no handler for "${operation}". ` +
                    `Known operations: ${Object.values(NATIVE_OPERATIONS).join(', ')}`
                );
            }

            const job = await jobs.start({ operation, input });

            if (typeof opts.onProgress === 'function') {
                job.onProgress(opts.onProgress);
            }

            const onAbort = () => job.cancel();
            if (opts.signal) {
                if (opts.signal.aborted) {
                    job.cancel();
                    throw new JobCanceledError();
                }
                opts.signal.addEventListener('abort', onAbort, { once: true });
            }

            try {
                return await job.result;
            } catch (err) {
                if (isJobCanceledError(err)) throw new JobCanceledError(err.message);
                throw err;
            } finally {
                if (opts.signal) {
                    opts.signal.removeEventListener('abort', onAbort);
                }
            }
        }
    };
}
