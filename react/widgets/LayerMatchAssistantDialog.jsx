import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FieldSelect } from './shared/FieldSelect.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { RunPreviewFooter } from './shared/RunPreviewFooter.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';

const PREVIEW_DEBOUNCE_MS = 500;
const WIZARD_STEPS = ['Choose layers', 'Coordinates & fields', 'Match rules', 'Review & run'];
const MAX_OPTIONAL_PAIRS = 3;

const OUTPUT_OPTIONS = [
    { key: 'confirmed', label: 'Confirmed Matches' },
    { key: 'likely', label: 'Likely Matches' },
    { key: 'possible', label: 'Possible Matches' },
    { key: 'unmatchedA', label: 'Unmatched Layer A' },
    { key: 'unmatchedB', label: 'Unmatched Layer B' },
    { key: 'conflicts', label: 'Conflict Matches' },
    { key: 'reviewTable', label: 'Full Match Review Table' }
];

const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'Confirmed match', label: 'Confirmed' },
    { key: 'Likely match', label: 'Likely' },
    { key: 'Possible match', label: 'Possible' },
    { key: 'Conflict', label: 'Conflicts' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' }
];

function formatValue(value) {
    if (value == null || value === '') return '-';
    if (typeof value === 'number') {
        if (Math.abs(value) < 100) return value.toFixed(1);
        return Math.round(value).toLocaleString();
    }
    return String(value);
}

function defaultOutputSelection() {
    return OUTPUT_OPTIONS.reduce((acc, option) => {
        acc[option.key] = true;
        return acc;
    }, {});
}

function LayerSideFields({
    sideLabel,
    layer,
    useGeometry,
    onUseGeometryChange,
    latField,
    lonField,
    nameField,
    onLatFieldChange,
    onLonFieldChange,
    onNameFieldChange
}) {
    const fields = layer?.fields || [];
    return (
        <div className="form-group">
            <label>{sideLabel}</label>
            <label className="checkbox-row">
                <input
                    type="checkbox"
                    checked={useGeometry}
                    onChange={(e) => onUseGeometryChange(e.target.checked)}
                />
                Use existing geometry
            </label>
            {!useGeometry ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div>
                        <label className="text-xs text-muted">Latitude field</label>
                        <FieldSelect
                            value={latField}
                            fields={fields}
                            placeholder="- latitude -"
                            onChange={onLatFieldChange}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted">Longitude field</label>
                        <FieldSelect
                            value={lonField}
                            fields={fields}
                            placeholder="- longitude -"
                            onChange={onLonFieldChange}
                        />
                    </div>
                </div>
            ) : null}
            <div style={{ marginTop: 8 }}>
                <label className="text-xs text-muted">Optional name/title field</label>
                <FieldSelect
                    value={nameField}
                    fields={fields}
                    placeholder="- optional name field -"
                    onChange={onNameFieldChange}
                />
            </div>
        </div>
    );
}

