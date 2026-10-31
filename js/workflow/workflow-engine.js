/**
 * Workflow Engine — topological sort + sequential execution of the node graph
 */
import { bus } from '../core/event-bus.js';
import logger from '../core/logger.js';
import { throwIfAborted } from './workflow-run-helpers.js';

/** @typedef {'queued'|'running'|'progress'|'done'|'error'|'skipped'|'cancelled'} WorkflowNodeRunStatus */

/**
 * @typedef {object} WorkflowRunNodeEvent
 * @property {'node'} type
 * @property {WorkflowNodeRunStatus} status
 * @property {string} nodeId
 * @property {number} [progress]
 * @property {number} [processed]
 * @property {number} [total]
 * @property {string} [message]
 * @property {string} [error]
 * @property {number} [durationMs]
 * @property {number} [featureCount]
 * @property {number} [rowCount]
 */

/**
 * @typedef {object} WorkflowRunPipelineEvent
 * @property {'run'} type
 * @property {'start'|'done'|'cancelled'} status
 * @property {boolean} [success]
 * @property {string} [overallStatus]
 * @property {string} [error]
 */

/** @typedef {WorkflowRunNodeEvent | WorkflowRunPipelineEvent} WorkflowRunEvent */

export class WorkflowEngine {
    constructor() {
        this.nodes = new Map();   // id → node
        this.wires = [];          // [{ from, fromPort, to, toPort }]
        this._running = false;
        /** @type {Set<(evt: WorkflowRunEvent) => void>} */
        this._runSubscribers = new Set();
        /** @type {AbortController | null} */
        this._runAbortController = null;
    }

    /** Subscribe to fine-grained run events. Returns unsubscribe. */
    subscribeRunEvents(handler) {
        this._runSubscribers.add(handler);
        return () => this._runSubscribers.delete(handler);
    }

    /** Request cancellation of the active run (no-op if idle). */
    cancel() {
        this._runAbortController?.abort();
    }

    _emitRunEvent(event) {
        for (const handler of this._runSubscribers) {
            try {
                handler(event);
            } catch (err) {
                logger.error('Workflow', 'Run event handler failed', { error: err?.message });
            }
        }
        bus.emit('workflow:run-event', event);
    }

    // ── Graph manipulation ──

    addNode(node) {
        this.nodes.set(node.id, node);
    }

    removeNode(id) {
        this.nodes.delete(id);
        this.wires = this.wires.filter(w => w.from !== id && w.to !== id);
    }

    addWire(wire) {
        const dup = this.wires.find(w =>
            w.from === wire.from && w.fromPort === wire.fromPort &&
            w.to === wire.to && w.toPort === wire.toPort
        );
        if (dup) return false;

        if (this._wouldCycle(wire.from, wire.to)) return false;

        this.wires.push(wire);
        return true;
    }

    removeWire(wire) {
        this.wires = this.wires.filter(w =>
            !(w.from === wire.from && w.fromPort === wire.fromPort &&
              w.to === wire.to && w.toPort === wire.toPort)
        );
    }

    removeWiresForPort(nodeId, portId, direction) {
        this.wires = this.wires.filter(w => {
            if (direction === 'input') return !(w.to === nodeId && w.toPort === portId);
            return !(w.from === nodeId && w.fromPort === portId);
        });
    }

    getIncomingWires(nodeId) {
        return this.wires.filter(w => w.to === nodeId);
    }

    getOutgoingWires(nodeId) {
        return this.wires.filter(w => w.from === nodeId);
    }

    isUpstreamOf(nodeId, candidateId, visited = new Set()) {
        if (visited.has(nodeId)) return false;
        visited.add(nodeId);
        const incoming = this.getIncomingWires(nodeId);
        for (const w of incoming) {
            if (w.from === candidateId) return true;
            if (this.isUpstreamOf(w.from, candidateId, visited)) return true;
        }
        return false;
    }

