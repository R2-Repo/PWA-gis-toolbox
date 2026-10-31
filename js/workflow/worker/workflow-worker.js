/**
 * Workflow compute Web Worker — runs registered pure node compute handlers.
 */
import { WORKFLOW_WORKER_MSG } from './workflow-worker-protocol.js';
import { runNodeCompute } from './node-compute-registry.js';
import { throwIfAborted } from '../workflow-run-helpers.js';

/** @type {Map<string, AbortController>} */
const activeRuns = new Map();

/**
 * @param {MessageEvent['data']} data
 * @param {(msg: object) => void} post
 */
export function handleWorkflowWorkerMessage(data, post) {
    const type = data?.type;
    if (type === WORKFLOW_WORKER_MSG.CANCEL) {
        const ac = activeRuns.get(data.requestId);
        ac?.abort();
        return;
    }
    if (type !== WORKFLOW_WORKER_MSG.RUN) return;

    const { requestId, nodeType, config, inputs } = data;
    if (!requestId || !nodeType) {
        post({ type: WORKFLOW_WORKER_MSG.ERROR, requestId, error: 'Invalid run message' });
        return;
    }

    const prior = activeRuns.get(requestId);
    prior?.abort();

    const ac = new AbortController();
    activeRuns.set(requestId, ac);

    const context = {
        signal: ac.signal,
        reportProgress: (update = {}) => {
            post({
                type: WORKFLOW_WORKER_MSG.PROGRESS,
                requestId,
                progress: update.progress,
                processed: update.processed,
                total: update.total,
                message: update.message
            });
        }
    };

    Promise.resolve()
        .then(() => {
            throwIfAborted(ac.signal);
            return runNodeCompute(nodeType, inputs, config || {}, context);
        })
        .then((result) => {
            throwIfAborted(ac.signal);
            activeRuns.delete(requestId);
            post({ type: WORKFLOW_WORKER_MSG.DONE, requestId, result });
        })
        .catch((err) => {
            activeRuns.delete(requestId);
            if (err?.name === 'AbortError' || ac.signal.aborted) {
                post({
                    type: WORKFLOW_WORKER_MSG.ERROR,
                    requestId,
                    error: 'Workflow run cancelled',
                    name: 'AbortError'
                });
                return;
            }
            post({
                type: WORKFLOW_WORKER_MSG.ERROR,
                requestId,
                error: err?.message || 'Worker node failed',
                name: err?.name
            });
        });
}

if (typeof self !== 'undefined' && self.postMessage) {
    self.postMessage({ type: WORKFLOW_WORKER_MSG.READY });
    self.onmessage = (event) => {
        handleWorkflowWorkerMessage(event.data, (msg) => self.postMessage(msg));
    };
}
