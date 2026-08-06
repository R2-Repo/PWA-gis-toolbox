/**
 * Shared job handle factory for browser platform jobs.
 */

/**
 * @typedef {Object} JobRunnerContext
 * @property {AbortSignal} signal
 * @property {(progress: { percent?: number, stage?: string, message?: string }) => void} onProgress
 * @property {(message: string) => void} onLog
 */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.operation
 * @param {(ctx: JobRunnerContext) => Promise<unknown>} opts.run
 * @returns {import('../contracts.js').JobHandle}
 */
export function createJobHandle({ id, operation, run }) {
    /** @type {Array<(progress: object) => void>} */
    const progressListeners = [];
    /** @type {Array<(message: string) => void>} */
    const logListeners = [];
    const controller = new AbortController();
    let settled = false;

    const result = Promise.resolve()
        .then(() => run({
            signal: controller.signal,
            onProgress: (progress) => {
                progressListeners.forEach((cb) => {
                    try { cb(progress); } catch { /* ignore listener errors */ }
                });
            },
            onLog: (message) => {
                logListeners.forEach((cb) => {
                    try { cb(String(message)); } catch { /* ignore listener errors */ }
                });
            }
        }))
        .finally(() => {
            settled = true;
        });

    return {
        id,
        operation,
        onProgress(cb) {
            if (typeof cb === 'function') progressListeners.push(cb);
        },
        onLog(cb) {
            if (typeof cb === 'function') logListeners.push(cb);
        },
        cancel() {
            if (!settled && !controller.signal.aborted) {
                controller.abort();
            }
        },
        result
    };
}

let jobSeq = 0;

/** @returns {string} */
export function nextJobId(prefix = 'job') {
    jobSeq += 1;
    return `${prefix}-${Date.now()}-${jobSeq}`;
}
