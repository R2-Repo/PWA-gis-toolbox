import { useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';

function formatFeet(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value)).toLocaleString()} ft`;
}

export function SheetCuttingDialog({
    steps = [],
    paperSizes = [],
    orientations = [],
    defaultTemplate = {},
    stationingLayers = [],
    designLayers = [],
    initialSession,
    onCancel,
    onCreateProject,
    onUpdateProject,
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
    const [step, setStep] = useState(1);
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
        } catch (err) {
            setError(err?.message || 'Operation failed.');
        } finally {
            setBusy(false);
        }
    };

    const toggleLayer = (layerId) => {
        setSelectedLayerIds((current) =>
            current.includes(layerId)
                ? current.filter((id) => id !== layerId)
                : [...current, layerId]
        );
    };

    const renderProjectStep = () => (
        <>
            <div className="form-group">
                <label>Project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Project number</label>
                <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Generate plan sheet frames along a stationed route centerline.
            </p>
        </>
    );

    const renderRouteStep = () => (
        <>
            <LayerSelect
                label="Route centerline (Project Stationing)"
                layers={stationingLayers}
                value={stationingLayerId}
                onChange={setStationingLayerId}
                emptyLabel="No Project Stationing centerline layers found"
            />
            {session?.stationingRoute ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    <div>Route: {session.stationingRoute.routeName}</div>
                    <div>Station range: {session.stationingRoute.profile?.start_station_label} – {session.stationingRoute.profile?.end_station_label}</div>
                </div>
            ) : null}
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                disabled={busy || !stationingLayerId}
                onClick={() => run(() => onSelectRoute?.(stationingLayerId), 'Route selected.')}
            >
                Select route
            </button>
        </>
    );

    const renderTemplateStep = () => (
        <>
            <div className="form-group">
                <label>Paper size</label>
                <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                    {paperSizes.map((size) => (
                        <option key={size} value={size}>{size.replace('_', ' ')}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label>Orientation</label>
                <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                    {orientations.map((entry) => (
                        <option key={entry} value={entry}>{entry}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label>Scale (1:n)</label>
                <input value={scale} onChange={(e) => setScale(e.target.value)} />
            </div>
            <label className="text-xs" style={{ display: 'block', marginBottom: 12 }}>
                <input type="checkbox" checked={includeOverview} onChange={(e) => setIncludeOverview(e.target.checked)} />
                {' '}Include overview sheet
            </label>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => run(() => onConfigureTemplate?.({
                    paperSize,
                    orientation,
                    scale: Number(scale) || 200,
                    includeOverview
                }), 'Template saved.')}
            >
                Save template
            </button>
            {frameDims ? (
                <p className="text-xs" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                    Map frame: {formatFeet(frameDims.mapFrameWidthFt)} × {formatFeet(frameDims.mapFrameHeightFt)}
                </p>
            ) : null}
            <div className="form-group" style={{ marginTop: 16 }}>
                <label>Design layers (optional, for feature assignment)</label>
                <div className="text-xs" style={{ maxHeight: 120, overflow: 'auto' }}>
                    {designLayers.map((layer) => (
                        <label key={layer.id} style={{ display: 'block', marginBottom: 4 }}>
                            <input type="checkbox" checked={selectedLayerIds.includes(layer.id)} onChange={() => toggleLayer(layer.id)} />
                            {' '}{layer.name} ({layer.featureCount})
                        </label>
                    ))}
                </div>
                {selectedLayerIds.length ? (
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ marginTop: 8 }}
                        disabled={busy}
                        onClick={() => run(() => onSelectDesignLayers?.(selectedLayerIds), 'Design features loaded.')}
                    >
                        Load design features
                    </button>
                ) : null}
            </div>
        </>
    );

    const renderGenerateStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Generate non-overlapping sheet frames tiled along the route with match-line boundaries.
            </p>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !session?.routeLine}
                onClick={() => run(() => onGenerateSheets?.(), `Generated ${sheets.length} sheet(s).`)}
            >
                Generate sheets
            </button>
            {sheets.length > 0 ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    <div><strong>{sheets.length}</strong> detail sheets</div>
                    <div>Match lines: {matchLines.length}</div>
                    {featureCount > 0 ? <div>Design features: {featureCount}</div> : null}
                </div>
            ) : null}
        </>
    );

    const renderReviewStep = () => (
        <>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => run(async () => {
                    const result = onValidate?.();
                    setValidation(result);
                    return session;
                }, 'Validation complete.')}
            >
                Run coverage check
            </button>
            {validation ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    {validation.warnings?.length ? (
                        <ul>{validation.warnings.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                    ) : <div>No warnings.</div>}
                </div>
            ) : null}
            {sheets.length > 0 ? (
                <div className="text-xs" style={{ marginTop: 12, maxHeight: 160, overflow: 'auto' }}>
                    {sheets.map((entry) => (
                        <div key={entry.sheetId}>
                            Sheet {entry.sheetNumber}: {formatFeet(entry.startDistanceFt)} – {formatFeet(entry.endDistanceFt)}
                        </div>
                    ))}
                </div>
            ) : null}
        </>
    );

    const renderExportStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
                PDF pages are captured from the live map (basemap, layers, and sheet outlines) so the export matches what you see on screen.
            </p>
            <div className="gis-widget__btn-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <button
                    type="button"
                    className="gis-widget__primary-btn"
                    disabled={busy || sheets.length === 0}
                    onClick={() => run(() => onExportPdf?.(), 'Sheet plan PDF downloaded.')}
                >
                    Export sheet plan PDF
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
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onOpenFullPlanExport?.()}
                >
                    Export full plan package
                </button>
            </div>
        </>
    );

    const stepContent = [
        renderProjectStep,
        renderRouteStep,
        renderTemplateStep,
        renderGenerateStep,
        renderReviewStep,
        renderExportStep
    ][step - 1]();

    const canGoNext = !busy && (
        step === 1 ? projectName.trim() :
        step === 2 ? Boolean(session?.stationingRoute) :
        step === 3 ? Boolean(session?.sheets?.template) :
        step === 4 ? sheets.length > 0 :
        true
    );

    const handleNext = async () => {
        if (step === 1) {
            await run(() => onCreateProject?.({ projectName, projectNumber }), 'Project created.');
        } else if (step === 2 && stationingLayerId && !session?.stationingRoute) {
            await run(() => onSelectRoute?.(stationingLayerId), 'Route selected.');
        } else if (step === 3) {
            await run(() => onConfigureTemplate?.({
                paperSize,
                orientation,
                scale: Number(scale) || 200,
                includeOverview
            }), 'Template saved.');
            if (selectedLayerIds.length) {
                await run(() => onSelectDesignLayers?.(selectedLayerIds));
            }
        } else if (step === 4 && !sheets.length) {
            await run(() => onGenerateSheets?.(), 'Sheets generated.');
        }
        if (canGoNext) setStep((current) => Math.min(current + 1, steps.length));
    };

    return (
        <WidgetPanelShell
            status={error || message}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            footer={(
                <div className="gis-widget__btn-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <button type="button" className="gis-widget__link-btn" disabled={busy || step <= 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>
                        Back
                    </button>
                    <button type="button" className="gis-widget__primary-btn" disabled={!canGoNext || busy || step >= steps.length} onClick={handleNext}>
                        {step >= steps.length ? 'Done' : 'Next'}
                    </button>
                </div>
            )}
        >
            <WidgetStepWizard steps={steps} currentStep={step} />
            {stepContent}
        </WidgetPanelShell>
    );
}
