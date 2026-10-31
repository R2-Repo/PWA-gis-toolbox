/**
 * Main-thread client for workflow compute worker (cancel, terminate fallback, respawn).
 */
import { WORKFLOW_WORKER_MSG, WORKER_CAPABLE_NODE_TYPES } from './worker/workflow-worker-protocol.js';
import { runNodeCompute } from './worker/node-compute-registry.js';
import { throwIfAborted } from './workflow-run-helpers.js';
import BuiltinWorkflowWorker from './worker/workflow-worker.js?worker';

const TERMINATE_GRACE_MS = 400;
let __terminateGraceMs = TERMINATE_GRACE_MS;

/** @type {typeof Worker | null} */
let WorkerCtor = typeof Worker !== 'undefined' ? Worker : null;
/** When set (tests), replaces BuiltinWorkflowWorker factory. */
let WorkerFactoryOverride = null;

export function __setWorkflowWorkerConstructorForTests(ctor) {
    WorkerFactoryOverride = ctor || null;
    WorkerCtor = ctor ?? (typeof Worker !== 'undefined' ? Worker : null);
}

export function __setWorkflowWorkerTerminateGraceMsForTests(ms) {
    if (typeof ms === 'number' && ms >= 0) {
        __terminateGraceMs = ms;
    }
}

export function isWorkerRuntimeSupported() {
    return WorkerCtor != null;
}

export function nodeRunsInWorker(node) {
    if (!node || !WORKER_CAPABLE_NODE_TYPES.has(node.type)) return false;
    if (node.runsInWorker === false) return false;
    if (node.runsInWorker === true) return true;
    return true;
}

export class WorkflowWorkerClient {
    constructor() {
        /** @type {Worker | null} */
        this._worker = null;
        this._workerBroken = false;
        /** @type {Map<string, { resolve, reject, onProgress, externalSignal, abortListener, terminateTimer }>} */
        this._pending = new Map();
        this._readyPromise = null;
    }

    _workerUrl() {
        return new URL('./worker/workflow-worker.js', import.meta.url);
    }

    _spawnWorker() {
        if (this._workerBroken) return null;
        if (!WorkerFactoryOverride && !WorkerCtor && typeof Worker === 'undefined') return null;
        try {
            const worker = WorkerFactoryOverride
                ? new WorkerFactoryOverride(this._workerUrl(), { type: 'module' })
                : new BuiltinWorkflowWorker();
            this._readyPromise = new Promise((resolve, reject) => {
                let readyResolved = false;
                const markReady = () => {
                    if (readyResolved) return;
                    readyResolved = true;
                    resolve();
                };

                if (typeof worker.addEventListener === 'function') {
                    const onReady = (event) => {
                        if (event.data?.type === WORKFLOW_WORKER_MSG.READY) {
                            worker.removeEventListener('message', onReady);
                            markReady();
                        }
                    };
                    worker.addEventListener('message', onReady);
                    worker.addEventListener('error', (err) => reject(err), { once: true });
                }

                worker.onmessage = (event) => {
                    if (event.data?.type === WORKFLOW_WORKER_MSG.READY) {
                        markReady();
                    }
                    this._onWorkerMessage(event.data);
                };
            });
            worker.onerror = () => {
                this._failAllPending(new Error('Workflow worker crashed'));
                this._terminateWorkerSilently();
                this._workerBroken = true;
            };
            this._worker = worker;
            return worker;
        } catch {
            this._workerBroken = true;
            return null;
        }
    }

    async _ensureWorker() {
        if (this._workerBroken) return null;
        if (!this._worker) {
            if (!this._spawnWorker()) return null;
        }
        try {
            await this._readyPromise;
        } catch {
            this._workerBroken = true;
            this._terminateWorkerSilently();
            return null;
        }
        return this._worker;
    }

    _terminateWorkerSilently() {
        if (this._worker) {
            try {
                this._worker.terminate();
            } catch { /* ignore */ }
        }
        this._worker = null;
        this._readyPromise = null;
    }

    /** @internal test hook */
    resetForTests() {
        this._failAllPending(new Error('Workflow worker reset'));
        this._terminateWorkerSilently();
        this._workerBroken = false;
    }

