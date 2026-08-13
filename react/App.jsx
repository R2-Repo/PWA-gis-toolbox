import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import logger from '../js/core/logger.js';
import mapService from '../js/map/map-service.js';
import bus from '../js/core/event-bus.js';
import { setExportMapManager } from '../js/export/exporter.js';
import sessionStore from '../js/core/session-store.js';
import { getState, setUIState } from '../js/core/state.js';
import { installDualScreenMapServiceDecorator } from '../js/dual-screen/dual-screen-map-service.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import {
    restoreSessionIfAvailable,
    setupAppWiring,
    setupDragDrop,
    setupTooltipPortal,
    openImportFlow,
    handleUndo,
    handleRedo,
    handleMergeLayers,
    applyBasemapHeaderSelection,
    applyBasemapToneSelection,
    applyDimensionHeaderSelection,
    showToolInfo,
    setActiveLayerAndRefresh,
    moveLayerToIndex,
    toggleLayerVisibilityAndRender,
    toggleLayerLockAndRender,
    zoomToLayer,
    removeLayerWithConfirm,
    removeLayersWithConfirm,
    moveGroupToIndex,
    toggleGroupCollapsedAndRefresh,
    renameLayerGroupInline,
    toggleGroupVisibilityAndRender,
    dissolveLayerGroupWithConfirm,
    removeLayerGroupWithConfirm,
    groupSelectedLayers,
    exportLayerGroup,
    toggleField,
    selectAllFields,
    addField,
    detachUnselectedFieldsForExport,
    renameLayer,
    renameField,
    openFilterBuilder,
    openLayerDisplayModeInfo,
    doExport,
    fixAGOL,
    showDataTable,
    deleteSelectedFeatures,
    getRightPanelSnapshot,
    handleLayerStyleChange,
    handleLayerScaleRangeChange,
    exportProjectKit,
    exportMapView,
    buildMapContextMenuItems,
    buildSelectionActionMenuItems,
    setPanelCollapsed,
    openPresentationLinkBuilderWidget,
    bootstrapAppFromUrl
} from '../js/tools/tool-handlers.js';
import { getAppUrlConfig } from '../js/url/app-url-detector.js';
import { getActiveLayer } from '../js/core/state.js';
import { isLayerVisibleAtScale } from '../js/map/scale-range.js';
import { resolveLayerDisplayMode } from '../js/map/layer-display-mode.js';
import { AppStoreProvider, createAppStore, useAppStore } from './providers/AppStore.jsx';
import { MobileGate } from './shell/MobileGate.jsx';
import { HeaderBar } from './header/HeaderBar.jsx';
import { ActivityIndicator } from './header/ActivityIndicator.jsx';
import { MapView } from './map/MapView.jsx';
import { MapContextMenu } from './map/MapContextMenu.jsx';
import { SelectionActionsMenu } from './map/SelectionActionsMenu.jsx';
import { LayerListPanel, FieldListPanel, DataPrepToolsPanel } from './panels/LeftPanel.jsx';
import { GisToolsPanel } from './panels/GisToolsPanel.jsx';
import { RightPanel } from './panels/RightPanel.jsx';
import { mountModalHost } from './ui/mountModalHost.jsx';
import { mountToastHost } from './ui/mountToastHost.jsx';
import { CollapsibleSection } from './ui/CollapsibleSection.jsx';
import { isPresentationMode } from '../js/presentation/presentation-mode-detector.js';
import { PresentationApp } from './presentation/PresentationApp.jsx';
function SaveIndicator() {
    const [status, setStatus] = useState(null);

    useEffect(() => {
        return sessionStore.onSaveStatus((next) => {
            setStatus(next);
            if (next === 'saved') {
                setTimeout(() => setStatus(null), 1500);
            } else if (next === 'error' || next === 'quota') {
                setTimeout(() => setStatus(null), 2500);
            }
        });
    }, []);

    const text = status === 'saving' ? 'Saving…'
        : status === 'saved' ? 'Session saved'
            : status === 'quota' ? 'Session too large to save'
            : status === 'error' ? 'Save failed'
                : '';

    return (
        <div className={`save-indicator${status ? ' visible' : ''}`} id="save-indicator">
            {text}
        </div>
    );
}

