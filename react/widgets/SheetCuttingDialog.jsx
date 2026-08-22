import { useCallback, useEffect, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { INSETS_PER_PAGE } from '../../js/widgets/sheet-cutting/inset-views.js';

const SHEET_PAPER_SIZE = 'TABLOID';
const SHEET_ORIENTATION = 'landscape';
const DEFAULT_SHEET_LENGTH_FT = 1100;
const DEFAULT_CORRIDOR_WIDTH_FT = 350;
const BASEMAP_DPI_OPTIONS = [
    { value: '120', label: 'Smaller files' },
    { value: '150', label: 'Balanced (recommended)' },
    { value: '200', label: 'Sharper background' }
];
const SHEET_LENGTH_LABEL = 'Sheet length along route (ft)';
const CORRIDOR_WIDTH_LABEL = 'Corridor width (ft)';

function RefreshLayersIcon() {
    return (
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
    );
}

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
    onAddFiberOperationalLayers,
    onDrawInsetBox,
    onRemoveInsetView,
    onOpenRouteCenterline,
    onOpenProjectStationing,
    onOpenCallouts,
    onRefreshLayers,
    onSubscribeLayerRefresh
}) {
    const [session, setSession] = useState(initialSession);
    const [stationingLayerOptions, setStationingLayerOptions] = useState(stationingLayers);
    const [designLayerOptions, setDesignLayerOptions] = useState(designLayers);
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

    const applyLayerLists = useCallback((next) => {
        if (!next) return;
        if (Array.isArray(next)) {
            setStationingLayerOptions(next);
            return;
        }
        if (next.routeLayers) setStationingLayerOptions(next.routeLayers);
        if (next.designLayers) setDesignLayerOptions(next.designLayers);
    }, []);

    const refreshLayerLists = useCallback(() => {
        applyLayerLists(onRefreshLayers?.());
    }, [applyLayerLists, onRefreshLayers]);

    const sheets = (session?.sheets?.sheets || []).filter((entry) => entry.sheetType !== 'overview');
    const insetViews = session?.sheets?.insetViews || [];
    const featureCount = session?.designFeatures?.length || 0;
    const eligibleLayers = designLayerOptions.filter((layer) => layer.eligible);
    const skippedLayers = designLayerOptions.filter((layer) => !layer.eligible);
    const selectedEligibleCount = selectedLayerIds.filter((id) => (
        eligibleLayers.some((layer) => layer.id === id)
    )).length;

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

    useEffect(() => {
        if (!onSubscribeLayerRefresh) return undefined;
        return onSubscribeLayerRefresh(refreshLayerLists);
    }, [onSubscribeLayerRefresh, refreshLayerLists]);

    useEffect(() => {
        if (!designLayerOptions.length) return;
        const known = new Map(designLayerOptions.map((layer) => [layer.id, layer.eligible]));
        setSelectedLayerIds((current) => {
            const next = current.filter((id) => (known.has(id) ? known.get(id) : true));
            return next.length === current.length ? current : next;
        });
    }, [designLayerOptions]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next = await onSelectDesignLayers?.(selectedLayerIds);
            if (cancelled || !next) return;
            setSession(next);
            if ((next.sheets?.sheets || []).length) {
                setValidation(onValidate?.() || null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedLayerIds, onSelectDesignLayers, onValidate]);

    const toggleLayer = (layerId) => {
        setSelectedLayerIds((current) =>
            current.includes(layerId)
                ? current.filter((id) => id !== layerId)
                : [...current, layerId]
        );
    };

    const handleSelectAllLayers = () => {
        setSelectedLayerIds(eligibleLayers.map((layer) => layer.id));
    };

    const allLayersSelected = eligibleLayers.length > 0
        && eligibleLayers.every((layer) => selectedLayerIds.includes(layer.id));
    const selectedLiveFiberIds = selectedLayerIds.filter((id) => (
        designLayerOptions.find((layer) => layer.id === id)?.isUdotFiberLive
    ));
    const hasSelectedLiveFiber = selectedLiveFiberIds.length > 0;

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

        if (next.sheets?.designLayerIds) {
            setSelectedLayerIds(next.sheets.designLayerIds);
        }

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
                placeholder="- select a centerline or stationing layer -"
                selectExtra={(
                    <button
                        type="button"
                        className="btn-icon"
                        disabled={busy}
                        title="Refresh layer list"
                        aria-label="Refresh layer list"
                        onClick={refreshLayerLists}
                    >
                        <RefreshLayersIcon />
                    </button>
                )}
            />
            {!stationingLayerOptions.length ? (
                <>
                    <div className="info-box text-xs" style={{ marginBottom: 12 }}>
                        Select a centerline, or create one with the widgets below.
                    </div>
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
                </>
            ) : null}

            <div className="form-group" style={{ marginBottom: 16 }}>
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

            <div className="form-group">
                <div
                    className="gis-widget__row"
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}
                >
                    <span className="gis-widget__section-title" style={{ marginBottom: 0 }}>Include on PDF sheets</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                            type="button"
                            className="btn-icon"
                            disabled={busy}
                            title="Refresh layer list"
                            aria-label="Refresh layer list"
                            onClick={refreshLayerLists}
                        >
                            <RefreshLayersIcon />
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || allLayersSelected || !eligibleLayers.length}
                            onClick={handleSelectAllLayers}
                        >
                            Select all
                        </button>
                    </div>
                </div>
                <p className="text-xs" style={{ marginTop: 0, marginBottom: 8, color: 'var(--text-muted)' }}>
                    Checked layers are redrawn as linework on the PDF. Streets and aerials stay a background photo. Image and tiled layers stay on the map only.
                </p>
                {selectedEligibleCount > 0 ? (
                    <p className="text-xs" style={{ marginTop: 0, marginBottom: 6, color: 'var(--text-muted)' }}>
                        {selectedEligibleCount} of {eligibleLayers.length} included
                        {featureCount > 0 ? ` · ${featureCount.toLocaleString()} feature${featureCount === 1 ? '' : 's'} ready` : ''}
                    </p>
                ) : null}
                {eligibleLayers.length ? (
                    <div className="text-xs">
                        {eligibleLayers.map((layer) => (
                            <label key={layer.id} style={{ display: 'block', marginBottom: 6 }}>
                                <input
                                    type="checkbox"
                                    checked={selectedLayerIds.includes(layer.id)}
                                    onChange={() => toggleLayer(layer.id)}
                                />
                                {' '}{layer.name}
                                {layer.isUdotFiberLive
                                    ? ' (live Fiber)'
                                    : layer.featureCount > 0
                                        ? ` (${layer.featureCount.toLocaleString()})`
                                        : ''}
                                {layer.note ? (
                                    <span style={{ display: 'block', marginLeft: 18, color: 'var(--text-muted)' }}>
                                        {layer.note}
                                    </span>
                                ) : null}
                            </label>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
                        No vector layers with loaded features yet. Import a layer, then refresh this list.
                    </p>
                )}
                {skippedLayers.length ? (
                    <details className="gis-widget__details" style={{ marginTop: 8 }}>
                        <summary>Not on PDFs ({skippedLayers.length})</summary>
                        <div className="gis-widget__details-body">
                            <ul className="text-xs" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                                {skippedLayers.map((layer) => (
                                    <li key={layer.id} style={{ marginBottom: 4 }}>
                                        {layer.name} — {layer.reason}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </details>
                ) : null}
            </div>

            {sheets.length > 0 ? (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div className="text-xs" style={{ marginBottom: 12 }}>
                        <div><strong>{sheets.length}</strong> sheet{sheets.length === 1 ? '' : 's'}</div>
                        {featureCount > 0 ? <div>{featureCount.toLocaleString()} feature{featureCount === 1 ? '' : 's'} on PDFs</div> : null}
                        {insetViews.length > 0 ? (
                            <div>{insetViews.length} detail box{insetViews.length === 1 ? '' : 'es'} · {Math.ceil(insetViews.length / INSETS_PER_PAGE)} details page{insetViews.length > INSETS_PER_PAGE ? 's' : ''}</div>
                        ) : null}
                    </div>

                    {validation?.warnings?.length ? (
                        <div className="text-xs" style={{ marginBottom: 12 }}>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {validation.warnings.map((entry) => <li key={entry}>{entry}</li>)}
                            </ul>
                        </div>
                    ) : null}

                    <div className="form-group" style={{ marginBottom: 12 }}>
                        <span className="gis-widget__section-title">Detail boxes</span>
                        <p className="text-xs" style={{ marginTop: 0, marginBottom: 8, color: 'var(--text-muted)' }}>
                            Draw a box on a sheet for a zoomed DETAILS page. Four boxes share one page; leftovers keep empty quadrants.
                        </p>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => run(async () => onDrawInsetBox?.(), '')}
                        >
                            Draw detail box
                        </button>
                        {insetViews.length ? (
                            <ul className="text-xs" style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                                {insetViews.map((view) => (
                                    <li
                                        key={view.insetId}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 8,
                                            marginBottom: 4
                                        }}
                                    >
                                        <span>
                                            DETAIL {view.label}
                                            {view.parentSheetNumber
                                                ? ` · Sheet ${String(view.parentSheetNumber).padStart(2, '0')}`
                                                : ''}
                                        </span>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            disabled={busy}
                                            onClick={() => run(async () => onRemoveInsetView?.(view.insetId), '')}
                                        >
                                            Remove
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>

                    <div className="form-group" style={{ marginBottom: 12 }}>
                        <span className="gis-widget__section-title">Fiber callouts</span>
                        <p className="text-xs" style={{ marginTop: 0, marginBottom: 8, color: 'var(--text-muted)' }}>
                            Optional. Numbered leaders and a PROJECT KEY NOTES table on the PDFs. Returns here when you are done.
                        </p>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => onOpenCallouts?.()}
                        >
                            Add Fiber callouts…
                        </button>
                    </div>

                    <div className="form-group" style={{ marginBottom: 12 }}>
                        <label>Background sharpness</label>
                        <select
                            value={basemapDpi}
                            onChange={(e) => setBasemapDpi(e.target.value)}
                            disabled={busy}
                        >
                            {BASEMAP_DPI_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                            Only the streets/aerial photo. Linework stays sharp. Widen the map if the background still looks soft.
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
                        {hasSelectedLiveFiber ? (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busy}
                                onClick={() => run(async () => {
                                    const next = await onAddFiberOperationalLayers?.(selectedLayerIds);
                                    if (next?.sheets?.designLayerIds) {
                                        setSelectedLayerIds(next.sheets.designLayerIds);
                                    }
                                    return next;
                                }, 'Copied Fiber to an editable map layer.')}
                            >
                                Copy Fiber to the map for editing
                            </button>
                        ) : null}
                        <details className="gis-widget__details">
                            <summary>GIS files</summary>
                            <div className="gis-widget__details-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onExportPackage?.()}>
                                    Download GeoJSON
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAddResultLayers?.()}>
                                    Add sheet layers to map
                                </button>
                            </div>
                        </details>
                    </div>
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
