import { useCallback, useEffect, useMemo, useState } from 'react';
import { RunPreviewFooter } from './shared/RunPreviewFooter.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { DEFAULT_RESULT_BEHAVIOR, QUERY_OPERATORS, ZOOM_MODES } from '../../js/widgets/query/engine.js';

function emptyCondition(fields = []) {
    return { field: fields[0] || '', operator: 'contains', value: '' };
}

function ResultOptions({ behavior, onChange, zoomMode, onZoomModeChange, disabled = false }) {
    const setBehavior = (key, checked) => {
        onChange?.({ ...behavior, [key]: checked });
    };

    return (
        <>
            <div className="form-group">
                <label>Result options</label>
                <label className="toggle mb-4">
                    <input
                        type="checkbox"
                        checked={!!behavior.highlightResults}
                        disabled={disabled}
                        onChange={(e) => setBehavior('highlightResults', e.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span>Highlight results on map</span>
                </label>
                <label className="toggle mb-4">
                    <input
                        type="checkbox"
                        checked={!!behavior.zoomToResults}
                        disabled={disabled}
                        onChange={(e) => setBehavior('zoomToResults', e.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span>Zoom to results</span>
                </label>
                <label className="toggle mb-4">
                    <input
                        type="checkbox"
                        checked={!!behavior.selectResults}
                        disabled={disabled}
                        onChange={(e) => setBehavior('selectResults', e.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span>Select results</span>
                </label>
                <label className="toggle mb-4">
                    <input
                        type="checkbox"
                        checked={!!behavior.flashResults}
                        disabled={disabled}
                        onChange={(e) => setBehavior('flashResults', e.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span>Flash results to draw attention</span>
                </label>
                <label className="toggle mb-4">
                    <input
                        type="checkbox"
                        checked={!!behavior.createResultLayer}
                        disabled={disabled}
                        onChange={(e) => setBehavior('createResultLayer', e.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span>Create new layer from results</span>
                </label>
                <label className="toggle mb-4" title="Coming in a future update">
                    <input
                        type="checkbox"
                        checked={!!behavior.applyAsFilter}
                        disabled
                        readOnly
                    />
                    <span className="toggle-track" />
                    <span>Apply results as filter</span>
                    <span className="text-xs text-muted" style={{ marginLeft: 8 }}>(coming soon)</span>
                </label>
            </div>
            <div className="form-group">
                <label>Zoom behavior</label>
                <select
                    value={zoomMode}
                    disabled={disabled || !behavior.zoomToResults}
                    onChange={(e) => onZoomModeChange?.(e.target.value)}
                >
                    {ZOOM_MODES.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                </select>
            </div>
        </>
    );
}

export function QueryDialog({
    layers = [],
    operators = QUERY_OPERATORS,
    initialState = null,
    onCancel,
    onRun,
    onClearResults,
    onSelectResults,
    onCreateResultLayer,
    onReapplyEffects,
    onStateChange
}) {
    const [layerId, setLayerId] = useState(initialState?.selectedLayerIds?.[0] || '');
    const [conditions, setConditions] = useState(() => {
        if (initialState?.conditions?.length) {
            return initialState.conditions.map((entry) => ({ ...entry }));
        }
        return [emptyCondition()];
    });
    const [logic, setLogic] = useState(initialState?.logic || 'AND');
    const [resultBehavior, setResultBehavior] = useState(() => ({
        ...DEFAULT_RESULT_BEHAVIOR,
        ...(initialState?.resultBehavior || {})
    }));
    const [zoomMode, setZoomMode] = useState(initialState?.zoomMode || 'all');
    const [running, setRunning] = useState(false);
    const [reapplying, setReapplying] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(() => {
        if (initialState?.lastMatchingIndices?.length) {
            return {
                matchingIndices: [...initialState.lastMatchingIndices],
                total: initialState.lastTotal ?? initialState.lastMatchingIndices.length,
                layerId: initialState.selectedLayerIds?.[0] || '',
                layerName: layers.find((l) => l.id === initialState.selectedLayerIds?.[0])?.name || '',
                message: `Matching features found: ${initialState.lastMatchingIndices.length}`,
                lastResultLayerId: initialState.lastResultLayerId || null
            };
        }
        return null;
    });

    const selectedLayer = useMemo(
        () => layers.find((layer) => layer.id === layerId) || null,
        [layers, layerId]
    );
    const fields = selectedLayer?.fields || [];

    const emitState = useCallback(() => {
        onStateChange?.({
            selectedLayerIds: layerId ? [layerId] : [],
            queryMode: 'attribute',
            conditions,
            logic,
            resultBehavior,
            zoomMode,
            lastResultLayerId: result?.lastResultLayerId ?? null,
            lastMatchingIndices: result?.matchingIndices ?? [],
            lastTotal: result?.total ?? null
        });
    }, [layerId, conditions, logic, resultBehavior, zoomMode, result, onStateChange]);

    useEffect(() => {
        emitState();
    }, [emitState]);

    const updateCondition = (index, patch) => {
        setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
        setResult(null);
    };

    const addCondition = () => {
        setConditions((current) => [...current, emptyCondition(fields)]);
        setResult(null);
    };

    const removeCondition = (index) => {
        setConditions((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
        setResult(null);
    };

    const handleLayerChange = (nextLayerId) => {
        setLayerId(nextLayerId);
        const nextLayer = layers.find((layer) => layer.id === nextLayerId);
        const nextFields = nextLayer?.fields || [];
        setConditions([emptyCondition(nextFields)]);
        setResult(null);
        setError('');
    };

    const canRun = Boolean(layerId) && conditions.every((rule) => rule.field && rule.operator);

    const runQuery = async () => {
        setError('');
        setRunning(true);
        try {
            const output = await onRun?.({
                layerId,
                conditions,
                logic,
                resultBehavior,
                zoomMode
            });
            setResult(output || null);
        } catch (err) {
            setError(err?.message || 'Query failed.');
        } finally {
            setRunning(false);
        }
    };

    const applyToCurrentResults = async () => {
        if (!result?.matchingIndices?.length) return;
        setError('');
        setReapplying(true);
        try {
            const output = await onReapplyEffects?.({
                layerId: result.layerId || layerId,
                matchingIndices: result.matchingIndices,
                resultBehavior,
                zoomMode
            });
            if (output) {
                setResult((current) => ({ ...current, ...output }));
            }
        } catch (err) {
            setError(err?.message || 'Unable to update result behavior.');
        } finally {
            setReapplying(false);
        }
    };

    const clearResults = () => {
        onClearResults?.();
        setResult(null);
        setError('');
    };

    const resetQuery = () => {
        clearResults();
        setConditions([emptyCondition(fields)]);
        setLogic('AND');
    };

    if (result) {
        const matchCount = result.matchingIndices?.length ?? 0;
        const hasMatches = matchCount > 0;

        return (
            <WidgetPanelShell
                onCancel={onCancel}
                cancelLabel="Done"
                showRun={false}
                status={error || result.message || ''}
                statusTone={error ? 'danger' : 'muted'}
                footer={(
                    <RunPreviewFooter
                        onCancel={onCancel}
                        cancelLabel="Done"
                        showRun={false}
                        middleActions={(
                            <button type="button" className="btn btn-secondary" onClick={resetQuery}>
                                New query
                            </button>
                        )}
                    />
                )}
            >
                <div className="form-group">
                    <label>{hasMatches ? 'Matching features found' : 'Query results'}</label>
                    <div className="text-xs">
                        {hasMatches ? (
                            <>
                                <div><strong>{matchCount}</strong> of <strong>{result.total}</strong> features matched</div>
                                <div>Layer: {result.layerName || layerId}</div>
                            </>
                        ) : (
                            <div>No matching features found</div>
                        )}
                    </div>
                </div>

                <ResultOptions
                    behavior={resultBehavior}
                    onChange={setResultBehavior}
                    zoomMode={zoomMode}
                    onZoomModeChange={setZoomMode}
                />

                <div className="gis-widget__btn-row mt-8">
                    {hasMatches ? (
                        <>
                            <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                disabled={reapplying}
                                onClick={applyToCurrentResults}
                            >
                                {reapplying ? 'Applying…' : 'Apply to current results'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => onSelectResults?.({
                                    layerId: result.layerId || layerId,
                                    matchingIndices: result.matchingIndices
                                })}
                            >
                                Select results
                            </button>
                            <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={async () => {
                                    const id = await onCreateResultLayer?.({
                                        layerId: result.layerId || layerId,
                                        matchingIndices: result.matchingIndices
                                    });
                                    if (id) {
                                        setResult((current) => ({ ...current, lastResultLayerId: id }));
                                    }
                                }}
                            >
                                Create result layer
                            </button>
                        </>
                    ) : null}
                    <button type="button" className="btn btn-sm btn-secondary" onClick={clearResults}>
                        Clear results
                    </button>
                </div>
            </WidgetPanelShell>
        );
    }

    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={runQuery}
            runLabel="Run Query"
            running={running}
            disabled={!canRun}
            status={error}
            statusTone={error ? 'danger' : 'muted'}
        >
            <LayerSelect
                label="Layer to query"
                value={layerId}
                layers={layers}
                onChange={handleLayerChange}
            />

            <div className="form-group">
                <label>Query conditions</label>
                {conditions.map((rule, index) => (
                    <div key={index} className="flex gap-4 items-center mb-8">
                        <select
                            style={{ flex: 1 }}
                            value={rule.field || fields[0] || ''}
                            onChange={(e) => updateCondition(index, { field: e.target.value })}
                        >
                            {fields.length === 0 ? (
                                <option value="">No fields</option>
                            ) : fields.map((field) => (
                                <option key={field} value={field}>{field}</option>
                            ))}
                        </select>
                        <select
                            style={{ flex: 1 }}
                            value={rule.operator}
                            onChange={(e) => updateCondition(index, { operator: e.target.value })}
                        >
                            {operators.map((entry) => (
                                <option key={entry.value} value={entry.value}>{entry.label}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            placeholder="value"
                            style={{ flex: 1 }}
                            value={rule.value ?? ''}
                            disabled={rule.operator === 'is_null' || rule.operator === 'is_not_null'}
                            onChange={(e) => updateCondition(index, { value: e.target.value })}
                        />
                        <button type="button" className="btn-icon" onClick={() => removeCondition(index)}>✕</button>
                    </div>
                ))}
                <button type="button" className="btn btn-sm btn-secondary mt-4" onClick={addCondition}>
                    + Add condition
                </button>
            </div>

            <div className="form-group">
                <label>Match</label>
                <select value={logic} onChange={(e) => setLogic(e.target.value)}>
                    <option value="AND">All conditions (AND)</option>
                    <option value="OR">Any condition (OR)</option>
                </select>
            </div>

            <ResultOptions
                behavior={resultBehavior}
                onChange={setResultBehavior}
                zoomMode={zoomMode}
                onZoomModeChange={setZoomMode}
            />
        </WidgetPanelShell>
    );
}
