import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApplyToSelector, isApplyToValid } from '../tools/ApplyToSelector.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';

const PREVIEW_DEBOUNCE_MS = 500;
const WIZARD_STEPS = ['Choose layers', 'What to add', 'Review & run'];

function formatValue(value) {
    if (value == null) return '-';
    if (typeof value === 'number') {
        if (Math.abs(value) < 100) return value.toFixed(2);
        return Math.round(value).toLocaleString();
    }
    return String(value);
}

function buildFieldMappings(selectedFields = []) {
    return selectedFields.map((field) => ({
        targetField: field,
        newFieldName: `nearest_${field}`
    }));
}

function hasOutput({
    selectedFields = [],
    writeDistance = true,
    writeMatchId = false,
    writeMatchLayer = false,
    matchIdField = ''
}) {
    return selectedFields.length > 0
        || writeDistance
        || writeMatchLayer
        || (writeMatchId && matchIdField);
}

function buildSummary({
    sourceLayer,
    targetLayer,
    applyTo,
    selectionCount,
    selectedFields,
    writeDistance,
    writeMatchId,
    writeMatchLayer,
    maxRadius,
    unitsLabel
}) {
    const featureCount = applyTo === 'selection'
        ? selectionCount
        : (sourceLayer?.featureCount || 0);
    const parts = [];
    if (writeDistance) parts.push('distance to nearest match');
    if (selectedFields.length > 0) {
        parts.push(`${selectedFields.length} copied field${selectedFields.length === 1 ? '' : 's'}`);
    }
    if (writeMatchId) parts.push('matched target ID');
    if (writeMatchLayer) parts.push('matched target layer name');
    const outputText = parts.length ? parts.join(', ') : 'nothing selected';

    return [
        `Updating ${featureCount.toLocaleString()} feature${featureCount === 1 ? '' : 's'} in ${sourceLayer?.name || 'source layer'}.`,
        `Finding nearest matches in ${targetLayer?.name || 'target layer'}.`,
        `Adding ${outputText}.`,
        maxRadius ? `Max search radius: ${maxRadius} ${unitsLabel}.` : 'No max search radius (unlimited).'
    ];
}