function getInitialPanelCollapsed(side) {
    const panel = getAppUrlConfig().panel;
    if (!panel || panel === 'both') return false;
    if (panel === 'none') return true;
    if (panel === 'left') return side === 'right';
    if (panel === 'right') return side === 'left';
    return false;
}

function usePanelCollapse(side) {
    const [collapsed, setCollapsed] = useState(() => getInitialPanelCollapsed(side));

    useLayoutEffect(() => {
        setPanelCollapsed(side, collapsed);
    }, [side, collapsed]);

    const toggle = useCallback(() => {
        setCollapsed((prev) => {
            const next = !prev;
            setPanelCollapsed(side, next);
            return next;
        });
    }, [side]);

    const expand = useCallback(() => {
        setCollapsed(false);
        setPanelCollapsed(side, false);
    }, [side]);

    const applyCollapsed = useCallback((next) => {
        setCollapsed(next);
        setPanelCollapsed(side, next);
    }, [side]);

    return { collapsed, toggle, expand, setCollapsed: applyCollapsed };
}

function AppShell() {
    const layers = useAppStore((s) => s.layers);
    const layerGroups = useAppStore((s) => s.layerGroups);
    const activeLayer = useAppStore((s) => s.activeLayer);
    const toolbar = useAppStore((s) => s.toolbar);
    const refreshTick = useAppStore((s) => s.refreshTick);
    const toggleAgolCompat = useAppStore((s) => s.toggleAgolCompat);

    const [basemap, setBasemap] = useState('voyager');
    const [basemapTone, setBasemapTone] = useState(() => mapService.getBasemapTone?.() || { tint: 'default', opacity: 1 });
    const [dimension, setDimension] = useState('2d');
    const [popupMode, setPopupMode] = useState(() => mapService.getPopupMode?.() || 'full');
    const leftPanel = usePanelCollapse('left');
    const rightPanel = usePanelCollapse('right');

    useEffect(() => {
        return bus.on('app-url:panel', (panel) => {
            if (!panel || panel === 'both') {
                leftPanel.setCollapsed(false);
                rightPanel.setCollapsed(false);
            } else if (panel === 'none') {
                leftPanel.setCollapsed(true);
                rightPanel.setCollapsed(true);
            } else if (panel === 'left') {
                leftPanel.setCollapsed(false);
                rightPanel.setCollapsed(true);
            } else if (panel === 'right') {
                leftPanel.setCollapsed(true);
                rightPanel.setCollapsed(false);
            }
        });
    }, [leftPanel, rightPanel]);

    const panelActions = useMemo(() => ({
        setActiveLayer: setActiveLayerAndRefresh,
        renameLayer: (id) => renameLayer(id),
        renameLayerInline: (id, el) => renameLayer(id, el),
        moveLayerToIndex,
        toggleVisibility: toggleLayerVisibilityAndRender,
        toggleLock: toggleLayerLockAndRender,
        zoomToLayer,
        removeLayer: removeLayerWithConfirm,
        removeLayers: removeLayersWithConfirm,
        moveGroupToIndex,
        toggleGroupCollapsed: toggleGroupCollapsedAndRefresh,
        renameLayerGroupInline,
        toggleGroupVisibility: toggleGroupVisibilityAndRender,
        dissolveLayerGroup: dissolveLayerGroupWithConfirm,
        removeLayerGroup: removeLayerGroupWithConfirm,
        groupSelectedLayers,
        exportLayerGroup,
        openFilterBuilder: (id) => openFilterBuilder(id),
        openLayerDisplayModeInfo,
        toggleField,
        selectAllFields,
        addField,
        detachUnselectedFieldsForExport,
        renameField: (name) => renameField(name),
        renameFieldInline: (name, el) => renameField(name, el)
    }), []);

    const rightSnapshot = useMemo(() => getRightPanelSnapshot(), [refreshTick, activeLayer?.id]);
    const fields = activeLayer?.schema?.fields || [];

    const layersForPanel = useMemo(() => {
        const map = mapService.getMap();
        const zoom = map?.getZoom?.() ?? 7;
        const lat = map?.getCenter?.()?.lat ?? 0;
        return layers.map((layer) => {
            const mapEntry = mapService.getLayerRecord?.(layer.id) || null;
            return {
                ...layer,
                _displayMode: resolveLayerDisplayMode(layer, mapEntry),
                _outOfScaleRange: layer.visible !== false
                    && layer.scaleRangeEnabled
                    && !isLayerVisibleAtScale(layer, zoom, lat)
            };
        });
    }, [layers, refreshTick]);

    const onBasemapChange = useCallback((value) => {
        setBasemap(value);
        applyBasemapHeaderSelection(value);
    }, []);

    const onBasemapToneChange = useCallback((tone) => {
        const next = applyBasemapToneSelection(tone) ?? mapService.getBasemapTone?.();
        if (next) setBasemapTone(next);
    }, []);

    const onDimensionChange = useCallback((value) => {
        setDimension(value);
        applyDimensionHeaderSelection(value);
    }, []);

    const onPopupModeChange = useCallback((value) => {
        setPopupMode(value);
        mapService.setPopupMode(value);
    }, []);

    useEffect(() => {
        return bus.on('map:chrome', (payload) => {
            if (payload?.is3d !== undefined) {
                setDimension(payload.is3d ? '3d' : '2d');
            }
            if (payload?.basemap) {
                setBasemap(payload.basemap);
            }
            if (payload?.basemapTone) {
                setBasemapTone(payload.basemapTone);
            }
        });
    }, []);

    useEffect(() => {
        return bus.on('map:basemapTone', (tone) => {
            if (tone) setBasemapTone(tone);
        });
    }, []);

    useEffect(() => {
        return dualScreenCoordinator.onStateChange((active) => {
            if (!active) {
                setDimension(mapService.is3DEnabled() ? '3d' : '2d');
                setBasemap(mapService.getCurrentBasemap() || 'voyager');
                setBasemapTone(mapService.getBasemapTone?.() || { tint: 'default', opacity: 1 });
            }
        });
    }, []);

    const onToggleAgol = useCallback(() => {
        toggleAgolCompat();
    }, [toggleAgolCompat]);

    return (
        <>
            <MobileGate />
            <header className={`header${leftPanel.collapsed ? ' header--left-collapsed' : ''}`}>
                <HeaderBar
                    onImport={openImportFlow}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onMergeLayers={handleMergeLayers}
                    onBasemapChange={onBasemapChange}
                    onBasemapToneChange={onBasemapToneChange}
                    onDimensionChange={onDimensionChange}
                    onInfo={showToolInfo}
                    onExportMapView={exportMapView}
                    onPresentationLink={openPresentationLinkBuilderWidget}
                    getActiveLayer={getActiveLayer}
                    getSelectionCount={(layerId) => mapService.getSelectionCount(layerId)}
                    canUndo={toolbar.canUndo}
                    canRedo={toolbar.canRedo}
                    showMerge={toolbar.showMerge}
                    basemap={basemap}
                    basemapTone={basemapTone}
                    dimension={dimension}
                    popupMode={popupMode}
                    onPopupModeChange={onPopupModeChange}
                />
                <ActivityIndicator />
            </header>

            <SaveIndicator />

            <div className="app-layout">
                <aside className={`panel panel-left${leftPanel.collapsed ? ' collapsed' : ''}`}>
                    <div className="panel-header">
                        <span>Layers & Fields</span>
                        <button
                            type="button"
                            className="btn-icon"
                            id="toggle-left-panel"
                            title="Collapse"
                            onClick={leftPanel.toggle}
                        >
                            {leftPanel.collapsed ? '▶' : '◀'}
                        </button>
                    </div>
                    <div className="panel-body">
                        <CollapsibleSection title="Layers" bodyId="layer-list">
                            <LayerListPanel
                                layers={layersForPanel}
                                layerGroups={layerGroups}
                                activeLayerId={activeLayer?.id || null}
                                actions={panelActions}
                            />
                        </CollapsibleSection>
                        <CollapsibleSection title="Fields" bodyId="field-list" defaultOpen={false}>
                            <FieldListPanel
                                activeLayer={activeLayer}
                                fields={fields}
                                actions={panelActions}
                            />
                        </CollapsibleSection>
                        <div id="dataprep-tools">
                            <DataPrepToolsPanel
                                activeLayer={activeLayer}
                                hasLayers={layers.length > 0}
                                gisTools={(
                                    <GisToolsPanel />
                                )}
                            />
                        </div>
                    </div>
                </aside>

                <main className="panel-center">
                    <div id="map-container">
                        <MapView
                            mapService={mapService}
                            onReady={() => {
                                setExportMapManager(mapService);
                                setTimeout(() => mapService.resize(), 100);
                            }}
                        />
                        <div className="map-overlay" id="map-drop-overlay">
                            <div>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48 }}>
                                    <path d="M12 16v-4m0-4h.01M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7l3-7z" />
                                </svg>
                                <p style={{ marginTop: 12, fontSize: 18, fontWeight: 600 }}>Drop files here to import</p>
                                <p className="text-sm text-muted">GeoJSON, CSV, Excel, KML, KMZ, Shapefile (ZIP), .gis-toolbox</p>
                            </div>
                        </div>
                    </div>
                </main>

                <aside className={`panel panel-right${rightPanel.collapsed ? ' collapsed' : ''}`}>
                    <div className="panel-header">
                        <button
                            type="button"
                            className="btn-icon"
                            id="toggle-right-panel"
                            title="Collapse"
                            onClick={rightPanel.toggle}
                        >
                            {rightPanel.collapsed ? '◀' : '▶'}
                        </button>
                        <span>Output & Export</span>
                    </div>
                    <div className="panel-right-body">
                        <div className="panel-body" id="output-panel-content">
                            <RightPanel
                                snapshot={rightSnapshot}
                                onToggleAgol={onToggleAgol}
                                onExport={doExport}
                                onExportProjectKit={exportProjectKit}
                                onFixAgol={fixAGOL}
                                onShowDataTable={showDataTable}
                                onStyleChange={handleLayerStyleChange}
                                onScaleRangeChange={handleLayerScaleRangeChange}
                            />
                        </div>
                        <div id="widget-panel-dock" className="widget-panel-dock" aria-live="polite" />
                    </div>
                </aside>
            </div>

            <button
                type="button"
                className={`panel-expand-tab panel-expand-left${leftPanel.collapsed ? '' : ' hidden'}`}
                id="expand-left-panel"
                title="Expand Layers"
                onClick={leftPanel.expand}
            >
                ▶
            </button>
            <button
                type="button"
                className={`panel-expand-tab panel-expand-right${rightPanel.collapsed ? '' : ' hidden'}`}
                id="expand-right-panel"
                title="Expand Export"
                onClick={rightPanel.expand}
            >
                ◀
            </button>

            <MapContextMenu buildItems={buildMapContextMenuItems} />
            <SelectionActionsMenu buildItems={buildSelectionActionMenuItems} />
        </>
    );
}

