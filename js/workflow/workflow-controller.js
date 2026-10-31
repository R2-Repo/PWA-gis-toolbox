/**
 * Workflow controller — engine lifecycle, persistence, run/import/export.
 * UI is React (WorkflowOverlay.jsx); this module owns imperative workflow state.
 */
import { bus } from '../core/event-bus.js';
import { showToast } from '../ui/toast.js';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowStore } from './workflow-store.js';
import { collectInvalidNodes } from './workflow-validation.js';
import { loadGraphIntoEngine } from './workflow-graph-loader.js';
import { graphFromEngine, migrateWorkflowGraph } from './workflow-schema.js';
import {
    deleteSavedGraph,
    duplicateSavedGraph,
    listGraphVersions,
    listSavedGraphs,
    loadVersionGraph,
    openSavedGraph,
    renameSavedGraph,
    saveGraphVersion,
    saveNewGraph
} from './workflow-library-db.js';

const SAVE_DEBOUNCE_MS = 1000;

export function createWorkflowController(deps) {
    const {
        getLayers,
        importFile,
        addToMap,
        updateMapLayer,
        removeFromMap
    } = deps;

    const engine = new WorkflowEngine();
    let engineLoaded = false;
    let open = false;
    let openGeneration = 0;
    let openPromise = null;
    let rootEl = null;
    let reactUnmount = null;
    let previewApi = null;
    let saveTimer = null;
    let activeLibraryGraphId = null;
    let activeLibraryGraphName = null;

    const isOpening = () => openPromise != null;

    const getOverlayEl = () => rootEl?.querySelector('#wf-overlay') ?? rootEl?.firstElementChild ?? null;

    const isOverlayVisible = () => getOverlayEl()?.classList.contains('visible') ?? false;

    const waitForOverlayEl = (timeoutMs = 5000) => new Promise((resolve, reject) => {
        const started = performance.now();
        const tick = () => {
            const el = getOverlayEl();
            if (el?.classList?.contains('wf-overlay')) {
                resolve(el);
                return;
            }
            if (performance.now() - started > timeoutMs) {
                reject(new Error('Workflow overlay mount timeout'));
                return;
            }
            requestAnimationFrame(tick);
        };
        tick();
    });

    const setOverlayVisible = (visible) => {
        const overlay = getOverlayEl();
        if (!overlay) return;
        overlay.classList.toggle('visible', visible);
        if (visible) rootEl?.removeAttribute('inert');
        else rootEl?.setAttribute('inert', '');
    };

    let mountPromise = null;

    const ensureMounted = async () => {
        if (rootEl && getOverlayEl()) return;
        if (mountPromise) return mountPromise;

        mountPromise = (async () => {
            if (!rootEl) {
                rootEl = document.createElement('div');
                rootEl.id = 'wf-overlay-root';
                document.body.appendChild(rootEl);
            }

            if (!getOverlayEl()) {
                const mod = await import('../../react/workflow/mountWorkflowOverlay.jsx');
                reactUnmount = mod.mountWorkflowOverlay(rootEl, {
                    controller,
                    getLayers,
                    importFile
                });
                await waitForOverlayEl();
            }
        })();

        try {
            await mountPromise;
        } finally {
            mountPromise = null;
        }
    };

    const emitEngineChanged = () => bus.emit('workflow:engine-changed');

    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => WorkflowStore.save(engine), SAVE_DEBOUNCE_MS);
    };

    bus.on('workflow:engine-changed', scheduleSave);

    const refreshCanvasViews = ({ center = false } = {}) => {
        if (center) bus.emit('workflow:fit-view');
        emitEngineChanged();
    };

    const showUnknownTypeWarning = (unknownTypes) => {
        if (!unknownTypes?.length) return;
        const types = [...new Set(unknownTypes)].join(', ');
        showToast(`Unknown node type(s): ${types}. Placeholders were added — wires preserved.`, 'warn');
    };

    const applyGraph = (graphInput, { center = true, clearLibraryLink = false } = {}) => {
        const result = loadGraphIntoEngine(engine, graphInput);
        if (!result.loaded) {
            showToast('Config file contains no workflow nodes.', 'error');
            return false;
        }
        if (clearLibraryLink) {
            activeLibraryGraphId = null;
            activeLibraryGraphName = null;
        }
        previewApi?.hide();
        refreshCanvasViews({ center });
        engineLoaded = true;
        WorkflowStore.save(engine);
        showUnknownTypeWarning(result.unknownTypes);
        return true;
    };

    const applyConfig = (config) => {
        if (config?._format && config._format !== 'gis-toolbox-workflow') {
            showToast('Unrecognised config format.', 'error');
            return;
        }

        const pipeline = migrateWorkflowGraph(config?.pipeline ?? config);
        if (!pipeline.nodes.length) {
            showToast('Config file contains no workflow nodes.', 'error');
            return;
        }

        engine.clear();
        WorkflowStore.clear();

        if (applyGraph(pipeline, { center: true, clearLibraryLink: true })) {
            showToast(`Imported ${engine.nodes.size} nodes.`, 'success');
        }
    };

    const loadExample = async (fileName) => {
        try {
            const resp = await fetch(`./pipelines/${encodeURIComponent(fileName)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const config = await resp.json();
            applyConfig(config);

            if (config.sampleData) {
                for (const [nodeId, dataset] of Object.entries(config.sampleData)) {
                    const node = engine.nodes.get(nodeId);
                    if (node && node.type === 'file-import') {
                        node._cachedResult = dataset;
                        node._pendingFile = null;
                    }
                }
                WorkflowStore.save(engine);
                refreshCanvasViews();
            }

            showToast(`Loaded example: ${fileName.replace(/\.json$/i, '')}`, 'success');
        } catch {
            showToast('Failed to load example pipeline.', 'error');
        }
    };

    const exportConfig = () => {
        const pipeline = graphFromEngine(engine);
        if (!pipeline.nodes.length) {
            showToast('Nothing to export — add some nodes first.', 'warn');
            return;
        }
        const config = {
            _format: 'gis-toolbox-workflow',
            version: 1,
            exportedAt: new Date().toISOString(),
            pipeline
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Workflow config exported.', 'success');
    };

    const importConfig = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const config = JSON.parse(reader.result);
                    applyConfig(config);
                } catch {
                    showToast('Invalid workflow config file.', 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    };

    const clearPipeline = () => {
        engine.clear();
        refreshCanvasViews();
        previewApi?.hide();
        WorkflowStore.clear();
        engineLoaded = false;
        activeLibraryGraphId = null;
        activeLibraryGraphName = null;
        bus.emit('workflow:node-deselected');
    };

    const runPipeline = async () => {
        if (engine.isRunning) return null;

        const invalid = collectInvalidNodes(engine);
        if (invalid.length > 0) {
            const summary = invalid
                .slice(0, 3)
                .map(({ node, message }) => `${node.name}: ${message}`)
                .join('; ');
            const extra = invalid.length > 3 ? ` (+${invalid.length - 3} more)` : '';
            showToast(`Fix configuration before running — ${summary}${extra}`, 'error');
            bus.emit('workflow:node-selected', { nodeId: invalid[0].node.id });
            return null;
        }

        try {
            const context = {
                getLayers: () => getLayers(),
                importFile: (file) => importFile(file),
                showPreview: (data, maxRows) => previewApi?.show(data, maxRows),
                addToMap: (data, name, opts) => addToMap(data, name, opts),
                updateMapLayer: (layerId, data) => updateMapLayer(layerId, data),
                removeFromMap: (layerId) => removeFromMap(layerId),
                getUpstreamOutput: (id) => engine.getUpstreamOutput(id)
            };

            const result = await engine.run(context);
            refreshCanvasViews();

            if (result?.status === 'cancelled') {
                showToast('Pipeline run cancelled.', 'warn');
            } else if (result?.status === 'partial') {
                showToast('Pipeline finished with errors on one or more branches.', 'warn');
            } else if (result?.status === 'failed') {
                showToast('Pipeline failed.', 'error');
            }

            return result;
        } catch (err) {
            refreshCanvasViews();
            showToast(`Pipeline error: ${err.message}`, 'error');
            throw err;
        }
    };

    const cancelPipeline = () => {
        if (!engine.isRunning) return;
        engine.cancel();
    };

    bus.on('workflow:node-data-ready', ({ nodeId }) => {
        WorkflowStore.save(engine);
    });

    const controller = {
        engine,
        get isOpen() { return open; },

        setPreviewApi(api) {
            previewApi = api;
        },

        async open() {
            if (isOverlayVisible()) return;
            if (openPromise) return openPromise;

            const generation = ++openGeneration;
            openPromise = (async () => {
                try {
                    await ensureMounted();
                    if (generation !== openGeneration) return;

                    if (!engineLoaded) {
                        const loadResult = await WorkflowStore.load(engine);
                        await WorkflowStore.restoreNodeData(engine);
                        if (generation !== openGeneration) return;

                        engineLoaded = true;
                        showUnknownTypeWarning(loadResult?.unknownTypes);
                    }

                    if (generation !== openGeneration) return;

                    setOverlayVisible(true);
                    refreshCanvasViews({ center: true });
                    open = true;
                    bus.emit('workflow:opened');
                } catch (err) {
                    console.error('[Workflow] open failed', err);
                    setOverlayVisible(false);
                    open = false;
                    showToast('Could not open the pipeline editor.', 'error');
                } finally {
                    openPromise = null;
                }
            })();

            return openPromise;
        },

        close() {
            const wasOpen = open || isOverlayVisible();
            const wasOpening = isOpening();
            if (!wasOpen && !wasOpening) return;

            openGeneration++;
            openPromise = null;
            WorkflowStore.save(engine);
            setOverlayVisible(false);
            open = false;
            bus.emit('workflow:closed');
        },

        toggle() {
            if (isOverlayVisible()) controller.close();
            else void controller.open();
        },

        warmup() {
            void ensureMounted();
        },

        destroy() {
            reactUnmount?.();
            reactUnmount = null;
            rootEl?.remove();
            rootEl = null;
            open = false;
        },

        refreshCanvasViews,
        applyConfig,
        loadExample,
        exportConfig,
        importConfig,
        clearPipeline,
        runPipeline,
        cancelPipeline,

        getActiveLibraryGraph() {
            return activeLibraryGraphId
                ? { id: activeLibraryGraphId, name: activeLibraryGraphName }
                : null;
        },

        async listSavedWorkflows() {
            return listSavedGraphs();
        },

        async listWorkflowVersions(graphId) {
            return listGraphVersions(graphId);
        },

        async saveWorkflowToLibrary(name, { saveAs = false } = {}) {
            const trimmed = (name || '').trim() || 'Untitled workflow';
            const graph = graphFromEngine(engine);
            if (!graph.nodes.length) {
                showToast('Nothing to save — add some nodes first.', 'warn');
                return null;
            }
            try {
                if (!saveAs && activeLibraryGraphId) {
                    await saveGraphVersion(activeLibraryGraphId, trimmed, graph, { label: 'Saved' });
                    activeLibraryGraphName = trimmed;
                    showToast(`Saved "${trimmed}".`, 'success');
                    return activeLibraryGraphId;
                }
                const id = await saveNewGraph(trimmed, graph);
                activeLibraryGraphId = id;
                activeLibraryGraphName = trimmed;
                showToast(`Saved "${trimmed}" to My workflows.`, 'success');
                return id;
            } catch (err) {
                showToast(`Could not save workflow: ${err.message}`, 'error');
                return null;
            }
        },

        async openWorkflowFromLibrary(graphId) {
            try {
                const graph = await openSavedGraph(graphId);
                if (!graph) {
                    showToast('Saved workflow not found.', 'error');
                    return false;
                }
                engine.clear();
                WorkflowStore.clear();
                const meta = (await listSavedGraphs()).find((g) => g.id === graphId);
                activeLibraryGraphId = graphId;
                activeLibraryGraphName = meta?.name || 'Workflow';
                applyGraph(graph, { center: true });
                await WorkflowStore.restoreNodeData(engine);
                showToast(`Opened "${activeLibraryGraphName}".`, 'success');
                return true;
            } catch (err) {
                showToast(`Could not open workflow: ${err.message}`, 'error');
                return false;
            }
        },

        async renameWorkflowInLibrary(graphId, newName) {
            try {
                await renameSavedGraph(graphId, newName);
                if (graphId === activeLibraryGraphId) {
                    activeLibraryGraphName = newName.trim();
                }
                showToast('Workflow renamed.', 'success');
                return true;
            } catch (err) {
                showToast(err.message, 'error');
                return false;
            }
        },

        async deleteWorkflowFromLibrary(graphId) {
            try {
                await deleteSavedGraph(graphId);
                if (graphId === activeLibraryGraphId) {
                    activeLibraryGraphId = null;
                    activeLibraryGraphName = null;
                }
                showToast('Workflow deleted.', 'success');
                return true;
            } catch (err) {
                showToast(err.message, 'error');
                return false;
            }
        },

        async duplicateWorkflowInLibrary(graphId, newName) {
            try {
                const id = await duplicateSavedGraph(graphId, newName);
                showToast('Workflow duplicated.', 'success');
                return id;
            } catch (err) {
                showToast(err.message, 'error');
                return null;
            }
        },

        async restoreWorkflowVersion(versionId) {
            try {
                const graph = await loadVersionGraph(versionId);
                if (!graph) {
                    showToast('Version not found.', 'error');
                    return false;
                }
                applyGraph(graph, { center: true });
                await WorkflowStore.restoreNodeData(engine);
                showToast('Restored workflow version.', 'success');
                return true;
            } catch (err) {
                showToast(err.message, 'error');
                return false;
            }
        }
    };

    return controller;
}
