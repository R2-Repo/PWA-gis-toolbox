import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';

const WIZARD_STEPS = [
    'Boundary',
    'Source layers',
    'Callout fields',
    'Numbering & legend',
    'Placement',
    'Preview'
];

function BoundaryModeOption({ option, selected, onSelect }) {
    return (
        <label
            style={{
                display: 'block',
                padding: '10px 12px',
                marginBottom: 8,
                border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                background: selected ? 'var(--bg-surface)' : 'transparent'
            }}
        >
            <input
                type="radio"
                name="boundary-mode"
                checked={selected}
                onChange={() => onSelect(option.value)}
                style={{ marginRight: 8 }}
            />
            <span style={{ fontWeight: 600 }}>{option.label}</span>
            {option.tip ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginLeft: 22 }}>
                    {option.tip}
                </div>
            ) : null}
        </label>
    );
}

function LayerCheckbox({ layer, checked, onToggle }) {
    return (
        <label
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                cursor: 'pointer'
            }}
        >
            <input type="checkbox" checked={checked} onChange={() => onToggle(layer.id)} />
            <span>{layer.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                ({layer.featureCount ?? 0} features)
            </span>
        </label>
    );
}

function FieldCheckbox({ field, label, checked, labelValue, onToggle, onLabelChange }) {
    return (
        <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(field)} />
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{field}</span>
            </label>
            {checked ? (
                <input
                    type="text"
                    value={labelValue}
                    onChange={(e) => onLabelChange(field, e.target.value)}
                    placeholder="Field label (optional)"
                    style={{ marginLeft: 24, marginTop: 4, width: 'calc(100% - 24px)' }}
                />
            ) : null}
        </div>
    );
}

