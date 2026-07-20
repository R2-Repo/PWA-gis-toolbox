import { PipelineIcon } from '../ui/PipelineIcon.jsx';
import { SelectionBar } from '../map/SelectionBar.jsx';
import { MapPrintMenu } from './MapPrintMenu.jsx';
import { PopupModeMenu } from './PopupModeMenu.jsx';
import { BasemapToggle } from './BasemapToggle.jsx';
import { BasemapToneMenu } from './BasemapToneMenu.jsx';

const faviconUrl = `${import.meta.env.BASE_URL}icons/favicon.png`;

export function HeaderBar({
    onImport,
    onUndo,
    onRedo,
    onMergeLayers,
    onBasemapChange,
    onBasemapToneChange,
    onDimensionChange,
    onLogs,
    onInfo,
    onExportMapView,
    onPresentationLink,
    onPopupModeChange,
    onNetworkAtlas,
    showNetworkAtlas = false,
    networkAtlasActive = false,
    getActiveLayer,
    getSelectionCount,
    onDeleteSelected,
    canUndo = false,
    canRedo = false,
    showMerge = false,
    basemap = 'voyager',
    basemapTone = { tint: 'default', opacity: 1 },
    dimension = '2d',
    popupMode = 'full'
}) {
    return (
        <>
            <div className="header-left-col">
                <div className="header-left">
                    <span className="header-logo">
                        <img src={faviconUrl} alt="GIS-Toolbox.com" width="36" height="36" />
                    </span>
                    <h1 className="header-title">GIS-Toolbox<span className="title-com">.com</span></h1>
                </div>
            </div>
            <div className="header-tools">
                <div className="header-import-slot">
                    <button className="btn btn-secondary btn-sm" id="btn-import" onClick={() => onImport?.()}>
                        <span className="btn-icon-text">📂</span><span>Import</span>
                    </button>
                </div>
                <div className="header-tool-actions">
                <button className="btn btn-ghost btn-sm" id="btn-undo" disabled={!canUndo} title="Undo" onClick={() => onUndo?.()}>↩</button>
                <button className="btn btn-ghost btn-sm" id="btn-redo" disabled={!canRedo} title="Redo" onClick={() => onRedo?.()}>↪</button>
                <SelectionBar
                    getActiveLayer={getActiveLayer}
                    getSelectionCount={getSelectionCount}
                    onDeleteSelected={onDeleteSelected}
                />
                <button className={`btn btn-secondary btn-sm${showMerge ? '' : ' hidden'}`} id="btn-merge" onClick={() => onMergeLayers?.()}>Merge Layers</button>
                <div className="header-sep"></div>
                <div className="header-pipeline-cluster">
                    <button type="button" className="btn btn-secondary btn-sm" id="btn-workflow" title="Data Pipeline Editor">
                        <span className="btn-icon-text" aria-hidden="true">
                            <PipelineIcon className="btn-icon-svg" size={14} />
                        </span>
                        <span>Pipeline</span>
                    </button>
                    <div className="header-pipeline-dual dual-screen-desktop-only">
                        <div className="header-sep dual-screen-header-sep" aria-hidden="true"></div>
                        <button className="btn btn-secondary btn-sm" id="btn-dual-screen" title="Open map in a second window (Dual Screen)">
                            <span className="btn-icon-text">🖥️</span><span className="btn-label">Dual Screen</span>
                        </button>
                    </div>
                    {showNetworkAtlas && (
                        <>
                            <div className="header-sep" aria-hidden="true" />
                            <button
                                type="button"
                                className={`btn btn-secondary btn-sm${networkAtlasActive ? ' active' : ''}`}
                                id="btn-network-atlas"
                                title="Open ITS Network Atlas workspace"
                                onClick={() => onNetworkAtlas?.()}
                            >
                                <span className="btn-icon-text">🕸️</span>
                                <span className="btn-label">Network Atlas</span>
                            </button>
                        </>
                    )}
                </div>
                </div>
            </div>
            <div className="header-right">
                <BasemapToggle basemap={basemap} onBasemapChange={onBasemapChange} />
                <BasemapToneMenu tone={basemapTone} onToneChange={onBasemapToneChange} />
                <div className="header-toggle" id="dimension-toggle">
                    <button className={`header-toggle-option${dimension === '2d' ? ' active' : ''}`} data-value="2d" onClick={() => onDimensionChange?.('2d')}>2D</button>
                    <button className={`header-toggle-option${dimension === '3d' ? ' active' : ''}`} data-value="3d" onClick={() => onDimensionChange?.('3d')}>3D</button>
                </div>
                <PopupModeMenu mode={popupMode} onModeChange={onPopupModeChange} />
                <MapPrintMenu onExportMapView={onExportMapView} onPresentationLink={onPresentationLink} />
                <button className="btn btn-ghost btn-sm" id="btn-logs" title="Logs" onClick={() => onLogs?.()}>📋</button>
                <button
                    className="btn btn-ghost"
                    id="btn-info"
                    title="Tool Guide"
                    style={{ fontSize: '22px', padding: '2px 6px', lineHeight: 1 }}
                    onClick={() => onInfo?.()}
                >
                    ℹ️
                </button>
            </div>
        </>
    );
}