export function App() {
    if (isPresentationMode()) {
        return <PresentationApp />;
    }

    const store = useMemo(() => createAppStore(), []);
    const modalHostRef = useRef(null);
    const toastHostRef = useRef(null);
    const bootRanRef = useRef(false);

    useLayoutEffect(() => {
        installDualScreenMapServiceDecorator(mapService, dualScreenCoordinator);
        logger.info('App', 'Initializing GIS Toolbox');

        setupAppWiring();
        setupDragDrop();
        setupTooltipPortal();

        const syncMobileClass = () => {
            const isMobile = window.innerWidth < 768;
            const state = getState();
            if (isMobile !== state.ui.isMobile) {
                setUIState('isMobile', isMobile);
            }
        };
        syncMobileClass();
        window.addEventListener('resize', syncMobileClass);

        logger.info('App', 'App ready');

        return () => {
            window.removeEventListener('resize', syncMobileClass);
        };
    }, []);

    useEffect(() => {
        if (!modalHostRef.current) return undefined;
        const mounted = mountModalHost(modalHostRef.current);

        if (!bootRanRef.current) {
            bootRanRef.current = true;
            void (async () => {
                bootstrapAppFromUrl();
                if (window.innerWidth >= 768) {
                    await showToolInfo();
                }
                await restoreSessionIfAvailable();
            })();
        }

        return () => mounted.unmount();
    }, []);

    useEffect(() => {
        if (!toastHostRef.current) return undefined;
        const mounted = mountToastHost(toastHostRef.current);
        return () => mounted.unmount();
    }, []);

    return (
        <AppStoreProvider store={store}>
            <AppShell />
            <div id="modal-host" ref={modalHostRef} />
            <div id="toast-container" className="toast-container" ref={toastHostRef} />
        </AppStoreProvider>
    );
}