export function ProximityJoinDialog({
    layers = [],
    unitOptions = [],
    onCancel,
    onPreview,
    onRun,
    onLayerFocus,
    onSubscribeSelection
}) {
    const [step, setStep] = useState(1);
    const [sourceLayerId, setSourceLayerId] = useState('');
    const [targetLayerId, setTargetLayerId] = useState('');
    const [applyTo, setApplyTo] = useState('layer');
    const [selectionCount, setSelectionCount] = useState(0);
    const [units, setUnits] = useState(unitOptions[0]?.value || 'feet');
    const [maxRadius, setMaxRadius] = useState('');
    const [writeDistance, setWriteDistance] = useState(true);
    const [writeMatchId, setWriteMatchId] = useState(false);
    const [matchIdField, setMatchIdField] = useState('');
    const [writeMatchLayer, setWriteMatchLayer] = useState(false);
    const [selectedFields, setSelectedFields] = useState([]);
    const [preview, setPreview] = useState(null);
    const [results, setResults] = useState(null);
    const [status, setStatus] = useState('');
    const [running, setRunning] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState('');
    const cancelRef = useRef(false);
    const previewTimer = useRef(null);
    const previewRequestId = useRef(0);

    const sourceLayer = useMemo(
        () => layers.find((layer) => layer.id === sourceLayerId) || null,
        [layers, sourceLayerId]
    );
    const targetLayer = useMemo(
        () => layers.find((layer) => layer.id === targetLayerId) || null,
        [layers, targetLayerId]
    );
    const unitsLabel = useMemo(
        () => unitOptions.find((opt) => opt.value === units)?.label?.match(/\(([^)]+)\)/)?.[1] || units,
        [unitOptions, units]
    );

    const fieldMappings = useMemo(
        () => buildFieldMappings(selectedFields),
        [selectedFields]
    );

    const selectionOnly = applyTo === 'selection';

    const buildConfig = useCallback(() => ({
        sourceLayerId,
        targetLayerId,
        selectionOnly,
        units,
        maxRadius,
        writeDistance,
        writeMatchId,
        matchIdField,
        writeMatchLayer,
        fieldMappings
    }), [
        sourceLayerId,
        targetLayerId,
        selectionOnly,
        units,
        maxRadius,
        writeDistance,
        writeMatchId,
        matchIdField,
        writeMatchLayer,
        fieldMappings
    ]);

    const canAdvanceStep1 = Boolean(
        sourceLayerId &&
        targetLayerId &&
        sourceLayerId !== targetLayerId &&
        isApplyToValid(applyTo, selectionCount)
    );

    const canAdvanceStep2 = hasOutput({
        selectedFields,
        writeDistance,
        writeMatchId,
        writeMatchLayer,
        matchIdField
    });

    const canRun = canAdvanceStep1 && canAdvanceStep2;

    useEffect(() => {
        if (!sourceLayerId || !onSubscribeSelection) {
            setSelectionCount(0);
            return undefined;
        }
        return onSubscribeSelection(sourceLayerId, setSelectionCount);
    }, [sourceLayerId, onSubscribeSelection]);

    useEffect(() => {
        if (sourceLayerId) onLayerFocus?.(sourceLayerId);
    }, [sourceLayerId, onLayerFocus]);

    const onSourceLayerChange = (nextSourceId) => {
        setSourceLayerId(nextSourceId);
        setSelectedFields([]);
        setPreview(null);
        setResults(null);
        setError('');
    };

    const onTargetLayerChange = (nextTargetId) => {
        setTargetLayerId(nextTargetId);
        setSelectedFields([]);
        setPreview(null);
        setResults(null);
        setError('');
        setMatchIdField('');
    };

    const toggleField = (field) => {
        setSelectedFields((current) => (
            current.includes(field)
                ? current.filter((entry) => entry !== field)
                : [...current, field]
        ));
    };

    useEffect(() => {
        if (step !== 3 || !canRun || results || running) {
            if (previewTimer.current) clearTimeout(previewTimer.current);
            if (step !== 3) setPreview(null);
            return undefined;
        }

        if (previewTimer.current) clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(async () => {
            const requestId = ++previewRequestId.current;
            setPreviewing(true);
            setError('');
            try {
                const data = await onPreview?.(buildConfig());
                if (requestId !== previewRequestId.current) return;
                setPreview(data?.rows?.length ? data : null);
            } catch (err) {
                if (requestId !== previewRequestId.current) return;
                setPreview(null);
                setError(err?.message || 'Unable to build preview.');
            } finally {
                if (requestId === previewRequestId.current) {
                    setPreviewing(false);
                }
            }
        }, PREVIEW_DEBOUNCE_MS);

        return () => {
            if (previewTimer.current) clearTimeout(previewTimer.current);
        };
    }, [
        step,
        canRun,
        sourceLayerId,
        targetLayerId,
        selectionOnly,
        units,
        maxRadius,
        writeDistance,
        writeMatchId,
        matchIdField,
        writeMatchLayer,
        selectedFields,
        results,
        running,
        onPreview,
        buildConfig
    ]);

    const runJoin = async () => {
        cancelRef.current = false;
        setRunning(true);
        setStatus('Initializing...');
        setError('');
        setPreview(null);
        previewRequestId.current += 1;
        try {
            const output = await onRun?.(buildConfig(), {
                onProgress: (nextStatus) => setStatus(nextStatus || ''),
                isCancelled: () => cancelRef.current
            });
            if (output?.cancelled) {
                setStatus('Cancelled.');
                return;
            }
            setResults(output || null);
            setStatus('');
        } catch (err) {
            setError(err?.message || 'Proximity join failed.');
            setStatus('');
        } finally {
            setRunning(false);
        }
    };

    const goNext = () => {
        setError('');
        if (step === 1 && !canAdvanceStep1) {
            setError(applyTo === 'selection' && selectionCount === 0
                ? 'Select features on the map first, or choose entire layer.'
                : 'Choose two different layers to continue.');
            return;
        }
        if (step === 2 && !canAdvanceStep2) {
            setError('Choose at least one thing to add (distance, a copied field, or match info).');
            return;
        }
        setStep((current) => Math.min(current + 1, 3));
    };

    const wizardFooter = (primaryAction) => (
        <div className="modal-footer">
            <button type="button" className="btn btn-secondary cancel-btn" onClick={() => onCancel?.()}>
                Cancel
            </button>
            {step > 1 ? (
                <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setStep((current) => current - 1); }}>
                    Back
                </button>
            ) : null}
            {primaryAction}
        </div>
    );

    if (running) {
        return (
            <WidgetPanelShell
                status={status || 'Working...'}
                footer={(
                    <div className="modal-footer">
                        <button
                            type="button"
                            className="btn btn-secondary cancel-btn"
                            onClick={() => { cancelRef.current = true; setStatus('Cancelling...'); }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            >
                <div className="gis-widget__running">
                    <div className="gis-widget__spinner" />
                </div>
            </WidgetPanelShell>
        );
    }

    if (results) {
        return (
            <WidgetPanelShell
                onCancel={onCancel}
                cancelLabel="Done"
                showRun={false}
                footer={wizardFooter(
                    <button
                        type="button"
                        className="btn btn-primary apply-btn"
                        onClick={() => { setResults(null); setStep(3); setError(''); }}
                    >
                        Run again
                    </button>
                )}
            >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Results</div>
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                    <div><strong>{results.total?.toLocaleString?.() || results.total || 0}</strong> features processed</div>
                    <div><strong>{results.matched?.toLocaleString?.() || results.matched || 0}</strong> matched</div>
                    <div><strong>{results.unmatched?.toLocaleString?.() || results.unmatched || 0}</strong> unmatched</div>
                    {results.avgDist > 0 ? (
                        <div>Average distance: {formatValue(results.avgDist)} {results.unitsLabel || unitsLabel}</div>
                    ) : null}
                </div>
                {results.warnings?.length ? (
                    <ul className="text-xs text-muted" style={{ paddingLeft: 16, margin: 0 }}>
                        {results.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                ) : null}
            </WidgetPanelShell>
        );
    }

    const statusText = error || (step === 3 && previewing ? 'Updating preview…' : '');

    const summaryLines = buildSummary({
        sourceLayer,
        targetLayer,
        applyTo,
        selectionCount,
        selectedFields,
        writeDistance,
        writeMatchId,
        writeMatchLayer,
        maxRadius,
        unitsLabel
    });

    return (
        <WidgetPanelShell
            status={statusText}
            statusTone={error ? 'danger' : 'muted'}
            showRun={false}
            footer={wizardFooter(
                step < 3 ? (
                    <button
                        type="button"
                        className="btn btn-primary apply-btn"
                        onClick={goNext}
                    >
                        Next
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn btn-primary apply-btn"
                        onClick={runJoin}
                        disabled={!canRun}
                    >
                        Run Proximity Join
                    </button>
                )
            )}
        >
            <WidgetStepWizard steps={WIZARD_STEPS} currentStep={step} />

            {step === 1 ? (
                <>
                    <p className="text-xs text-muted" style={{ marginTop: 0, marginBottom: 12 }}>
                        Update features in one layer by finding the nearest match in another layer.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <LayerSelect
                            label="Layer to update"
                            value={sourceLayerId}
                            layers={layers}
                            placeholder="- choose layer -"
                            onChange={onSourceLayerChange}
                        />
                        <LayerSelect
                            label="Nearest-match layer"
                            value={targetLayerId}
                            layers={layers.filter((layer) => layer.id !== sourceLayerId)}
                            placeholder="- choose layer -"
                            onChange={onTargetLayerChange}
                        />
                    </div>
                    {sourceLayer ? (
                        <ApplyToSelector
                            selectionCount={selectionCount}
                            totalCount={sourceLayer.featureCount}
                            layerName={sourceLayer.name}
                            defaultApplyTo="layer"
                            onChange={setApplyTo}
                        />
                    ) : null}
                </>
            ) : null}

            {step === 2 ? (
                <>
                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            checked={writeDistance}
                            onChange={(e) => setWriteDistance(e.target.checked)}
                        />
                        Add distance to nearest match
                    </label>

                    {targetLayer?.fields?.length ? (
                        <div className="form-group" style={{ marginTop: 12 }}>
                            <label>Copy fields from nearest match</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                                {targetLayer.fields.map((field) => (
                                    <label key={field} className="checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={selectedFields.includes(field)}
                                            onChange={() => toggleField(field)}
                                        />
                                        <span>
                                            {field}
                                            {selectedFields.includes(field) ? (
                                                <span className="text-xs text-muted"> → nearest_{field}</span>
                                            ) : null}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <details className="form-group" style={{ marginTop: 12 }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Advanced options</summary>
                        <div style={{ marginTop: 10 }}>
                            <div className="gis-widget__btn-row">
                                <select value={units} onChange={(e) => setUnits(e.target.value)}>
                                    {unitOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={maxRadius}
                                    placeholder="Max search radius (optional)"
                                    onChange={(e) => setMaxRadius(e.target.value)}
                                />
                            </div>
                            <label className="checkbox-row" style={{ marginTop: 8 }}>
                                <input
                                    type="checkbox"
                                    checked={writeMatchId}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setWriteMatchId(checked);
                                        if (!checked) setMatchIdField('');
                                    }}
                                />
                                Add matched target ID
                            </label>
                            {writeMatchId ? (
                                <select value={matchIdField} onChange={(e) => setMatchIdField(e.target.value)}>
                                    <option value="">- choose ID field -</option>
                                    {targetLayer?.fields?.map((field) => (
                                        <option key={`id-${field}`} value={field}>{field}</option>
                                    ))}
                                </select>
                            ) : null}
                            <label className="checkbox-row" style={{ marginTop: 6 }}>
                                <input
                                    type="checkbox"
                                    checked={writeMatchLayer}
                                    onChange={(e) => setWriteMatchLayer(e.target.checked)}
                                />
                                Add matched target layer name
                            </label>
                        </div>
                    </details>
                </>
            ) : null}

            {step === 3 ? (
                <>
                    <div className="form-group">
                        <label>Summary</label>
                        <ul className="text-xs text-muted" style={{ paddingLeft: 16, margin: 0 }}>
                            {summaryLines.map((line) => (
                                <li key={line}>{line}</li>
                            ))}
                        </ul>
                    </div>

                    {preview?.rows?.length ? (
                        <div className="form-group">
                            <label>Preview (first {preview.rows.length})</label>
                            <div className="gis-widget__preview-table">
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            {preview.columns.map((col) => (
                                                <th key={col} style={{ textAlign: 'left', fontSize: 11, padding: 4 }}>{col}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.rows.map((row, idx) => (
                                            <tr key={`row-${idx}`}>
                                                {preview.columns.map((col) => (
                                                    <td key={`${idx}-${col}`} style={{ fontSize: 11, padding: 4 }}>{formatValue(row[col])}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}
                </>
            ) : null}
        </WidgetPanelShell>
    );
}
