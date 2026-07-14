import { useEffect, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';

function formatFeet(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value)).toLocaleString()} ft`;
}

const SHEET_PAPER_SIZE = 'TABLOID';
const SHEET_ORIENTATION = 'landscape';
const DEFAULT_SHEET_LENGTH_FT = 1100;
const DEFAULT_CORRIDOR_WIDTH_FT = 350;
const BASEMAP_DPI_OPTIONS = [120, 150, 200];
const SHEET_LENGTH_LABEL = 'Sheet length along route (ft)';
const CORRIDOR_WIDTH_LABEL = 'Corridor width (ft)';

function DimensionFieldIcon({ title, children }) {
    return (
        <span
            title={title}
            aria-label={title}
            style={{
                display: 'inline-flex',
                flexShrink: 0,
                color: 'var(--text-muted)',
                cursor: 'help'
            }}
        >
            {children}
        </span>
    );
}

function HorizontalDoubleArrowIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M7 12H17" />
            <path d="M7 9L4 12L7 15" />
            <path d="M17 9L20 12L17 15" />
        </svg>
    );
}

function VerticalDoubleArrowIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 7V17" />
            <path d="M9 7L12 4L15 7" />
            <path d="M9 17L12 20L15 17" />
        </svg>
    );
}

export function SheetCuttingDialog({
    defaultTemplate = {},
    stationingLayers = [],
    designLayers = [],
    initialSession,
    onCancel,
    onCreateProject,
    onSelectRoute,
    onConfigureTemplate,
    onSelectDesignLayers,
    onGenerateSheets,
    onValidate,
    onExportPackage,
    onExportPdf,
    onAddResultLayers,
    onOpenRouteCenterline,
    onOpenProjectStationing,
    onRefreshStationingLayers
}) {
    const [session, setSession] = useState(initialSession);
    const [stationingLayerOptions, setStationingLayerOptions] = useState(stationingLayers);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [stationingLayerId, setStationingLayerId] = useState(initialSession?.project?.stationingRouteLayerId || '');
    const [sheetLengthFt, setSheetLengthFt] = useState(
        String(initialSession?.sheets?.template?.sheetLengthFt ?? defaultTemplate.sheetLengthFt ?? DEFAULT_SHEET_LENGTH_FT)
    );
    const [corridorWidthFt, setCorridorWidthFt] = useState(
        String(initialSession?.sheets?.template?.corridorWidthFt ?? defaultTemplate.corridorWidthFt ?? DEFAULT_CORRIDOR_WIDTH_FT)
    );
    const [basemapDpi, setBasemapDpi] = useState(
        String(initialSession?.sheets?.template?.basemapDpi ?? initialSession?.sheets?.template?.exportDpi ?? defaultTemplate.basemapDpi ?? 150)
    );
    const [selectedLayerIds, setSelectedLayerIds] = useState(initialSession?.sheets?.designLayerIds || []);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [validation, setValidation] = useState(null);
    const routeRequestRef = useRef(0);

    const sheets = (session?.sheets?.sheets || []).filter((entry) => entry.sheetType !== 'overview');
    const frameDims = session?.sheets?.frameDimensions;
    const featureCount = session?.designFeatures?.length || 0;
    const matchLines = session?.sheets?.matchLines || [];

    const run = async (fn, successMessage = '') => {
        setBusy(true);
        setError('');
        try {
            const next = await fn();
            if (next) setSession(next);
            if (successMessage) setMessage(successMessage);
            return next;
        } catch (err) {
            setError(err?.message || 'Operation failed.');
            return null;
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (!stationingLayerId) return undefined;

        const requestId = routeRequestRef.current + 1;
        routeRequestRef.current = requestId;

        let cancelled = false;
        (async () => {
            setBusy(true);
            setError('');
            try {
                const next = await onSelectRoute?.(stationingLayerId);
                if (!cancelled && requestId === routeRequestRef.current && next) {
                    setSession(next);
                }
            } catch (err) {
                if (!cancelled && requestId === routeRequestRef.current) {
                    setError(err?.message || 'Unable to select route.');
                }
            } finally {
                if (!cancelled && requestId === routeRequestRef.current) {
                    setBusy(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [stationingLayerId, onSelectRoute]);

    const toggleLayer = (layerId) => {
        setSelectedLayerIds((current) =>
            current.includes(layerId)
                ? current.filter((id) => id !== layerId)
                : [...current, layerId]
        );
    };

    const handleSelectAllLayers = () => {
        setSelectedLayerIds(designLayers.map((layer) => layer.id));
    };

    const allLayersSelected = designLayers.length > 0
        && designLayers.every((layer) => selectedLayerIds.includes(layer.id));

    const handleGenerate = async () => {
        const next = await run(async () => {
            let current = await onCreateProject?.({
                projectName: projectName.trim() || 'Sheet Cutter'
            });
            if (!current) throw new Error('Unable to create project.');

            if (stationingLayerId) {
                current = await onSelectRoute?.(stationingLayerId) || current;
            }
            if (!current?.routeLine) {
                throw new Error('Select a route centerline layer.');
            }

            current = await onConfigureTemplate?.({
                paperSize: SHEET_PAPER_SIZE,
                orientation: SHEET_ORIENTATION,
                sheetLengthFt: Number(sheetLengthFt) || DEFAULT_SHEET_LENGTH_FT,
                corridorWidthFt: Number(corridorWidthFt) || DEFAULT_CORRIDOR_WIDTH_FT
            }) || current;

            if (selectedLayerIds.length) {
                current = await onSelectDesignLayers?.(selectedLayerIds) || current;
            }

            return onGenerateSheets?.() || current;
        });

        if (!next) return;

        const detailSheets = (next.sheets?.sheets || []).filter((entry) => entry.sheetType !== 'overview');
        setMessage(`Generated ${detailSheets.length} sheet(s).`);
        setValidation(onValidate?.() || null);
    };

    const statusText = error || message;

    return (
        <WidgetPanelShell
            status={statusText}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            onRun={handleGenerate}
            runLabel="Generate Sheets"
            running={busy}
            disabled={busy || !stationingLayerId}
        >
            <div className="form-group">
                <label>Project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Sheet Cutter" />
            </div>
            <LayerSelect
                label="Route centerline or stationing"
                layers={stationingLayerOptions}
                value={stationingLayerId}
                onChange={setStationingLayerId}
                emptyLabel="No Project Stationing centerline layers found"
                selectExtra={(
                    <button
                        type="button"
                        className="btn-icon"
                        disabled={busy}
                        title="Refresh layer list"
                        aria-label="Refresh layer list"
                        onClick={() => {
                            const next = onRefreshStationingLayers?.();
                            if (next) setStationingLayerOptions(next);
                        }}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M1 4v6h6" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                    </button>
                )}
            />
            {!stationingLayerOptions.length ? (
                <div className="info-box text-xs" style={{ marginBottom: 12 }}>
                    Select existing layer or create new layers using the widgets below.
                </div>
            ) : null}
            <div className="gis-widget__btn-row gis-widget__btn-row--split" style={{ marginBottom: 16 }}>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onOpenRouteCenterline?.()}
                >
                    Route Centerline Widget
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onOpenProjectStationing?.()}
                >
                    Project Stationing Widget
                </button>
            </div>

            <div className="form-group">
                <div
                    className="gis-widget__row"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 0 }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 0', minWidth: 0 }}>
                        <DimensionFieldIcon title={SHEET_LENGTH_LABEL}>
                            <HorizontalDoubleArrowIcon />
                        </DimensionFieldIcon>
                        <input
                            value={sheetLengthFt}
                            onChange={(e) => setSheetLengthFt(e.target.value)}
                            aria-label={SHEET_LENGTH_LABEL}
                            inputMode="numeric"
                            style={{ width: 72, minWidth: 0, flex: '0 1 auto' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 0', minWidth: 0 }}>
                        <DimensionFieldIcon title={CORRIDOR_WIDTH_LABEL}>
                            <VerticalDoubleArrowIcon />
                        </DimensionFieldIcon>
                        <input
                            value={corridorWidthFt}
                            onChange={(e) => setCorridorWidthFt(e.target.value)}
                            aria-label={CORRIDOR_WIDTH_LABEL}
                            inputMode="numeric"
                            style={{ width: 72, minWidth: 0, flex: '0 1 auto' }}
                        />
                    </div>
                </div>
            </div>

            {frameDims ? (
                <p className="text-xs" style={{ marginTop: -4, marginBottom: 12, color: 'var(--text-muted)' }}>
                    Map frame: {formatFeet(frameDims.mapFrameWidthFt)} × {formatFeet(frameDims.mapFrameHeightFt)}
                </p>
            ) : null}

            {designLayers.length > 0 ? (
                <div className="form-group">
                    <div
                        className="gis-widget__row"
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}
                    >
                        <span className="gis-widget__section-title" style={{ marginBottom: 0 }}>Current map layers</span>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || allLayersSelected}
                            onClick={handleSelectAllLayers}
                        >
                            Select all
                        </button>
                    </div>
                    {selectedLayerIds.length > 0 ? (
                        <p className="text-xs" style={{ marginTop: 0, marginBottom: 6, color: 'var(--text-muted)' }}>
                            {selectedLayerIds.length} of {designLayers.length} selected
                        </p>
                    ) : null}
                    <details className="gis-widget__details">
                        <summary>Layers ({designLayers.length})</summary>
                        <div className="gis-widget__details-body">
                            <div className="text-xs">
                                {designLayers.map((layer) => (
                                    <label key={layer.id} style={{ display: 'block', marginBottom: 4 }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedLayerIds.includes(layer.id)}
                                            onChange={() => toggleLayer(layer.id)}
                                        />
                                        {' '}{layer.name} ({layer.featureCount})
                                    </label>
                                ))}
                            </div>
                        </div>
                    </details>
                </div>
            ) : null}

            {sheets.length > 0 ? (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div className="text-xs" style={{ marginBottom: 12 }}>
                        <div><strong>{sheets.length}</strong> detail sheets · {matchLines.length} match lines</div>
                        {featureCount > 0 ? <div>{featureCount} design features assigned</div> : null}
                    </div>

                    {validation ? (
                        <div className="text-xs" style={{ marginBottom: 12 }}>
                            {validation.warnings?.length ? (
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    {validation.warnings.map((entry) => <li key={entry}>{entry}</li>)}
                                </ul>
                            ) : (
                                <div style={{ color: 'var(--text-muted)' }}>Coverage check passed.</div>
                            )}
                        </div>
                    ) : null}

                    <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Basemap quality</label>
                        <select
                            value={basemapDpi}
                            onChange={(e) => setBasemapDpi(e.target.value)}
                            disabled={busy}
                        >
                            {BASEMAP_DPI_OPTIONS.map((dpi) => (
                                <option key={dpi} value={String(dpi)}>{dpi} DPI{dpi === 150 ? ' (recommended)' : ''}</option>
                            ))}
                        </select>
                        <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                            Linework and labels export as vector PDF and stay sharp when zoomed. Basemap quality affects only the background image and file size.
                        </p>
                    </div>

                    <div className="gis-widget__btn-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <button
                            type="button"
                            className="gis-widget__primary-btn"
                            disabled={busy}
                            onClick={() => run(async () => {
                                const next = await onConfigureTemplate?.({
                                    basemapDpi: Number(basemapDpi) || 150,
                                    exportDpi: Number(basemapDpi) || 150
                                });
                                await onExportPdf?.();
                                return next;
                            }, 'Sheet PDFs saved to folder.')}
                        >
                            Export sheet PDFs to folder…
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onExportPackage?.()}>
                            Download GIS layers (GeoJSON)
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAddResultLayers?.()}>
                            Add sheet layers to map
                        </button>
                    </div>
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
