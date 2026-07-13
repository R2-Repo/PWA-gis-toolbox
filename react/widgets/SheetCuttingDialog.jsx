import { useEffect, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';

function formatFeet(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value)).toLocaleString()} ft`;
}

export function SheetCuttingDialog({
    paperSizes = [],
    orientations = [],
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
    onSaveSession,
    onOpenFullPlanExport
}) {
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [projectNumber, setProjectNumber] = useState(initialSession?.project?.projectNumber || '');
    const [stationingLayerId, setStationingLayerId] = useState(initialSession?.project?.stationingRouteLayerId || '');
    const [paperSize, setPaperSize] = useState(initialSession?.sheets?.template?.paperSize || defaultTemplate.paperSize || 'ANSI_D');
    const [orientation, setOrientation] = useState(initialSession?.sheets?.template?.orientation || defaultTemplate.orientation || 'landscape');
    const [scale, setScale] = useState(String(initialSession?.sheets?.template?.scale || defaultTemplate.scale || 200));
    const [includeOverview, setIncludeOverview] = useState(initialSession?.sheets?.template?.includeOverview !== false);
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

    const handleGenerate = async () => {
        const next = await run(async () => {
            let current = await onCreateProject?.({
                projectName: projectName.trim() || 'Sheet Cutter',
                projectNumber: projectNumber.trim()
            });
            if (!current) throw new Error('Unable to create project.');

            if (stationingLayerId) {
                current = await onSelectRoute?.(stationingLayerId) || current;
            }
            if (!current?.routeLine) {
                throw new Error('Select a route centerline layer.');
            }

            current = await onConfigureTemplate?.({
                paperSize,
                orientation,
                scale: Number(scale) || 200,
                includeOverview
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
            <div className="form-group">
                <label>Project number</label>
                <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} placeholder="Optional" />
            </div>

            <LayerSelect
                label="Route centerline (Project Stationing)"
                layers={stationingLayers}
                value={stationingLayerId}
                onChange={setStationingLayerId}
                emptyLabel="No Project Stationing centerline layers found"
            />
            {session?.stationingRoute ? (
                <div className="text-xs" style={{ marginTop: -8, marginBottom: 12, color: 'var(--text-muted)' }}>
                    <div>{session.stationingRoute.routeName}</div>
                    <div>
                        {session.stationingRoute.profile?.start_station_label} – {session.stationingRoute.profile?.end_station_label}
                    </div>
                </div>
            ) : null}

            <div className="gis-widget__row" style={{ gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Paper size</label>
                    <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                        {paperSizes.map((size) => (
                            <option key={size} value={size}>{size.replace('_', ' ')}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Orientation</label>
                    <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                        {orientations.map((entry) => (
                            <option key={entry} value={entry}>{entry}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="form-group">
                <label>Scale (1:n)</label>
                <input value={scale} onChange={(e) => setScale(e.target.value)} />
            </div>

            <label className="text-xs" style={{ display: 'block', marginBottom: 12 }}>
                <input type="checkbox" checked={includeOverview} onChange={(e) => setIncludeOverview(e.target.checked)} />
                {' '}Include overview sheet
            </label>

            {frameDims ? (
                <p className="text-xs" style={{ marginTop: -4, marginBottom: 12, color: 'var(--text-muted)' }}>
                    Map frame: {formatFeet(frameDims.mapFrameWidthFt)} × {formatFeet(frameDims.mapFrameHeightFt)}
                </p>
            ) : null}

            {designLayers.length > 0 ? (
                <div className="form-group">
                    <label>Design layers (optional)</label>
                    <div className="text-xs" style={{ maxHeight: 120, overflow: 'auto' }}>
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

                    <div className="gis-widget__btn-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <button
                            type="button"
                            className="gis-widget__primary-btn"
                            disabled={busy}
                            onClick={() => run(() => onExportPdf?.(), 'Sheet PDFs saved to folder.')}
                        >
                            Export sheet PDFs to folder…
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onExportPackage?.()}>
                            Download GIS layers (GeoJSON)
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAddResultLayers?.()}>
                            Add sheet layers to map
                        </button>
                        <button type="button" className="gis-widget__link-btn" disabled={busy} onClick={() => onSaveSession?.()}>
                            Save session JSON
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => onOpenFullPlanExport?.()}
                        >
                            Export full plan package
                        </button>
                    </div>
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