export function CalloutBuilderDialog({
    layers = [],
    polygonLayers = [],
    boundaryModeOptions = [],
    numberingModeOptions = [],
    legendModeOptions = [],
    defaultBoundaryMode = 'whole-layer',
    onCancel,
    onLayerFocus,
    onSubscribeSelection,
    onPreview,
    onCreateOutput
}) {
    const [step, setStep] = useState(1);
    const [boundaryMode, setBoundaryMode] = useState(defaultBoundaryMode);
    const [sheetLayerId, setSheetLayerId] = useState('');
    const [sheetIdField, setSheetIdField] = useState('sheet_id');
    const [sheetNameField, setSheetNameField] = useState('sheet_name');
    const [sequenceField, setSequenceField] = useState('sequence');
    const [boundaryLayerId, setBoundaryLayerId] = useState('');
    const [boundarySelectionCount, setBoundarySelectionCount] = useState(0);
    const [selectedSourceLayerIds, setSelectedSourceLayerIds] = useState([]);
    const [layerFieldConfig, setLayerFieldConfig] = useState({});
    const [numberingMode, setNumberingMode] = useState('per-boundary');
    const [startNumber, setStartNumber] = useState(1);
    const [legendMode, setLegendMode] = useState('field-value');
    const [includeSourceLayer, setIncludeSourceLayer] = useState(false);
    const [includeSourceField, setIncludeSourceField] = useState(false);
    const [stackMultiple, setStackMultiple] = useState(true);
    const [leaderLines, setLeaderLines] = useState(true);
    const [bubbleSpacing, setBubbleSpacing] = useState(20);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const sheetLayer = useMemo(
        () => polygonLayers.find((layer) => layer.id === sheetLayerId) || null,
        [polygonLayers, sheetLayerId]
    );

    const boundaryLayer = useMemo(
        () => polygonLayers.find((layer) => layer.id === boundaryLayerId) || null,
        [polygonLayers, boundaryLayerId]
    );

    const selectedSourceLayers = useMemo(
        () => layers.filter((layer) => selectedSourceLayerIds.includes(layer.id)),
        [layers, selectedSourceLayerIds]
    );

    const sheetFieldOptions = useMemo(
        () => sheetLayer?.fields || [],
        [sheetLayer]
    );

    const buildConfig = useCallback(() => ({
        boundary: {
            mode: boundaryMode,
            sheetLayerId,
            sheetIdField,
            sheetNameField,
            sequenceField,
            boundaryLayerId
        },
        sourceLayerIds: selectedSourceLayerIds,
        layerFieldConfig,
        numbering: {
            mode: numberingMode,
            startNumber: Number(startNumber) || 1,
            increment: 1
        },
        legend: {
            mode: legendMode,
            includeSourceLayer,
            includeSourceField,
            template: '{value}'
        },
        placement: {
            mode: 'near-feature',
            stackMultipleFromSameFeature: stackMultiple,
            bubbleSpacing: Number(bubbleSpacing) || 20,
            leaderLines
        }
    }), [
        boundaryMode,
        sheetLayerId,
        sheetIdField,
        sheetNameField,
        sequenceField,
        boundaryLayerId,
        selectedSourceLayerIds,
        layerFieldConfig,
        numberingMode,
        startNumber,
        legendMode,
        includeSourceLayer,
        includeSourceField,
        stackMultiple,
        bubbleSpacing,
        leaderLines
    ]);

    const hasCalloutFields = useMemo(() => (
        selectedSourceLayerIds.some((layerId) => {
            const config = layerFieldConfig[layerId];
            return (config?.fields || []).length > 0;
        })
    ), [selectedSourceLayerIds, layerFieldConfig]);

    const canAdvanceStep1 = useMemo(() => {
        if (boundaryMode === 'sheet-layer') {
            return Boolean(sheetLayerId && sheetIdField);
        }
        if (boundaryMode === 'selected-polygon') {
            return Boolean(boundaryLayerId && boundarySelectionCount > 0);
        }
        return true;
    }, [boundaryMode, sheetLayerId, sheetIdField, boundaryLayerId, boundarySelectionCount]);

    const canAdvanceStep2 = selectedSourceLayerIds.length > 0;
    const canAdvanceStep3 = hasCalloutFields;
    const canPreview = canAdvanceStep1 && canAdvanceStep2 && canAdvanceStep3;

    useEffect(() => {
        if (boundaryMode === 'whole-layer') {
            setNumberingMode('global');
        } else {
            setNumberingMode('per-boundary');
        }
    }, [boundaryMode]);

    useEffect(() => {
        if (!boundaryLayerId || !onSubscribeSelection) {
            setBoundarySelectionCount(0);
            return undefined;
        }
        return onSubscribeSelection(boundaryLayerId, setBoundarySelectionCount);
    }, [boundaryLayerId, onSubscribeSelection]);

    useEffect(() => {
        if (selectedSourceLayerIds[0]) onLayerFocus?.(selectedSourceLayerIds[0]);
    }, [selectedSourceLayerIds, onLayerFocus]);

    const toggleSourceLayer = (layerId) => {
        setSelectedSourceLayerIds((current) => {
            const next = current.includes(layerId)
                ? current.filter((id) => id !== layerId)
                : [...current, layerId];
            return next;
        });
        setPreview(null);
        setError('');
    };

    const toggleField = (layerId, field) => {
        setLayerFieldConfig((current) => {
            const existing = current[layerId] || { fields: [], labels: {} };
            const fields = existing.fields.includes(field)
                ? existing.fields.filter((entry) => entry !== field)
                : [...existing.fields, field];
            const labels = { ...existing.labels };
            if (!labels[field]) labels[field] = field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            return { ...current, [layerId]: { fields, labels } };
        });
        setPreview(null);
    };

    const updateFieldLabel = (layerId, field, label) => {
        setLayerFieldConfig((current) => {
            const existing = current[layerId] || { fields: [], labels: {} };
            return {
                ...current,
                [layerId]: {
                    ...existing,
                    labels: { ...existing.labels, [field]: label }
                }
            };
        });
    };

    const runPreview = async () => {
        setError('');
        setMessage('');
        setPreviewing(true);
        try {
            const result = await onPreview?.(buildConfig());
            setPreview(result || null);
            setMessage('Preview generated.');
        } catch (err) {
            setError(err?.message || 'Preview failed.');
            setPreview(null);
        } finally {
            setPreviewing(false);
        }
    };

    const createOutput = async () => {
        setError('');
        setCreating(true);
        try {
            let currentPreview = preview;
            if (!currentPreview) {
                currentPreview = await onPreview?.(buildConfig());
                setPreview(currentPreview || null);
            }
            const result = await onCreateOutput?.(buildConfig(), currentPreview);
            setMessage(result?.message || 'Output layers created.');
        } catch (err) {
            setError(err?.message || 'Failed to create output layers.');
        } finally {
            setCreating(false);
        }
    };

    const goNext = async () => {
        if (step === 5 && canPreview) {
            await runPreview();
        }
        setStep((current) => Math.min(current + 1, WIZARD_STEPS.length));
    };

    const goBack = () => setStep((current) => Math.max(current - 1, 1));

    const footer = (
        <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <button className="btn btn-secondary cancel-btn" onClick={() => onCancel?.()}>
                Cancel
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
                {step > 1 ? (
                    <button className="btn btn-secondary" onClick={goBack}>
                        Back
                    </button>
                ) : null}
                {step < WIZARD_STEPS.length ? (
                    <button
                        className="btn btn-primary"
                        onClick={goNext}
                        disabled={
                            (step === 1 && !canAdvanceStep1)
                            || (step === 2 && !canAdvanceStep2)
                            || (step === 3 && !canAdvanceStep3)
                            || (step === 5 && previewing)
                        }
                    >
                        {step === 5 ? (previewing ? 'Generating...' : 'Next: Preview') : 'Next'}
                    </button>
                ) : (
                    <>
                        <button
                            className="btn btn-secondary"
                            onClick={runPreview}
                            disabled={previewing || !canPreview}
                        >
                            {previewing ? 'Regenerating...' : 'Regenerate'}
                        </button>
                        <button
                            className="btn btn-primary apply-btn"
                            onClick={createOutput}
                            disabled={creating || !canPreview}
                        >
                            {creating ? 'Creating...' : 'Create output layers'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <WidgetPanelShell title="Callout Builder" footer={footer} onCancel={onCancel}>
            <WidgetStepWizard steps={WIZARD_STEPS} currentStep={step} />

            {error ? <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div> : null}
            {message ? <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>{message}</div> : null}

            {step === 1 ? (
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                        Choose how callouts should be grouped or limited.
                    </p>
                    {boundaryModeOptions.map((option) => (
                        <BoundaryModeOption
                            key={option.value}
                            option={option}
                            selected={boundaryMode === option.value}
                            onSelect={setBoundaryMode}
                        />
                    ))}

                    {boundaryMode === 'sheet-layer' ? (
                        <div style={{ marginTop: 12 }}>
                            <LayerSelect
                                label="Sheet boundary layer"
                                value={sheetLayerId}
                                onChange={setSheetLayerId}
                                layers={polygonLayers}
                                placeholder="- select sheet layer -"
                            />
                            <div className="form-group">
                                <label>Sheet ID field</label>
                                <select value={sheetIdField} onChange={(e) => setSheetIdField(e.target.value)}>
                                    <option value="">- select field -</option>
                                    {sheetFieldOptions.map((field) => (
                                        <option key={field} value={field}>{field}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Sheet name field</label>
                                <select value={sheetNameField} onChange={(e) => setSheetNameField(e.target.value)}>
                                    <option value="">- optional -</option>
                                    {sheetFieldOptions.map((field) => (
                                        <option key={field} value={field}>{field}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Sequence field (optional)</label>
                                <select value={sequenceField} onChange={(e) => setSequenceField(e.target.value)}>
                                    <option value="">- optional -</option>
                                    {sheetFieldOptions.map((field) => (
                                        <option key={field} value={field}>{field}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ) : null}

                    {boundaryMode === 'selected-polygon' ? (
                        <div style={{ marginTop: 12 }}>
                            <LayerSelect
                                label="Boundary polygon layer"
                                value={boundaryLayerId}
                                onChange={(layerId) => {
                                    setBoundaryLayerId(layerId);
                                    onLayerFocus?.(layerId);
                                }}
                                layers={polygonLayers}
                                placeholder="- select polygon layer -"
                            />
                            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                Select one polygon feature on the map ({boundarySelectionCount} selected).
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {step === 2 ? (
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                        Select one or more layers containing features to call out.
                    </p>
                    {layers.map((layer) => (
                        <LayerCheckbox
                            key={layer.id}
                            layer={layer}
                            checked={selectedSourceLayerIds.includes(layer.id)}
                            onToggle={toggleSourceLayer}
                        />
                    ))}
                </div>
            ) : null}

            {step === 3 ? (
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                        Each non-empty selected field will become its own numbered callout.
                    </p>
                    {selectedSourceLayers.map((layer) => (
                        <div key={layer.id} style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>{layer.name}</div>
                            {(layer.fields || []).map((field) => {
                                const config = layerFieldConfig[layer.id] || { fields: [], labels: {} };
                                return (
                                    <FieldCheckbox
                                        key={field}
                                        field={field}
                                        checked={config.fields.includes(field)}
                                        labelValue={config.labels[field] || ''}
                                        onToggle={(fieldName) => toggleField(layer.id, fieldName)}
                                        onLabelChange={(fieldName, label) => updateFieldLabel(layer.id, fieldName, label)}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            ) : null}

            {step === 4 ? (
                <div>
                    <div className="form-group">
                        <label>Numbering mode</label>
                        <select value={numberingMode} onChange={(e) => setNumberingMode(e.target.value)}>
                            {numberingModeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Start number</label>
                        <input
                            type="number"
                            min="1"
                            value={startNumber}
                            onChange={(e) => setStartNumber(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label>Legend text mode</label>
                        <select value={legendMode} onChange={(e) => setLegendMode(e.target.value)}>
                            {legendModeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <input
                            type="checkbox"
                            checked={includeSourceLayer}
                            onChange={(e) => setIncludeSourceLayer(e.target.checked)}
                        />
                        Include source layer name in legend
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={includeSourceField}
                            onChange={(e) => setIncludeSourceField(e.target.checked)}
                        />
                        Include field label in legend (field-value mode)
                    </label>
                </div>
            ) : null}

            {step === 5 ? (
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                        Initial bubble placement is a first draft — you can move callouts after creating output layers.
                    </p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <input
                            type="checkbox"
                            checked={stackMultiple}
                            onChange={(e) => setStackMultiple(e.target.checked)}
                        />
                        Stack multiple callouts from the same feature
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <input
                            type="checkbox"
                            checked={leaderLines}
                            onChange={(e) => setLeaderLines(e.target.checked)}
                        />
                        Create leader lines
                    </label>
                    <div className="form-group">
                        <label>Bubble spacing (meters)</label>
                        <input
                            type="number"
                            min="5"
                            value={bubbleSpacing}
                            onChange={(e) => setBubbleSpacing(e.target.value)}
                        />
                    </div>
                </div>
            ) : null}

            {step === 6 && preview ? (
                <div>
                    <div style={{ fontSize: 13, marginBottom: 12 }}>
                        <div><strong>Boundaries:</strong> {preview.summary?.boundaryCount ?? 0}</div>
                        <div><strong>Source layers:</strong> {preview.summary?.sourceLayerCount ?? 0}</div>
                        <div><strong>Features scanned:</strong> {preview.summary?.sourceFeaturesScanned ?? 0}</div>
                        <div><strong>Callouts created:</strong> {preview.summary?.calloutCount ?? 0}</div>
                    </div>

                    {preview.summary?.perBoundaryCounts?.length ? (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Per-boundary counts</div>
                            {preview.summary.perBoundaryCounts.map((entry) => (
                                <div key={entry.boundaryId} style={{ fontSize: 12 }}>
                                    {entry.boundaryName}: {entry.calloutCount}
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {preview.warnings?.length ? (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Warnings</div>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>
                                {preview.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {step === 6 && !preview && !previewing ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Click Regenerate to build a preview.
                </p>
            ) : null}
        </WidgetPanelShell>
    );
}