    _failAllPending(err) {
        for (const [requestId, pending] of this._pending) {
            clearTimeout(pending.terminateTimer);
            pending.externalSignal?.removeEventListener('abort', pending.abortListener);
            this._pending.delete(requestId);
            pending.reject(err);
        }
    }

    _onWorkerMessage(data) {
        const { requestId, type } = data || {};
        if (!requestId) return;
        const pending = this._pending.get(requestId);
        if (!pending) return;

        if (type === WORKFLOW_WORKER_MSG.PROGRESS) {
            pending.onProgress?.({
                progress: data.progress,
                processed: data.processed,
                total: data.total,
                message: data.message
            });
            return;
        }

        if (type === WORKFLOW_WORKER_MSG.DONE) {
            clearTimeout(pending.terminateTimer);
            pending.externalSignal?.removeEventListener('abort', pending.abortListener);
            this._pending.delete(requestId);
            pending.resolve(data.result);
            return;
        }

        if (type === WORKFLOW_WORKER_MSG.ERROR) {
            clearTimeout(pending.terminateTimer);
            pending.externalSignal?.removeEventListener('abort', pending.abortListener);
            this._pending.delete(requestId);
            if (data.name === 'AbortError') {
                pending.reject(new DOMException(data.error || 'Workflow run cancelled', 'AbortError'));
            } else {
                pending.reject(new Error(data.error || 'Worker node failed'));
            }
        }
    }

    /**
     * @param {object} opts
     * @param {string} opts.nodeType
     * @param {object} opts.config
     * @param {object[]} opts.inputs
     * @param {AbortSignal} [opts.signal]
     * @param {(update: object) => void} [opts.reportProgress]
     */
    async runNode(opts) {
        const worker = await this._ensureWorker();
        if (!worker) {
            return this._runOnMainThread(opts);
        }

        const requestId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        throwIfAborted(opts.signal);

        return new Promise((resolve, reject) => {
            const abortListener = () => {
                try {
                    worker.postMessage({ type: WORKFLOW_WORKER_MSG.CANCEL, requestId });
                } catch { /* ignore */ }

                const terminateTimer = setTimeout(() => {
                    if (!this._pending.has(requestId)) return;
                    this._pending.delete(requestId);
                    this._terminateWorkerSilently();
                    this._spawnWorker();
                    reject(new DOMException('Workflow run cancelled', 'AbortError'));
                }, __terminateGraceMs);

                const pending = this._pending.get(requestId);
                if (pending) pending.terminateTimer = terminateTimer;
            };

            if (opts.signal?.aborted) {
                reject(new DOMException('Workflow run cancelled', 'AbortError'));
                return;
            }

            opts.signal?.addEventListener('abort', abortListener, { once: true });

            this._pending.set(requestId, {
                resolve,
                reject,
                onProgress: opts.reportProgress,
                externalSignal: opts.signal,
                abortListener,
                terminateTimer: null
            });

            try {
                worker.postMessage({
                    type: WORKFLOW_WORKER_MSG.RUN,
                    requestId,
                    nodeType: opts.nodeType,
                    config: opts.config,
                    inputs: opts.inputs
                });
            } catch (err) {
                this._pending.delete(requestId);
                opts.signal?.removeEventListener('abort', abortListener);
                this._workerBroken = true;
                this._terminateWorkerSilently();
                this._runOnMainThread(opts).then(resolve, reject);
            }
        });
    }

    async _runOnMainThread(opts) {
        throwIfAborted(opts.signal);
        const context = {
            signal: opts.signal,
            reportProgress: opts.reportProgress
        };
        return runNodeCompute(opts.nodeType, opts.inputs, opts.config || {}, context);
    }
}

/** Shared client for pipeline runs. */
export const workflowWorkerClient = new WorkflowWorkerClient();

/**
 * Execute a worker-capable node (worker when available, else main-thread compute).
 */
export async function executeWorkerCapableNode(node, inputs, context) {
    if (!nodeRunsInWorker(node)) {
        return node.execute(inputs, context);
    }
    return workflowWorkerClient.runNode({
        nodeType: node.type,
        config: node.config,
        inputs,
        signal: context?.signal,
        reportProgress: context?.reportProgress
    });
}