    _sourceOutputData(srcNode, fromPort) {
        if (!srcNode) return null;
        if (srcNode._outputPorts && fromPort in srcNode._outputPorts) {
            return srcNode._outputPorts[fromPort];
        }
        return srcNode._outputData ?? null;
    }

    getUpstreamOutput(nodeId, context) {
        const incoming = this.getIncomingWires(nodeId);
        if (incoming.length === 0) return null;

        for (const w of incoming) {
            const srcNode = this.nodes.get(w.from);
            if (!srcNode) continue;
            const out = this._sourceOutputData(srcNode, w.fromPort);
            if (out) return out;
            if (context) {
                const preview = srcNode.getOutputPreview?.(context);
                if (preview) return preview;
            }
        }

        const first = this.nodes.get(incoming[0].from);
        if (first && context) {
            return this.getUpstreamOutput(first.id, context);
        }
        return null;
    }

    getUpstreamOutputForPort(nodeId, portId, context) {
        const wire = this.wires.find(w => w.to === nodeId && w.toPort === portId);
        if (!wire) return null;
        const srcNode = this.nodes.get(wire.from);
        if (!srcNode) return null;
        const out = this._sourceOutputData(srcNode, wire.fromPort);
        if (out) return out;
        if (context) {
            const preview = srcNode.getOutputPreview?.(context);
            if (preview) return preview;
            return this.getUpstreamOutput(srcNode.id, context);
        }
        return null;
    }

    _topoSort() {
        const inDeg = new Map();
        const adj = new Map();

        for (const id of this.nodes.keys()) {
            inDeg.set(id, 0);
            adj.set(id, []);
        }

        for (const w of this.wires) {
            if (!this.nodes.has(w.from) || !this.nodes.has(w.to)) continue;
            adj.get(w.from).push(w.to);
            inDeg.set(w.to, (inDeg.get(w.to) || 0) + 1);
        }

        const queue = [];
        for (const [id, deg] of inDeg) {
            if (deg === 0) queue.push(id);
        }

        const sorted = [];
        while (queue.length > 0) {
            const id = queue.shift();
            sorted.push(id);
            for (const next of adj.get(id)) {
                inDeg.set(next, inDeg.get(next) - 1);
                if (inDeg.get(next) === 0) queue.push(next);
            }
        }

        if (sorted.length !== this.nodes.size) {
            throw new Error('Cycle detected in workflow graph');
        }
        return sorted;
    }

    _wouldCycle(fromId, toId) {
        const visited = new Set();
        const stack = [toId];
        while (stack.length > 0) {
            const cur = stack.pop();
            if (cur === fromId) return true;
            if (visited.has(cur)) continue;
            visited.add(cur);
            for (const w of this.wires) {
                if (w.from === cur) stack.push(w.to);
            }
        }
        return false;
    }

    _resetNodeRunState(node) {
        node._outputData = null;
        node._outputPorts = null;
        node._error = null;
        node._running = false;
        node._runStatus = 'queued';
        node._skipReason = null;
        node._runDurationMs = null;
    }

    _skipReasonForNode(nodeId) {
        const incoming = this.getIncomingWires(nodeId);
        if (incoming.length === 0) return null;

        for (const w of incoming) {
            const src = this.nodes.get(w.from);
            if (!src) return 'Upstream node missing';
            const st = src._runStatus;
            if (st === 'error') {
                return src._error
                    ? `Upstream "${src.name}" failed: ${src._error}`
                    : `Upstream "${src.name}" failed`;
            }
            if (st === 'skipped') {
                return src._skipReason || `Upstream "${src.name}" was skipped`;
            }
            if (st === 'cancelled') return 'Pipeline run cancelled';
            if (st !== 'done') {
                return `Upstream "${src.name}" did not complete (${st || 'pending'})`;
            }
            if (!this._sourceOutputData(src, w.fromPort)) {
                return `Upstream "${src.name}" produced no output`;
            }
        }
        return null;
    }

