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

export { WORKER_CAPABLE_NODE_TYPES } from './node-compute-registry.js';