export function LayerMatchAssistantDialog({
    layers = [],
    strictnessOptions = [],
    tolerancePresets = [],
    onCancel,
    onPreview,
    onValidate,
    onRun,
    onRowFocus,
    onAddOutputs,
    onLayerFocus
}) {
    const [step, setStep] = useState(1);
    const [layerAId, setLayerAId] = useState('');
    const [layerBId, setLayerBId] = useState('');
    const [layerAUseGeometry, setLayerAUseGeometry] = useState(true);
    const [layerBUseGeometry, setLayerBUseGeometry] = useState(true);
    const [layerALatField, setLayerALatField] = useState('');
    const [layerALonField, setLayerALonField] = useState('');
    const [layerBLatField, setLayerBLatField] = useState('');
    const [layerBLonField, setLayerBLonField] = useState('');
    const [layerANameField, setLayerANameField] = useState('');
    const [layerBNameField, setLayerBNameField] = useState('');
    const [optionalFieldPairs, setOptionalFieldPairs] = useState([]);
    const [strictness, setStrictness] = useState('balanced');
    const [tolerancePreset, setTolerancePreset] = useState('close');
    const [customToleranceFeet, setCustomToleranceFeet] = useState('50');
    const [textOnly, setTextOnly] = useState(false);
    const [preview, setPreview] = useState(null);
    const [validationWarnings, setValidationWarnings] = useState([]);
    const [results, setResults] = useState(null);
    const [matchRows, setMatchRows] = useState([]);
    const [selectedRowIndex, setSelectedRowIndex] = useState(-1);
    const [statusFilter, setStatusFilter] = useState('all');
    const [outputSelection, setOutputSelection] = useState(defaultOutputSelection);
    const [status, setStatus] = useState('');
    const [running, setRunning] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState('');
    const cancelRef = useRef(false);
    const previewTimer = useRef(null);
    const previewRequestId = useRef(0);

    const layerA = useMemo(
        () => layers.find((layer) => layer.id === layerAId) || null,
        [layers, layerAId]
    );
    const layerB = useMemo(
        () => layers.find((layer) => layer.id === layerBId) || null,
        [layers, layerBId]
    );

    const buildConfig = useCallback(() => ({
        layerAId,
        layerBId,
        layerAUseGeometry,
        layerBUseGeometry,
        layerALatField,
        layerALonField,
        layerBLatField,
        layerBLonField,
        layerANameField,
        layerBNameField,
        optionalFieldPairs,
        strictness,
        tolerancePreset,
        customToleranceFeet,
        textOnly
    }), [
        layerAId,
        layerBId,
        layerAUseGeometry,
        layerBUseGeometry,
        layerALatField,
        layerALonField,
        layerBLatField,
        layerBLonField,
        layerANameField,
        layerBNameField,
        optionalFieldPairs,
        strictness,
        tolerancePreset,
        customToleranceFeet,
        textOnly
    ]);

    const canAdvanceStep1 = Boolean(layerAId && layerBId && layerAId !== layerBId);

    const canAdvanceStep2 = useMemo(() => {
        const aCoordsOk = layerAUseGeometry || (layerALatField && layerALonField);
        const bCoordsOk = layerBUseGeometry || (layerBLatField && layerBLonField);
        return aCoordsOk && bCoordsOk;
    }, [
        layerAUseGeometry,
        layerBUseGeometry,
        layerALatField,
        layerALonField,
        layerBLatField,
        layerBLonField
    ]);

    const canRun = canAdvanceStep1 && canAdvanceStep2;

    useEffect(() => {
        if (layerAId) onLayerFocus?.(layerAId);
    }, [layerAId, onLayerFocus]);

    const resetFlow = () => {
        setResults(null);
        setMatchRows([]);
        setSelectedRowIndex(-1);
        setPreview(null);
        setError('');
    };

    const onLayerAChange = (nextId) => {
        setLayerAId(nextId);
        setLayerALatField('');
        setLayerALonField('');
        setLayerANameField('');
        resetFlow();
    };

    const onLayerBChange = (nextId) => {
        setLayerBId(nextId);
        setLayerBLatField('');
        setLayerBLonField('');
        setLayerBNameField('');
        setOptionalFieldPairs([]);
        resetFlow();
    };

    const addOptionalPair = () => {
        setOptionalFieldPairs((current) => (
            current.length >= MAX_OPTIONAL_PAIRS
                ? current
                : [...current, { fieldA: '', fieldB: '' }]
        ));
    };

    const updateOptionalPair = (index, side, value) => {
        setOptionalFieldPairs((current) => current.map((pair, idx) => (
            idx === index ? { ...pair, [side]: value } : pair
        )));
    };

    const removeOptionalPair = (index) => {
        setOptionalFieldPairs((current) => current.filter((_, idx) => idx !== index));
    };

    useEffect(() => {
        if (step !== 4 || !canRun || results || running) {
            if (previewTimer.current) clearTimeout(previewTimer.current);
            if (step !== 4) setPreview(null);
            return undefined;
        }

        previewTimer.current = setTimeout(async () => {
            const requestId = ++previewRequestId.current;
            setPreviewing(true);
            setError('');
            try {
                const validation = await onValidate?.(buildConfig());
                if (requestId !== previewRequestId.current) return;
                setValidationWarnings(validation?.warnings || []);
                const data = await onPreview?.(buildConfig());
                if (requestId !== previewRequestId.current) return;
                setPreview(data?.rows?.length ? data : null);
                if (data?.warnings?.length) {
                    setValidationWarnings((current) => [...new Set([...current, ...data.warnings])]);
                }
            } catch (err) {
                if (requestId !== previewRequestId.current) return;
                setPreview(null);
                setError(err?.message || 'Unable to build preview.');
            } finally {
                if (requestId === previewRequestId.current) setPreviewing(false);
            }
        }, PREVIEW_DEBOUNCE_MS);

        return () => {
            if (previewTimer.current) clearTimeout(previewTimer.current);
        };
    }, [step, canRun, results, running, buildConfig, onPreview, onValidate]);

    const runMatching = async () => {
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
            setResults(output);
            setMatchRows((output?.matches || []).map((row) => ({ ...row })));
            setStep(5);
            setStatus('');
        } catch (err) {
            setError(err?.message || 'Layer matching failed.');
            setStatus('');
        } finally {
            setRunning(false);
        }
    };

    const filteredRows = useMemo(() => {
        return matchRows.filter((row) => {
            if (statusFilter === 'all') return true;
            if (statusFilter === 'approved') return row.user_decision === 'approved';
            if (statusFilter === 'rejected') return row.user_decision === 'rejected';
            return row.match_status === statusFilter;
        });
    }, [matchRows, statusFilter]);

    const updateRowDecision = (index, decision) => {
        setMatchRows((current) => current.map((row, idx) => (
            idx === index ? { ...row, user_decision: decision } : row
        )));
    };

    const handleRowSelect = (row, index) => {
        setSelectedRowIndex(index);
        onRowFocus?.(row, {
            layerAName: results?.layerAName,
            layerBName: results?.layerBName
        });
    };

    const handleAddOutputs = () => {
        onAddOutputs?.(
            { ...results, matches: matchRows },
            outputSelection,
            buildConfig()
        );
    };

    const goNext = () => {
        setError('');
        if (step === 1 && !canAdvanceStep1) {
            setError('Choose two different layers to continue.');
            return;
        }
        if (step === 2 && !canAdvanceStep2) {
            setError('Choose geometry or latitude/longitude fields for both layers.');
            return;
        }
        setStep((current) => Math.min(current + 1, 4));
    };

    if (running) {
        return (
            <WidgetPanelShell
                status={status || 'Working...'}
                footer={(
                    <RunPreviewFooter
                        onCancel={() => { cancelRef.current = true; setStatus('Cancelling...'); }}
                        showRun={false}
                    />
                )}
            >
                <div className="gis-widget__running">
                    <div className="gis-widget__spinner" />
                </div>
            </WidgetPanelShell>
        );
    }

    if (step === 5 && results) {
        return (
            <WidgetPanelShell
                onCancel={onCancel}
                cancelLabel="Done"
                showRun={false}
                footer={(
                    <RunPreviewFooter
                        onCancel={onCancel}
                        cancelLabel="Done"
                        middleActions={(
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => { setStep(4); setResults(null); setMatchRows([]); }}
                            >
                                Run again
                            </button>
                        )}
                        onRun={handleAddOutputs}
                        runLabel="Add outputs"
                    />
                )}
            >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Match results</div>
                <div style={{ fontSize: 12, marginBottom: 10 }}>
                    <div><strong>{results.stats?.totalA ?? 0}</strong> Layer A records</div>
                    <div><strong>{results.stats?.totalB ?? 0}</strong> Layer B records</div>
                    <div><strong>{matchRows.length}</strong> proposed matches</div>
                    <div><strong>{results.unmatchedA?.length ?? 0}</strong> unmatched A</div>
                    <div><strong>{results.unmatchedB?.length ?? 0}</strong> unmatched B</div>
                </div>

                <div className="form-group">
                    <label>Outputs to create</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {OUTPUT_OPTIONS.map((option) => (
                            <label key={option.key} className="checkbox-row">
                                <input
                                    type="checkbox"
                                    checked={outputSelection[option.key] !== false}
                                    onChange={(e) => setOutputSelection((current) => ({
                                        ...current,
                                        [option.key]: e.target.checked
                                    }))}
                                />
                                {option.label}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="form-group">
                    <label>Review matches</label>
                    <div className="gis-widget__btn-row" style={{ marginBottom: 8 }}>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            {STATUS_FILTERS.map((filter) => (
                                <option key={filter.key} value={filter.key}>{filter.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="gis-widget__preview-table" style={{ maxHeight: 220, overflow: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    {['A', 'B', 'Dist (ft)', 'Score', 'Status', 'Actions'].map((col) => (
                                        <th key={col} style={{ textAlign: 'left', fontSize: 11, padding: 4 }}>{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((row) => {
                                    const rowIndex = matchRows.indexOf(row);
                                    const active = rowIndex === selectedRowIndex;
                                    return (
                                        <tr
                                            key={`${row.source_a_uid}-${row.source_b_uid}`}
                                            style={{ background: active ? 'var(--bg-surface)' : 'transparent', cursor: 'pointer' }}
                                            onClick={() => handleRowSelect(row, rowIndex)}
                                        >
                                            <td style={{ fontSize: 11, padding: 4 }}>{formatValue(row.a_name)}</td>
                                            <td style={{ fontSize: 11, padding: 4 }}>{formatValue(row.b_name)}</td>
                                            <td style={{ fontSize: 11, padding: 4 }}>{formatValue(row.distance_feet)}</td>
                                            <td style={{ fontSize: 11, padding: 4 }}>{formatValue(row.final_score)}</td>
                                            <td style={{ fontSize: 11, padding: 4 }}>{row.user_decision || row.match_status}</td>
                                            <td style={{ fontSize: 11, padding: 4 }}>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    style={{ fontSize: 10, padding: '2px 6px', marginRight: 4 }}
                                                    onClick={(e) => { e.stopPropagation(); updateRowDecision(rowIndex, 'approved'); }}
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    style={{ fontSize: 10, padding: '2px 6px' }}
                                                    onClick={(e) => { e.stopPropagation(); updateRowDecision(rowIndex, 'rejected'); }}
                                                >
                                                    Reject
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {selectedRowIndex >= 0 && matchRows[selectedRowIndex] ? (
                        <div className="text-xs text-muted" style={{ marginTop: 8 }}>
                            {matchRows[selectedRowIndex].match_reason}
                        </div>
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

    const statusText = error || (step === 4 && previewing ? 'Updating preview…' : '');

    return (
        <WidgetPanelShell
            status={statusText}
            statusTone={error ? 'danger' : 'muted'}
            showRun={false}
            footer={(
                <RunPreviewFooter
                    onCancel={onCancel}
                    showBack={step > 1 && step < 5}
                    onBack={() => { setError(''); setStep((current) => current - 1); }}
                    showRun={step >= 4}
                    onRun={runMatching}
                    runLabel="Run matching"
                    disabled={!canRun}
                    primaryAction={step < 4 ? (
                        <button type="button" className="btn btn-primary apply-btn" onClick={goNext}>
                            Next
                        </button>
                    ) : null}
                />
            )}
        >
            <WidgetStepWizard steps={WIZARD_STEPS} currentStep={Math.min(step, 4)} />

            {step === 1 ? (
                <>
                    <p className="text-xs text-muted" style={{ marginTop: 0, marginBottom: 12 }}>
                        Compare two layers using location and fuzzy name matching.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <LayerSelect
                            label="Layer A"
                            value={layerAId}
                            layers={layers}
                            placeholder="- choose layer -"
                            onChange={onLayerAChange}
                        />
                        <LayerSelect
                            label="Layer B"
                            value={layerBId}
                            layers={layers.filter((layer) => layer.id !== layerAId)}
                            placeholder="- choose layer -"
                            onChange={onLayerBChange}
                        />
                    </div>
                </>
            ) : null}

            {step === 2 ? (
                <>
                    <LayerSideFields
                        sideLabel="Layer A"
                        layer={layerA}
                        useGeometry={layerAUseGeometry}
                        onUseGeometryChange={setLayerAUseGeometry}
                        latField={layerALatField}
                        lonField={layerALonField}
                        nameField={layerANameField}
                        onLatFieldChange={setLayerALatField}
                        onLonFieldChange={setLayerALonField}
                        onNameFieldChange={setLayerANameField}
                    />
                    <LayerSideFields
                        sideLabel="Layer B"
                        layer={layerB}
                        useGeometry={layerBUseGeometry}
                        onUseGeometryChange={setLayerBUseGeometry}
                        latField={layerBLatField}
                        lonField={layerBLonField}
                        nameField={layerBNameField}
                        onLatFieldChange={setLayerBLatField}
                        onLonFieldChange={setLayerBLonField}
                        onNameFieldChange={setLayerBNameField}
                    />

                    <div className="form-group">
                        <label>Optional supporting field pairs</label>
                        {optionalFieldPairs.map((pair, index) => (
                            <div key={`pair-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                                <FieldSelect
                                    value={pair.fieldA}
                                    fields={layerA?.fields || []}
                                    placeholder="Layer A field"
                                    onChange={(value) => updateOptionalPair(index, 'fieldA', value)}
                                />
                                <FieldSelect
                                    value={pair.fieldB}
                                    fields={layerB?.fields || []}
                                    placeholder="Layer B field"
                                    onChange={(value) => updateOptionalPair(index, 'fieldB', value)}
                                />
                                <button type="button" className="btn btn-secondary" onClick={() => removeOptionalPair(index)}>
                                    Remove
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={addOptionalPair}
                            disabled={optionalFieldPairs.length >= MAX_OPTIONAL_PAIRS}
                        >
                            Add field pair
                        </button>
                    </div>
                </>
            ) : null}

            {step === 3 ? (
                <>
                    <div className="form-group">
                        <label>Matching strictness</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {strictnessOptions.map((option) => (
                                <label key={option.value} className="checkbox-row">
                                    <input
                                        type="radio"
                                        name="strictness"
                                        checked={strictness === option.value}
                                        onChange={() => setStrictness(option.value)}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Spatial tolerance</label>
                        <select value={tolerancePreset} onChange={(e) => setTolerancePreset(e.target.value)}>
                            {tolerancePresets.map((preset) => (
                                <option key={preset.value} value={preset.value}>{preset.label}</option>
                            ))}
                        </select>
                        {tolerancePreset === 'custom' ? (
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={customToleranceFeet}
                                placeholder="Custom distance (feet)"
                                onChange={(e) => setCustomToleranceFeet(e.target.value)}
                                style={{ marginTop: 8 }}
                            />
                        ) : null}
                    </div>

                    <label className="checkbox-row">
                        <input
                            type="checkbox"
                            checked={textOnly}
                            onChange={(e) => setTextOnly(e.target.checked)}
                        />
                        Allow text-only matching when coordinates are missing
                    </label>
                </>
            ) : null}

            {step === 4 ? (
                <>
                    <div className="form-group">
                        <label>Summary</label>
                        <ul className="text-xs text-muted" style={{ paddingLeft: 16, margin: 0 }}>
                            <li>Layer A: {layerA?.name || '—'} ({layerA?.featureCount ?? 0} features)</li>
                            <li>Layer B: {layerB?.name || '—'} ({layerB?.featureCount ?? 0} features)</li>
                            <li>Strictness: {strictnessOptions.find((opt) => opt.value === strictness)?.label || strictness}</li>
                            <li>
                                Tolerance: {tolerancePresets.find((opt) => opt.value === tolerancePreset)?.label
                                    || `${customToleranceFeet} ft`}
                            </li>
                            <li>Name matching: {layerANameField && layerBNameField ? 'enabled' : 'spatial only'}</li>
                        </ul>
                    </div>

                    {validationWarnings.length ? (
                        <ul className="text-xs text-muted" style={{ paddingLeft: 16, marginTop: 0 }}>
                            {validationWarnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                            ))}
                        </ul>
                    ) : null}

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
                                            <tr key={`preview-${idx}`}>
                                                {preview.columns.map((col) => (
                                                    <td key={`${idx}-${col}`} style={{ fontSize: 11, padding: 4 }}>
                                                        {formatValue(row[col])}
                                                    </td>
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