    _countOutputRows(data) {
        if (!data) return { featureCount: 0, rowCount: 0 };
        if (data.type === 'spatial') {
            return { featureCount: data.geojson?.features?.length ?? 0, rowCount: 0 };
        }
        if (data.type === 'table') {
            return { featureCount: 0, rowCount: data.rows?.length ?? 0 };
        }
        return { featureCount: 0, rowCount: 0 };
    }

    _markNodeSkipped(node, reason) {
        node._runStatus = 'skipped';
        node._skipReason = reason;
        node._error = null;
        node._running = false;
        this._emitRunEvent({
            type: 'node',
            status: 'skipped',
            nodeId: node.id,
            message: reason
        });
        bus.emit('workflow:node-done', { nodeId: node.id, success: false, skipped: true, reason });
    }

    _markNodeCancelled(node) {
        node._runStatus = 'cancelled';
        node._skipReason = 'Pipeline run cancelled';
        node._running = false;
        this._emitRunEvent({
            type: 'node',
            status: 'cancelled',
            nodeId: node.id,
            message: node._skipReason
        });
    }

    /**
     * @param {object} context
     * @param {{ signal?: AbortSignal }} [options]
     */
    async run(context, options = {}) {
        if (this._running) throw new Error('Pipeline already running');
        this._running = true;

        const externalSignal = options.signal;
        this._runAbortController = externalSignal
            ? null
            : new AbortController();
        const signal = externalSignal ?? this._runAbortController.signal;

        for (const node of this.nodes.values()) {
            this._resetNodeRunState(node);
        }

        bus.emit('workflow:run-start');
        this._emitRunEvent({ type: 'run', status: 'start' });
        const pipelineTimer = logger.timed('Workflow', 'Pipeline run');
        logger.info('Workflow', 'Pipeline started', { nodes: this.nodes.size, wires: this.wires.length });

        let overallStatus = 'success';
        let pipelineError = null;
        let hadNodeError = false;
        let cancelled = false;

        try {
            const order = this._topoSort();

            for (let i = 0; i < order.length; i++) {
                const nodeId = order[i];
                const node = this.nodes.get(nodeId);

                if (signal.aborted) {
                    cancelled = true;
                    for (let j = i; j < order.length; j++) {
                        const pending = this.nodes.get(order[j]);
                        if (pending._runStatus === 'queued') {
                            this._markNodeCancelled(pending);
                        }
                    }
                    break;
                }

                const skipReason = this._skipReasonForNode(nodeId);
                if (skipReason) {
                    this._markNodeSkipped(node, skipReason);
                    continue;
                }

                node._runStatus = 'running';
                node._running = true;
                bus.emit('workflow:node-start', { nodeId });
                this._emitRunEvent({ type: 'node', status: 'running', nodeId });
                const nodeTimer = logger.timed('Workflow', `Node: ${node.name}`);
                const startedAt = performance.now();

                try {
                    throwIfAborted(signal);

                    const inputs = node.inputPorts.map(port => {
                        const wire = this.wires.find(w => w.to === nodeId && w.toPort === port.id);
                        if (!wire) return null;
                        const srcNode = this.nodes.get(wire.from);
                        if (!srcNode) return null;
                        return this._sourceOutputData(srcNode, wire.fromPort);
                    });

                    const engineContext = {
                        ...context,
                        signal,
                        reportProgress: (update = {}) => {
                            this._emitRunEvent({
                                type: 'node',
                                status: 'progress',
                                nodeId,
                                progress: update.progress,
                                processed: update.processed,
                                total: update.total,
                                message: update.message
                            });
                        },
                        getUpstreamOutput: (id) => this.getUpstreamOutput(id, context)
                    };

                    const result = await node.execute(inputs, engineContext);
                    throwIfAborted(signal);

                    if (result && result._multiOutput && result.ports) {
                        node._outputPorts = result.ports;
                        const firstPort = node.outputPorts[0];
                        node._outputData = firstPort ? result.ports[firstPort.id] || null : null;
                    } else {
                        node._outputData = result;
                    }
                    node._error = null;
                    node._runStatus = 'done';
                    const durationMs = Math.round(performance.now() - startedAt);
                    node._runDurationMs = durationMs;
                    const counts = this._countOutputRows(node._outputData);
                    nodeTimer.end({ nodeId, type: node.type, success: true });
                    this._emitRunEvent({
                        type: 'node',
                        status: 'done',
                        nodeId,
                        durationMs,
                        ...counts
                    });
                    bus.emit('workflow:node-done', { nodeId, success: true });
                } catch (err) {
                    if (err?.name === 'AbortError' || signal.aborted) {
                        cancelled = true;
                        node._runStatus = 'cancelled';
                        node._skipReason = 'Pipeline run cancelled';
                        node._error = null;
                        this._emitRunEvent({
                            type: 'node',
                            status: 'cancelled',
                            nodeId,
                            message: node._skipReason
                        });
                        for (let j = i + 1; j < order.length; j++) {
                            const pending = this.nodes.get(order[j]);
                            if (pending._runStatus === 'queued') {
                                this._markNodeCancelled(pending);
                            }
                        }
                        break;
                    }

                    node._error = err.message;
                    node._runStatus = 'error';
                    hadNodeError = true;
                    nodeTimer.fail({ nodeId, type: node.type, error: err.message });
                    logger.error('Workflow', 'Node failed', { nodeId, name: node.name, type: node.type, error: err.message });
                    this._emitRunEvent({
                        type: 'node',
                        status: 'error',
                        nodeId,
                        error: err.message
                    });
                    bus.emit('workflow:node-done', { nodeId, success: false, error: err.message });
                } finally {
                    node._running = false;
                }
            }

            if (cancelled) {
                overallStatus = 'cancelled';
            } else if (hadNodeError) {
                const anyDone = [...this.nodes.values()].some(n => n._runStatus === 'done');
                overallStatus = anyDone ? 'partial' : 'failed';
                pipelineError = hadNodeError ? 'One or more nodes failed' : null;
            }

            if (overallStatus === 'success') {
                pipelineTimer.end({ nodes: order.length, success: true });
                bus.emit('workflow:run-done', { success: true, status: overallStatus });
                this._emitRunEvent({ type: 'run', status: 'done', success: true, overallStatus });
            } else if (overallStatus === 'cancelled') {
                pipelineTimer.end({ nodes: order.length, success: false, cancelled: true });
                bus.emit('workflow:run-done', { success: false, status: overallStatus, cancelled: true });
                this._emitRunEvent({ type: 'run', status: 'cancelled', success: false, overallStatus });
            } else {
                pipelineTimer.fail({ success: false, overallStatus });
                bus.emit('workflow:run-done', { success: false, status: overallStatus, error: pipelineError });
                this._emitRunEvent({
                    type: 'run',
                    status: 'done',
                    success: false,
                    overallStatus,
                    error: pipelineError
                });
            }

            return { status: overallStatus, error: pipelineError, cancelled };
        } catch (err) {
            pipelineTimer.fail({ success: false, error: err.message });
            logger.error('Workflow', 'Pipeline failed', { error: err.message });
            bus.emit('workflow:run-done', { success: false, error: err.message, status: 'failed' });
            this._emitRunEvent({
                type: 'run',
                status: 'done',
                success: false,
                overallStatus: 'failed',
                error: err.message
            });
            throw err;
        } finally {
            this._running = false;
            this._runAbortController = null;
        }
    }

    toJSON() {
        return {
            nodes: [...this.nodes.values()].map(n => n.toJSON()),
            wires: this.wires.map(w => ({ ...w }))
        };
    }

    clear() {
        this.nodes.clear();
        this.wires = [];
    }

    get isRunning() { return this._running; }
}
