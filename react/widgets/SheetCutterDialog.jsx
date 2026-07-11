import { useEffect, useMemo, useState } from 'react';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';

const WIZARD_STEPS = ['Route', 'Sheet layout', 'Numbering', 'Preview'];

const PRESET_OPTIONS = [
    { value: 'LETTER_LANDSCAPE', label: 'Letter landscape' },
    { value: 'TABLOID_LANDSCAPE', label: 'Tabloid landscape' },
    { value: 'ARCH_D_LANDSCAPE', label: 'ARCH D landscape' },
    { value: 'ARCH_E_LANDSCAPE', label: 'ARCH E landscape' },
    { value: 'CUSTOM', label: 'Custom' }
];

const ROTATION_OPTIONS = [
    { value: 'follow-centerline', label: 'Follow centerline' },
    { value: 'north-up', label: 'North up' }
];

function formatFeet(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value)).toLocaleString()} ft`;
}

function buildInput({
    layerId,
    layers,
    useSelectedOnly,
    routeNameField,
    startStation,
    reverseRoute,
    preset,
    orientation,
    usableFrameWidth,
    usableFrameHeight,
    scale,
    overlap,
    corridorWidth,
    rotationMode,
    prefix,
    startNumber,
    increment,
    padLength,
    aheadTemplate,
    backTemplate,
    matchlinesEnabled
}) {
    const layer = layers.find((entry) => entry.id === layerId);
    return {
        layerId,
        layerName: layer?.name || '',
        input: {
            options: {
                units: 'feet',
                routeNameField: routeNameField || null,
                useSelectedOnly,
                reverseRoute,
                startStation: Number(startStation) || 0,
                sourceLayerId: layerId,
                sheet: {
                    preset,
                    orientation,
                    usableFrameWidth: Number(usableFrameWidth) || 0,
                    usableFrameHeight: Number(usableFrameHeight) || 0,
                    scale,
                    overlap: Number(overlap) || 0,
                    corridorWidth: Number(corridorWidth) || 0
                },
                rotation: {
                    mode: rotationMode
                },
                numbering: {
                    prefix,
                    startNumber: Number(startNumber) || 1,
                    increment: Number(increment) || 1,
                    padLength: Number(padLength) || 0
                },
                matchlines: {
                    enabled: matchlinesEnabled,
                    aheadTemplate,
                    backTemplate
                }
            }
        }
    };
}

export function SheetCutterDialog({
    layers = [],
    defaultTemplate = {},
    onCancel,
    onPreview,
    onCreateOutput,
    onLayerFocus,
    onSubscribeSelection
}) {
    const [step, setStep] = useState(1);
    const [layerId, setLayerId] = useState('');
    const [useSelectedOnly, setUseSelectedOnly] = useState(true);
    const [routeNameField, setRouteNameField] = useState('');
    const [startStation, setStartStation] = useState('0');
    const [reverseRoute, setReverseRoute] = useState(false);
    const [preset, setPreset] = useState(defaultTemplate.preset || 'ARCH_D_LANDSCAPE');
    const [orientation, setOrientation] = useState(defaultTemplate.orientation || 'landscape');
    const [usableFrameWidth, setUsableFrameWidth] = useState(String(defaultTemplate.usableFrameWidth || 1600));
    const [usableFrameHeight, setUsableFrameHeight] = useState(String(defaultTemplate.usableFrameHeight || 900));
    const [scale, setScale] = useState(defaultTemplate.scale || '1in=100ft');
    const [overlap, setOverlap] = useState(String(defaultTemplate.overlap ?? 100));
    const [corridorWidth, setCorridorWidth] = useState(String(defaultTemplate.corridorWidth ?? 300));
    const [rotationMode, setRotationMode] = useState(defaultTemplate.rotationMode || 'follow-centerline');
    const [prefix, setPrefix] = useState(defaultTemplate.prefix || 'C-');
    const [startNumber, setStartNumber] = useState(String(defaultTemplate.startNumber ?? 101));
    const [increment, setIncrement] = useState(String(defaultTemplate.increment ?? 1));
    const [padLength, setPadLength] = useState(String(defaultTemplate.padLength ?? 0));
    const [aheadTemplate, setAheadTemplate] = useState(defaultTemplate.aheadTemplate || 'MATCHLINE - SEE SHEET {nextSheet}');
    const [backTemplate, setBackTemplate] = useState(defaultTemplate.backTemplate || 'MATCHLINE - SEE SHEET {previousSheet}');
    const [matchlinesEnabled, setMatchlinesEnabled] = useState(true);
    const [selectionCount, setSelectionCount] = useState(0);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const selectedLayer = useMemo(
        () => layers.find((layer) => layer.id === layerId) || null,
        [layers, layerId]
    );

    const fieldOptions = useMemo(() => selectedLayer?.fields || [], [selectedLayer]);

    useEffect(() => {
        if (!layerId || !onSubscribeSelection) return undefined;
        return onSubscribeSelection(layerId, setSelectionCount);
    }, [layerId, onSubscribeSelection]);

    const formPayload = () => buildInput({
        layerId,
        layers,
        useSelectedOnly,
        routeNameField,
        startStation,
        reverseRoute,
        preset,
        orientation,
        usableFrameWidth,
        usableFrameHeight,
        scale,
        overlap,
        corridorWidth,
        rotationMode,
        prefix,
        startNumber,
        increment,
        padLength,
        aheadTemplate,
        backTemplate,
        matchlinesEnabled
    });

    const runPreview = async () => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await onPreview?.(formPayload());
            setPreview(result || null);
            if (result?.warnings?.length) {
                setMessage(`${result.warnings.length} warning(s). Review before creating output layers.`);
            } else if (result?.ok) {
                setMessage('Preview generated.');
            }
        } catch (err) {
            setPreview(null);
            setError(err?.message || 'Preview failed.');
        } finally {
            setBusy(false);
        }
    };

    const createOutput = async () => {
        setBusy(true);
        setError('');
        try {
            await onCreateOutput?.(formPayload(), preview);
            setMessage('Output layers created.');
        } catch (err) {
            setError(err?.message || 'Unable to create output layers.');
        } finally {
            setBusy(false);
        }
    };

    const renderRouteStep = () => (
        <>
            <LayerSelect
                label="Centerline layer"
                layers={layers}
                value={layerId}
                onChange={(value) => {
                    setLayerId(value);
                    onLayerFocus?.(value);
                }}
                emptyLabel="No line layers found"
            />
            <label className="text-xs" style={{ display: 'block', marginBottom: 12 }}>
                <input
                    type="checkbox"
                    checked={useSelectedOnly}
                    onChange={(e) => setUseSelectedOnly(e.target.checked)}
                />
                {' '}Use selected features only
            </label>
            {useSelectedOnly ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
                    {selectionCount} feature{selectionCount === 1 ? '' : 's'} selected on the map.
                </p>
            ) : null}
            <div className="form-group">
                <label>Route name field (optional)</label>
                <select value={routeNameField} onChange={(e) => setRouteNameField(e.target.value)}>
                    <option value="">— none —</option>
                    {fieldOptions.map((field) => (
                        <option key={field} value={field}>{field}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label>Start station (ft)</label>
                <input value={startStation} onChange={(e) => setStartStation(e.target.value)} />
            </div>
            <label className="text-xs" style={{ display: 'block' }}>
                <input
                    type="checkbox"
                    checked={reverseRoute}
                    onChange={(e) => setReverseRoute(e.target.checked)}
                />
                {' '}Flip route direction
            </label>
        </>
    );

    const renderLayoutStep = () => (
        <>
            <div className="form-group">
                <label>Sheet size preset</label>
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {PRESET_OPTIONS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label>Page orientation</label>
                <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                </select>
            </div>
            <div className="form-group">
                <label>Usable map frame width (ft)</label>
                <input value={usableFrameWidth} onChange={(e) => setUsableFrameWidth(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Usable map frame height (ft)</label>
                <input value={usableFrameHeight} onChange={(e) => setUsableFrameHeight(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Map scale</label>
                <input value={scale} onChange={(e) => setScale(e.target.value)} placeholder="1in=100ft or 1:100" />
            </div>
            <div className="form-group">
                <label>Overlap (ft)</label>
                <input value={overlap} onChange={(e) => setOverlap(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Corridor width / buffer (ft)</label>
                <input value={corridorWidth} onChange={(e) => setCorridorWidth(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Rotation mode</label>
                <select value={rotationMode} onChange={(e) => setRotationMode(e.target.value)}>
                    {ROTATION_OPTIONS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                </select>
            </div>
        </>
    );

    const renderNumberingStep = () => (
        <>
            <div className="form-group">
                <label>Sheet prefix</label>
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Starting number</label>
                <input value={startNumber} onChange={(e) => setStartNumber(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Number increment</label>
                <input value={increment} onChange={(e) => setIncrement(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Number pad length</label>
                <input value={padLength} onChange={(e) => setPadLength(e.target.value)} />
            </div>
            <label className="text-xs" style={{ display: 'block', marginBottom: 12 }}>
                <input
                    type="checkbox"
                    checked={matchlinesEnabled}
                    onChange={(e) => setMatchlinesEnabled(e.target.checked)}
                />
                {' '}Create matchlines
            </label>
            <div className="form-group">
                <label>Ahead matchline template</label>
                <input value={aheadTemplate} onChange={(e) => setAheadTemplate(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Back matchline template</label>
                <input value={backTemplate} onChange={(e) => setBackTemplate(e.target.value)} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Example sheet names: {prefix}{startNumber}, {prefix}{Number(startNumber) + Number(increment || 1)}
            </p>
        </>
    );

    const renderPreviewStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Generate a map preview of sheet rectangles, matchlines, and labels before creating output layers.
            </p>
            <div className="gis-widget__btn-row" style={{ marginTop: 12, marginBottom: 12 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={runPreview}>
                    {preview ? 'Regenerate preview' : 'Generate preview'}
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => {
                        setReverseRoute((current) => !current);
                        setPreview(null);
                        setMessage('Route direction flipped. Regenerate preview.');
                    }}
                >
                    Flip route direction
                </button>
            </div>
            {preview?.summary ? (
                <div className="text-xs" style={{ marginBottom: 12 }}>
                    <div>Route length: {formatFeet(preview.summary.routeLengthFt)}</div>
                    <div>Sheets: {preview.summary.sheetCount}</div>
                    <div>Sheet length: {formatFeet(preview.summary.sheetLengthFt)}</div>
                    <div>Overlap: {formatFeet(preview.summary.overlapFt)}</div>
                    <div>Scale: {preview.summary.scale}</div>
                    <div>First sheet: {preview.summary.firstSheet || '—'}</div>
                    <div>Last sheet: {preview.summary.lastSheet || '—'}</div>
                </div>
            ) : null}
            {preview?.warnings?.length ? (
                <ul className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
                    {preview.warnings.map((entry) => <li key={entry}>{entry}</li>)}
                </ul>
            ) : null}
            {preview?.errors?.length ? (
                <ul className="text-xs" style={{ color: 'var(--danger)', marginBottom: 12 }}>
                    {preview.errors.map((entry) => <li key={entry}>{entry}</li>)}
                </ul>
            ) : null}
            {preview?.sheetIndexRows?.length ? (
                <div className="text-xs" style={{ maxHeight: 140, overflow: 'auto' }}>
                    {preview.sheetIndexRows.map((row) => (
                        <div key={row.sheet_id}>
                            {row.sheet_name}: {row.station_start} – {row.station_end}
                        </div>
                    ))}
                </div>
            ) : null}
        </>
    );

    const stepContent = [
        renderRouteStep,
        renderLayoutStep,
        renderNumberingStep,
        renderPreviewStep
    ][step - 1]();

    const canGoNext = !busy && (
        step === 1 ? Boolean(layerId) && (!useSelectedOnly || selectionCount > 0) :
        step === 2 ? Boolean(usableFrameWidth) && Boolean(usableFrameHeight) && Boolean(scale) :
        step === 3 ? Boolean(prefix) && Boolean(startNumber) :
        true
    );

    const footer = step < WIZARD_STEPS.length ? (
        <div className="gis-widget__btn-row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <button
                type="button"
                className="gis-widget__link-btn"
                disabled={busy || step <= 1}
                onClick={() => setStep((current) => Math.max(1, current - 1))}
            >
                Back
            </button>
            <button
                type="button"
                className="gis-widget__primary-btn"
                disabled={!canGoNext || busy}
                onClick={() => setStep((current) => Math.min(current + 1, WIZARD_STEPS.length))}
            >
                Next
            </button>
        </div>
    ) : (
        <div className="gis-widget__btn-row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <button type="button" className="gis-widget__link-btn" disabled={busy} onClick={onCancel}>
                Cancel
            </button>
            <button
                type="button"
                className="gis-widget__primary-btn"
                disabled={busy || !preview?.ok}
                onClick={createOutput}
            >
                Create output layers
            </button>
        </div>
    );

    return (
        <WidgetPanelShell
            status={error || message}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            footer={footer}
        >
            <WidgetStepWizard steps={WIZARD_STEPS} currentStep={step} />
            {stepContent}
        </WidgetPanelShell>
    );
}
