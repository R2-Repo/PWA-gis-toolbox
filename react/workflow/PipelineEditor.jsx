import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    applyEdgeChanges,
    applyNodeChanges
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import bus from '../../js/core/event-bus.js';
import { findNodeDef } from '../../js/workflow/node-catalog.js';

const PORT_GAP = 20;

function statusBorderColor(data) {
    if (data.error) return '#ef4444';
    switch (data.runStatus) {
        case 'running': return '#3b82f6';
        case 'done': return data.hasOutput ? '#22c55e' : '#6b7280';
        case 'skipped':
        case 'cancelled': return '#9ca3af';
        case 'error': return '#ef4444';
        case 'queued': return data.color;
        default: return data.hasOutput ? '#22c55e' : data.color;
    }
}

function toReactFlowNodes(engine, selectedNodeId = null, getLayers = null) {
    if (!engine?.nodes) return [];
    const layersFn = () => getLayers?.() || [];
    return [...engine.nodes.values()].map((node) => ({
        id: node.id,
        position: node.position || { x: 0, y: 0 },
        selected: node.id === selectedNodeId,
        data: {
            name: `${node.icon || ''} ${node.name || node.type || 'Node'}`.trim(),
            color: node.color || '#555',
            detail: node.getCanvasDetail?.({ getLayers: layersFn }) || '',
            inputPorts: node.inputPorts || [],
            outputPorts: node.outputPorts || [],
            error: node._error || node._skipReason || '',
            running: Boolean(node._running),
            runStatus: node._runStatus || 'queued',
            badge: node.getOutputStats?.() || '',
            hasOutput: Boolean(node._outputData || node._outputPorts)
        },
        type: 'workflowNode'
    }));
}

function toReactFlowEdges(engine) {
    if (!engine?.wires) return [];
    return engine.wires.map((wire) => ({
        id: `${wire.from}|${wire.fromPort}|${wire.to}|${wire.toPort}`,
        source: wire.from,
        target: wire.to,
        sourceHandle: wire.fromPort,
        targetHandle: wire.toPort,
        animated: false,
        data: { wire },
        style: { stroke: 'var(--wf-wire, #8b8b8b)', strokeWidth: 2 }
    }));
}

