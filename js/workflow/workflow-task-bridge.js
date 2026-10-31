/**
 * Bridges workflow run context (AbortSignal + reportProgress) to TaskRunner GIS tools.
 */
import bus from '../core/event-bus.js';
import { getActiveTask } from '../core/task-runner.js';
import { throwIfAborted } from './workflow-run-helpers.js';

const PROGRESS_MIN_INTERVAL_MS = 100;
const ABORT_POLL_MS = 50;

function forwardTaskProgress(context) {
    if (!context?.reportProgress) return () => {};

    let lastAt = 0;
    return bus.on('task:progress', (evt) => {
        const now = performance.now();
        const pct = evt.percent ?? 0;
        if (pct < 100 && now - lastAt < PROGRESS_MIN_INTERVAL_MS) return;
        lastAt = now;
        context.reportProgress({
            progress: pct / 100,
            processed: evt.current,
            total: evt.total,
            message: evt.step
        });
    });
}

function bindAbortToActiveTask(signal) {
    if (!signal) return () => {};
    const onAbort = () => {
        getActiveTask()?.cancel();
    };
    signal.addEventListener('abort', onAbort);
    return () => signal.removeEventListener('abort', onAbort);
}

function waitWithAbortPolling(signal, promise) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
            if (signal.aborted) {
                clearInterval(timer);
                getActiveTask()?.cancel();
                reject(new DOMException('Workflow run cancelled', 'AbortError'));
            }
        }, ABORT_POLL_MS);

        Promise.resolve(promise).then(
            (value) => {
                clearInterval(timer);
                if (signal.aborted) {
                    reject(new DOMException('Workflow run cancelled', 'AbortError'));
                    return;
                }
                resolve(value);
            },
            (err) => {
                clearInterval(timer);
                reject(err);
            }
        );
    });
}

/**
 * Run a GIS tool (or any async fn) under workflow cancel/progress reporting.
 * @param {object} context workflow execute context
 * @param {() => Promise<*>} fn
 */
export async function runWithWorkflowContext(context, fn) {
    throwIfAborted(context?.signal);
    const unbindAbort = bindAbortToActiveTask(context?.signal);
    const unsubProgress = forwardTaskProgress(context);
    try {
        const result = await waitWithAbortPolling(context?.signal, fn());
        throwIfAborted(context?.signal);
        if (result == null && context?.signal?.aborted) {
            throw new DOMException('Workflow run cancelled', 'AbortError');
        }
        return result;
    } catch (err) {
        if (err?.cancelled || err?.message === 'Operation cancelled') {
            throw new DOMException('Workflow run cancelled', 'AbortError');
        }
        throw err;
    } finally {
        unsubProgress();
        unbindAbort();
    }
}
