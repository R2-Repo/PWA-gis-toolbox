import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { isLinearPipeline } from '../../js/workflow/workflow-graph-utils.js';
import { PipelineIcon } from '../ui/PipelineIcon.jsx';
import { PipelineEditor } from './PipelineEditor.jsx';
import { WorkflowPalette } from './WorkflowPalette.jsx';
import { WorkflowStepsPanel } from './WorkflowStepsPanel.jsx';
import { InspectorPanel } from './InspectorPanel.jsx';
import { DataPreviewPanel } from './DataPreviewPanel.jsx';

export function WorkflowOverlay({ controller, getLayers, importFile }) {
    const { engine } = controller;
    const previewRef = useRef(null);
    const canvasRef = useRef(null);

    const [manifest, setManifest] = useState(null);
    const [manifestError, setManifestError] = useState(false);
    const [examplesOpen, setExamplesOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [nodeCount, setNodeCount] = useState(() => engine.nodes.size);
    const [viewMode, setViewMode] = useState('graph');

    useEffect(() => {
        controller.setPreviewApi({
            show: (data, maxRows) => previewRef.current?.show(data, maxRows),
            hide: () => previewRef.current?.hide()
        });
    }, [controller]);

    useEffect(() => {
        fetch('./pipelines/manifest.json')
            .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then((entries) => setManifest(entries))
            .catch(() => setManifestError(true));
    }, []);

    const syncNodeCount = useCallback(() => {
        setNodeCount(engine.nodes.size);
    }, [engine]);

    useEffect(() => {
        const unsubs = [
            bus.on('workflow:engine-changed', syncNodeCount),
            bus.on('workflow:run-start', syncNodeCount),
            bus.on('workflow:run-done', syncNodeCount)
        ];
        return () => unsubs.forEach((off) => { try { off(); } catch { /* noop */ } });
    }, [syncNodeCount]);

    useEffect(() => {
        const unsub = bus.on('workflow:delete-node', ({ nodeId }) => {
            engine.removeNode(nodeId);
            bus.emit('workflow:node-deselected');
            controller.refreshCanvasViews();
            previewRef.current?.hide();
        });
        return () => { try { unsub(); } catch { /* noop */ } };
    }, [controller, engine]);

    useEffect(() => {
        const unsub = bus.on('workflow:palette-add', ({ type }) => {
            const canvasEl = canvasRef.current;
            if (!canvasEl) return;
            const rect = canvasEl.getBoundingClientRect();
            bus.emit('workflow:add-node-request', {
                type,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
            });
        });
        return () => { try { unsub(); } catch { /* noop */ } };
    }, []);

    const onKeyDown = useCallback((e) => {
        if (e.key === 'Escape') controller.close();
    }, [controller]);

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onKeyDown]);

    const onDragEvent = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const onCanvasDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        const json = e.dataTransfer.getData('application/x-wf-node');
        if (!json) return;
        const { type } = JSON.parse(json);
        bus.emit('workflow:add-node-request', { type, clientX: e.clientX, clientY: e.clientY });
    }, []);

    const onRun = useCallback(async () => {
        if (engine.isRunning || running) return;
        setRunning(true);
        try {
            await controller.runPipeline();
        } finally {
            setRunning(false);
        }
    }, [controller, engine.isRunning, running]);

    const onClear = useCallback(() => {
        if (!window.confirm('Clear the entire pipeline? This cannot be undone.')) return;
        controller.clearPipeline();
        setViewMode('graph');
    }, [controller]);

    const onFitView = useCallback(() => {
        bus.emit('workflow:fit-view');
    }, []);

    const loadRecipe = useCallback(async (file, linear) => {
        await controller.loadExample(file);
        setViewMode(linear ? 'steps' : 'graph');
    }, [controller]);

    const examplesWrapperRef = useRef(null);
    const moreWrapperRef = useRef(null);

    useEffect(() => {
        if (!examplesOpen && !moreOpen) return undefined;
        const closeDropdowns = (e) => {
            if (examplesOpen && !examplesWrapperRef.current?.contains(e.target)) {
                setExamplesOpen(false);
            }
            if (moreOpen && !moreWrapperRef.current?.contains(e.target)) {
                setMoreOpen(false);
            }
        };
        document.addEventListener('click', closeDropdowns);
        return () => document.removeEventListener('click', closeDropdowns);
    }, [examplesOpen, moreOpen]);

    const linearAvailable = useMemo(() => isLinearPipeline(engine), [engine, nodeCount]);

    useEffect(() => {
        if (!linearAvailable && viewMode === 'steps') {
            setViewMode('graph');
        }
    }, [linearAvailable, viewMode]);

    return (
        <div id="wf-overlay" className="wf-overlay">
            <div className="wf-topbar">
                <button type="button" className="wf-topbar-btn" id="wf-back" title="Back to map" onClick={() => controller.close()}>
                    ← Back to Map
                </button>
                <span className="wf-topbar-title">
                    <PipelineIcon className="wf-title-icon" size={14} />
                    Data Pipeline Editor
                </span>
                <div className="wf-topbar-actions">
                    <div className="wf-view-toggle" role="group" aria-label="View mode">
                        <button
                            type="button"
                            className={`wf-view-toggle-btn${viewMode === 'graph' ? ' active' : ''}`}
                            onClick={() => setViewMode('graph')}
                        >
                            Graph
                        </button>
                        <button
                            type="button"
                            className={`wf-view-toggle-btn${viewMode === 'steps' ? ' active' : ''}`}
                            disabled={!linearAvailable}
                            title={linearAvailable ? 'Step-by-step view' : 'Steps view works for simple left-to-right pipelines.'}
                            onClick={() => setViewMode('steps')}
                        >
                            Steps
                        </button>
                    </div>

                    <div className="wf-examples-wrapper" id="wf-examples-wrapper" ref={examplesWrapperRef}>
                        <button
                            type="button"
                            className="wf-topbar-btn wf-topbar-io"
                            id="wf-examples-btn"
                            title="Load a preconfigured example"
                            onClick={(e) => { e.stopPropagation(); setExamplesOpen((o) => !o); setMoreOpen(false); }}
                        >
                            Examples ▾
                        </button>
                        <div className={`wf-examples-dropdown${examplesOpen ? ' open' : ''}`} id="wf-examples-dropdown">
                            <div className="wf-examples-title">Preconfigured Examples</div>
                            <div className="wf-examples-list" id="wf-examples-list">
                                {manifestError && 'Failed to load examples.'}
                                {!manifestError && manifest === null && 'Loading…'}
                                {!manifestError && manifest?.length === 0 && 'No examples available.'}
                                {!manifestError && manifest?.map((entry) => (
                                    <button
                                        key={entry.file}
                                        type="button"
                                        className="wf-examples-item"
                                        onClick={() => {
                                            setExamplesOpen(false);
                                            void loadRecipe(entry.file, entry.linear);
                                        }}
                                    >
                                        {entry.title || entry.file.replace(/\.json$/i, '')}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button type="button" className="wf-topbar-btn" id="wf-fit-view" title="Fit pipeline to view" onClick={onFitView}>
                        Fit view
                    </button>

                    <div className="wf-examples-wrapper" ref={moreWrapperRef}>
                        <button
                            type="button"
                            className="wf-topbar-btn wf-topbar-io"
                            id="wf-more-btn"
                            title="Import, export, and clear"
                            onClick={(e) => { e.stopPropagation(); setMoreOpen((o) => !o); setExamplesOpen(false); }}
                        >
                            More ▾
                        </button>
                        <div className={`wf-examples-dropdown wf-more-dropdown${moreOpen ? ' open' : ''}`}>
                            <button
                                type="button"
                                className="wf-examples-item"
                                onClick={() => { setMoreOpen(false); controller.importConfig(); }}
                            >
                                Import workflow JSON
                            </button>
                            <button
                                type="button"
                                className="wf-examples-item"
                                onClick={() => { setMoreOpen(false); controller.exportConfig(); }}
                            >
                                Export workflow JSON
                            </button>
                            <button
                                type="button"
                                className="wf-examples-item wf-examples-item-danger"
                                onClick={() => { setMoreOpen(false); onClear(); }}
                            >
                                Clear pipeline
                            </button>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="wf-topbar-btn wf-topbar-run"
                        id="wf-run"
                        title="Run pipeline"
                        disabled={running || engine.isRunning}
                        onClick={() => void onRun()}
                    >
                        {running || engine.isRunning ? 'Running…' : '▶ Run Pipeline'}
                    </button>
                    <button
                        type="button"
                        className="wf-topbar-btn dual-screen-wide-only"
                        id="wf-dual-screen"
                        data-dual-screen-toggle
                        title="Open map in a second window (Dual Screen)"
                        onClick={() => { if (typeof window._toggleDualScreen === 'function') window._toggleDualScreen(); }}
                    >
                        Dual Screen
                    </button>
                </div>
            </div>

            <div
                className="wf-body"
                onDragOver={onDragEvent}
                onDragEnter={onDragEvent}
                onDragLeave={onDragEvent}
                onDrop={onDragEvent}
            >
                {viewMode === 'steps' && linearAvailable ? (
                    <WorkflowStepsPanel engine={engine} />
                ) : (
                    <WorkflowPalette />
                )}
                <div
                    className="wf-canvas-area"
                    ref={canvasRef}
                    style={{ position: 'relative' }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                    onDrop={onCanvasDrop}
                >
                    <div className="wf-reactflow-host" style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', opacity: 1, zIndex: 2 }}>
                        <PipelineEditor engine={engine} getLayers={getLayers} />
                    </div>
                </div>
                <InspectorPanel engine={engine} getLayers={getLayers} importFile={importFile} />
            </div>

            <DataPreviewPanel ref={previewRef} />
        </div>
    );
}
