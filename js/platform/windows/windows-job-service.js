import { invokeCommand, listenEvent } from './tauri-bridge.js';
import { createJobHandle, nextJobId } from '../jobs/create-job-handle.js';
import { isKnownNativeOperation } from '../jobs/allowed-operations.js';
import { JobCanceledError, JobFailedError } from '../jobs/job-errors.js';

/**
 * Windows job service — starts native jobs in the Tauri/Rust shell and streams
 * progress/log/result events back to the frontend.
 *
 * @returns {import('../contracts.js').JobService}
 */
export function createWindowsJobService() {
    return {
        async start({ operation, input }) {
            if (!isKnownNativeOperation(operation)) {
                throw new JobFailedError(
                    `Unknown native operation "${operation}"`,
                    { operation }
                );
            }

            const jobId = nextJobId('win');

            return createJobHandle({
                id: jobId,
                operation,
                async run(ctx) {
                    const { promise, ready } = createNativeJobWaiter(jobId, ctx);
                    await ready;
                    await invokeCommand('job_start', {
                        request: {
                            clientJobId: jobId,
                            operation,
                            input: input ?? {}
                        }
                    });
                    return promise;
                }
            });
        }
    };
}

/**
 * @param {string} jobId
 * @param {import('../jobs/create-job-handle.js').JobRunnerContext} ctx
 */
function createNativeJobWaiter(jobId, ctx) {
    const unlistenFns = [];
    let settleReady;
    const ready = new Promise((resolve) => { settleReady = resolve; });

    const cleanup = async () => {
        while (unlistenFns.length) {
            const off = unlistenFns.pop();
            try { await off(); } catch { /* ignore */ }
        }
    };

    const promise = new Promise((resolve, reject) => {
        let settled = false;

        const settle = async (fn) => {
            if (settled) return;
            settled = true;
            ctx.signal.removeEventListener('abort', onAbort);
            await cleanup();
            fn();
        };

        const onAbort = () => {
            void invokeCommand('job_cancel', { jobId }).catch(() => {});
            void settle(() => reject(new JobCanceledError(`Job ${jobId} canceled`)));
        };

        if (ctx.signal.aborted) {
            onAbort();
            settleReady();
            return;
        }
        ctx.signal.addEventListener('abort', onAbort, { once: true });

        Promise.all([
            listenEvent('sidecar-job-progress', (event) => {
                const payload = event.payload || {};
                if (payload.jobId !== jobId) return;
                ctx.onProgress({
                    percent: payload.percent,
                    stage: payload.stage,
                    message: payload.message
                });
            }),
            listenEvent('sidecar-job-log', (event) => {
                const payload = event.payload || {};
                if (payload.jobId !== jobId) return;
                if (payload.message) ctx.onLog(payload.message);
            }),
            listenEvent('sidecar-job-finished', (event) => {
                const payload = event.payload || {};
                if (payload.jobId !== jobId) return;
                if (payload.canceled) {
                    void settle(() => reject(new JobCanceledError(payload.message || `Job ${jobId} canceled`)));
                    return;
                }
                if (payload.ok) {
                    void settle(() => resolve(payload.output));
                    return;
                }
                void settle(() => reject(new JobFailedError(
                    payload.message || `Job ${jobId} failed`,
                    { operation: payload.operation, details: payload.details }
                )));
            })
        ]).then((offs) => {
            unlistenFns.push(...offs);
            settleReady();
        }).catch((err) => {
            settleReady();
            void settle(() => reject(err));
        });
    });

    return { promise, ready };
}
