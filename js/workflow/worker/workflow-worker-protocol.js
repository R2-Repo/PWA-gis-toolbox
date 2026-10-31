/** @typedef {'run'|'cancel'} WorkflowWorkerInboundType */
/** @typedef {'progress'|'done'|'error'|'ready'} WorkflowWorkerOutboundType */

export const WORKFLOW_WORKER_MSG = {
    RUN: 'run',
    CANCEL: 'cancel',
    PROGRESS: 'progress',
    DONE: 'done',
    ERROR: 'error',
    READY: 'ready'
};

/** Node types with worker-side compute registered in Job 6a. */
export const WORKER_CAPABLE_NODE_TYPES = new Set([
    'filter-rows',
    'deduplicate',
    'simplify'
]);