function WorkflowNode({ data, selected }) {
    const inputPorts = data.inputPorts || [];
    const outputPorts = data.outputPorts || [];
    const maxPorts = Math.max(inputPorts.length, outputPorts.length);
    const height = Math.max(56, 32 + maxPorts * PORT_GAP);

    const borderColor = statusBorderColor(data);
    const footerText = (() => {
        if (data.error) return `⚠ ${data.error}`;
        if (data.running || data.runStatus === 'running') return '⏳ Running…';
        if (data.runStatus === 'skipped') return '⊘ Skipped';
        if (data.runStatus === 'cancelled') return '⊘ Cancelled';
        if (data.runStatus === 'queued') return 'Queued';
        return data.badge || '';
    })();
    const footerColor = data.error ? '#ef4444' : 'var(--text-muted, #b2b2b2)';
    return (
        <div
            style={{
                width: 180,
                minHeight: height,
                borderRadius: 8,
                border: `2px solid ${borderColor}`,
                background: 'var(--wf-node-bg, #151516)',
                boxShadow: selected ? '0 0 0 2px rgba(255,255,255,0.25)' : 'none',
                color: 'var(--text, #fff)'
            }}
        >
            <div
                style={{
                    borderTopLeftRadius: 6,
                    borderTopRightRadius: 6,
                    background: data.color,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '4px 8px'
                }}
            >
                {data.name}
            </div>

            {data.detail ? (
                <div
                    style={{
                        fontSize: 10,
                        color: 'var(--text-muted, #c8c8c8)',
                        padding: '4px 8px 0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}
                    title={data.detail}
                >
                    {data.detail}
                </div>
            ) : null}

            {inputPorts.map((port, index) => (
                <React.Fragment key={`in-${port.id}`}>
                    <Handle
                        type="target"
                        id={port.id}
                        position={Position.Left}
                        style={{ top: 34 + index * PORT_GAP, left: -6, width: 10, height: 10 }}
                    />
                    <div style={{ fontSize: 10, color: 'var(--text-muted, #c8c8c8)', margin: `${8 + index * PORT_GAP}px 8px 0 10px` }}>
                        {port.label}
                    </div>
                </React.Fragment>
            ))}

            {outputPorts.map((port, index) => (
                <React.Fragment key={`out-${port.id}`}>
                    <Handle
                        type="source"
                        id={port.id}
                        position={Position.Right}
                        style={{ top: 34 + index * PORT_GAP, right: -6, width: 10, height: 10 }}
                    />
                    <div
                        style={{
                            position: 'absolute',
                            right: 10,
                            top: 30 + index * PORT_GAP,
                            fontSize: 10,
                            color: 'var(--text-muted, #c8c8c8)'
                        }}
                    >
                        {port.label}
                    </div>
                </React.Fragment>
            ))}

            <div style={{ fontSize: 10, color: footerColor, padding: '6px 8px 8px' }}>
                {footerText}
            </div>
        </div>
    );
}

function PipelineEditorCanvas({ engine, getLayers }) {
    const reactFlow = useReactFlow();
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [selectedEdgeIds, setSelectedEdgeIds] = useState([]);
    const [nodes, setNodes] = useState(() => toReactFlowNodes(engine, null, getLayers));
    const [edges, setEdges] = useState(() => toReactFlowEdges(engine));

    const syncFromEngine = useCallback(() => {
        setNodes(toReactFlowNodes(engine, selectedNodeId, getLayers));
        setEdges(toReactFlowEdges(engine));
    }, [engine, selectedNodeId, getLayers]);

    useEffect(() => {
        syncFromEngine();
    }, [syncFromEngine]);

    useEffect(() => {
        const unsubscribers = [
            bus.on('workflow:engine-changed', syncFromEngine),
            bus.on('workflow:run-start', syncFromEngine),
            bus.on('workflow:node-start', syncFromEngine),
            bus.on('workflow:node-done', syncFromEngine),
            bus.on('workflow:run-done', syncFromEngine),
            bus.on('workflow:run-event', syncFromEngine),
            bus.on('workflow:node-data-ready', syncFromEngine),
            bus.on('workflow:node-selected', ({ nodeId }) => setSelectedNodeId(nodeId || null)),
            bus.on('workflow:node-deselected', () => setSelectedNodeId(null)),
            bus.on('workflow:fit-view', () => {
                queueMicrotask(() => {
                    reactFlow.fitView({ duration: 200, padding: 0.2 });
                });
            }),
            bus.on('workflow:add-node-request', ({ type, clientX, clientY }) => {
                const def = findNodeDef(type);
                if (!def) return;

                const node = def.create();
                const point = Number.isFinite(clientX) && Number.isFinite(clientY)
                    ? (reactFlow.screenToFlowPosition
                        ? reactFlow.screenToFlowPosition({ x: clientX, y: clientY })
                        : reactFlow.project({ x: clientX, y: clientY }))
                    : { x: 100, y: 100 };

                node.position = {
                    x: Math.round(point.x / 20) * 20,
                    y: Math.round(point.y / 20) * 20
                };

                engine.addNode(node);
                setSelectedNodeId(node.id);
                setSelectedEdgeIds([]);
                bus.emit('workflow:node-selected', { nodeId: node.id });
                bus.emit('workflow:engine-changed');
            })
        ];
        return () => {
            unsubscribers.forEach((off) => {
                try { off(); } catch { /* noop */ }
            });
        };
    }, [engine, reactFlow, syncFromEngine]);

    const onNodesChange = useCallback((changes) => {
        setNodes((current) => applyNodeChanges(changes, current));
    }, []);

    const onEdgesChange = useCallback((changes) => {
        setEdges((current) => applyEdgeChanges(changes, current));
    }, []);

    const onNodeDragStop = useCallback((_, node) => {
        const current = engine.nodes.get(node.id);
        if (!current) return;
        current.position = {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y)
        };
        bus.emit('workflow:engine-changed');
    }, [engine]);

    const onConnect = useCallback((connection) => {
        const { source, sourceHandle, target, targetHandle } = connection;
        if (!source || !target || !sourceHandle || !targetHandle || source === target) return;

        const removed = engine.wires.filter((w) => w.to === target && w.toPort === targetHandle);
        engine.removeWiresForPort(target, targetHandle, 'input');
        removed.forEach((wire) => bus.emit('workflow:wire-removed', wire));

        const wire = { from: source, fromPort: sourceHandle, to: target, toPort: targetHandle };
        if (engine.addWire(wire)) {
            bus.emit('workflow:wire-added', wire);
            bus.emit('workflow:engine-changed');
        } else {
            syncFromEngine();
        }
    }, [engine, syncFromEngine]);

    const edgeToWire = useCallback((edge) => {
        if (edge?.data?.wire) return edge.data.wire;
        if (!edge?.id) return null;
        const [from, fromPort, to, toPort] = String(edge.id).split('|');
        if (!from || !fromPort || !to || !toPort) return null;
        return { from, fromPort, to, toPort };
    }, []);

    useEffect(() => {
        const onKeyDown = (event) => {
            const isDelete = event.key === 'Delete' || event.key === 'Backspace';
            if (!isDelete) return;
            const tag = document.activeElement?.tagName;
            const isTypingContext = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
            if (isTypingContext) return;

            let didChange = false;

            if (selectedEdgeIds.length) {
                for (const edgeId of selectedEdgeIds) {
                    const edge = edges.find((e) => e.id === edgeId);
                    const wire = edgeToWire(edge);
                    if (!wire) continue;
                    engine.removeWire(wire);
                    bus.emit('workflow:wire-removed', wire);
                    didChange = true;
                }
            } else if (selectedNodeId) {
                engine.removeNode(selectedNodeId);
                bus.emit('workflow:node-deselected');
                didChange = true;
            }

            if (didChange) {
                event.preventDefault();
                setSelectedNodeId(null);
                setSelectedEdgeIds([]);
                bus.emit('workflow:engine-changed');
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [edgeToWire, edges, engine, selectedEdgeIds, selectedNodeId]);

    const onEdgesDelete = useCallback((deletedEdges) => {
        let didDelete = false;
        deletedEdges.forEach((edge) => {
            const wire = edgeToWire(edge);
            if (!wire) return;
            engine.removeWire(wire);
            bus.emit('workflow:wire-removed', wire);
            didDelete = true;
        });
        if (didDelete) {
            bus.emit('workflow:engine-changed');
        }
    }, [edgeToWire, engine]);

    const onEdgeDoubleClick = useCallback((event, edge) => {
        event.preventDefault();
        event.stopPropagation();
        const wire = edgeToWire(edge);
        if (!wire) return;
        engine.removeWire(wire);
        bus.emit('workflow:wire-removed', wire);
        bus.emit('workflow:engine-changed');
    }, [edgeToWire, engine]);

    const onNodesDelete = useCallback((deletedNodes) => {
        if (!deletedNodes.length) return;
        deletedNodes.forEach((node) => engine.removeNode(node.id));
        setSelectedNodeId(null);
        setSelectedEdgeIds([]);
        bus.emit('workflow:node-deselected');
        bus.emit('workflow:engine-changed');
    }, [engine]);

    const onNodeClick = useCallback((_, node) => {
        setSelectedNodeId(node.id);
        bus.emit('workflow:node-selected', { nodeId: node.id });
    }, []);

    const onNodeDoubleClick = useCallback((_, node) => {
        setSelectedNodeId(node.id);
        bus.emit('workflow:node-inspect', { nodeId: node.id });
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
        setSelectedEdgeIds([]);
        bus.emit('workflow:node-deselected');
    }, []);

    const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }) => {
        const selectedId = selectedNodes?.length ? selectedNodes[0].id : null;
        setSelectedEdgeIds(selectedEdges?.map((e) => e.id) || []);
        setSelectedNodeId(selectedId);
        if (selectedId) {
            bus.emit('workflow:node-selected', { nodeId: selectedId });
        } else {
            bus.emit('workflow:node-deselected');
        }
    }, []);

    const nodeTypes = useMemo(() => ({ workflowNode: WorkflowNode }), []);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            minZoom={0.2}
            maxZoom={3}
            proOptions={{ hideAttribution: true }}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodesDelete={onNodesDelete}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onSelectionChange={onSelectionChange}
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[20, 20]}
        />
    );
}

/** React Flow editor that mirrors workflow engine state. */
export function PipelineEditor(props) {
    return (
        <ReactFlowProvider>
            <PipelineEditorCanvas {...props} />
        </ReactFlowProvider>
    );
}
