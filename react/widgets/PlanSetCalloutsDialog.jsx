import { useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';

export function PlanSetCalloutsDialog({
    steps = [],
    ruleOperators = [],
    designLayers = [],
    sheetLayers = [],
    stationingLayers = [],
    hasLinkedSheetWidget = false,
    initialSession,
    onCancel,
    onCreateProject,
    onLoadProfile,
    onAddDefinition,
    onUpdateDefinition,
    onRemoveDefinition,
    onAddRule,
    onUpdateRule,
    onRemoveRule,
    onSelectDesignLayers,
    onRunAssignment,
    onLinkSheetSetFromWidget,
    onLinkSheetSetFromLayers,
    onRunSheetPlacement,
    onGetLegend,
    onGetSheetPlacements,
    onValidate,
    onExportPackage,
    onAddResultLayers,
    onSaveSession
}) {
    const [step, setStep] = useState(1);
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [projectNumber, setProjectNumber] = useState(initialSession?.project?.projectNumber || '');
    const [selectedLayerIds, setSelectedLayerIds] = useState(initialSession?.callouts?.designLayerIds || []);
    const [newCalloutCode, setNewCalloutCode] = useState('');
    const [newCalloutDescription, setNewCalloutDescription] = useState('');
    const [newCalloutShape, setNewCalloutShape] = useState('triangle');
    const [newRuleCalloutId, setNewRuleCalloutId] = useState('');
    const [newRuleField, setNewRuleField] = useState('strand_count');
    const [newRuleOperator, setNewRuleOperator] = useState('equals');
    const [newRuleValue, setNewRuleValue] = useState('');
    const [selectedSheetLayerIds, setSelectedSheetLayerIds] = useState(initialSession?.callouts?.sheetLayerIds || []);
    const [routeLayerId, setRouteLayerId] = useState(initialSession?.project?.stationingRouteLayerId || '');
    const [legend, setLegend] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [validation, setValidation] = useState(null);

    const definitions = session?.callouts?.definitions || [];
    const rules = session?.callouts?.rules || [];
    const assignments = session?.callouts?.assignments || [];
    const linkedSheets = session?.callouts?.sheets || [];
    const sheetPlacements = session?.callouts?.sheetPlacements || [];
    const featureCount = session?.designFeatures?.length || 0;

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
                Create a callout profile project for plan set annotation and legend generation.
            </p>
        </>
    );

    const renderProfileStep = () => (
        <>
            <div className="gis-widget__btn-row" style={{ marginBottom: 12 }}>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => run(() => onLoadProfile?.(), 'Standard fiber callout profile loaded.')}
                >
                    Load standard profile
                </button>
            </div>
            <div className="form-group">
                <label>Callout definitions ({definitions.length})</label>
                <div className="text-xs" style={{ maxHeight: 180, overflow: 'auto' }}>
                    {definitions.map((entry) => (
                        <div key={entry.calloutId} style={{ marginBottom: 6 }}>
                            <strong>{entry.code}</strong> — {entry.shortDescription}
                            <span style={{ color: 'var(--text-muted)' }}> ({entry.shape})</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="form-group">
                <label>Add custom callout</label>
                <div className="gis-widget__row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input placeholder="Code" value={newCalloutCode} onChange={(e) => setNewCalloutCode(e.target.value)} style={{ width: 60 }} />
                    <select value={newCalloutShape} onChange={(e) => setNewCalloutShape(e.target.value)}>
                        <option value="triangle">Triangle</option>
                        <option value="square">Square</option>
                        <option value="octagon">Octagon</option>
                        <option value="circle">Circle</option>
                    </select>
                    <input placeholder="Description" value={newCalloutDescription} onChange={(e) => setNewCalloutDescription(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !newCalloutCode.trim()}
                        onClick={() => run(async () => {
                            const next = await onAddDefinition?.({
                                code: newCalloutCode.trim(),
                                shape: newCalloutShape,
                                shortDescription: newCalloutDescription.trim() || `Callout ${newCalloutCode.trim()}`,
                                symbolKey: `callout-${newCalloutShape}`
                            });
                            setNewCalloutCode('');
                            setNewCalloutDescription('');
                            return next;
                        }, 'Callout added.')}
                    >
                        Add
                    </button>
                </div>
            </div>
        </>
    );

    const renderRulesStep = () => (
        <>
            <div className="form-group">
                <label>Assignment rules ({rules.length})</label>
                <div className="text-xs" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {rules.map((rule) => {
                        const callout = definitions.find((entry) => entry.calloutId === rule.calloutId);
                        const condition = rule.conditions?.[0];
                        return (
                            <div key={rule.ruleId} style={{ marginBottom: 6 }}>
                                <strong>{callout?.code || '?'}</strong>: {condition?.field} {condition?.operator} {condition?.value || ''}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="form-group">
                <label>Add rule</label>
                <div className="gis-widget__row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <select value={newRuleCalloutId} onChange={(e) => setNewRuleCalloutId(e.target.value)}>
                        <option value="">— callout —</option>
                        {definitions.map((entry) => (
                            <option key={entry.calloutId} value={entry.calloutId}>{entry.code} — {entry.shortDescription}</option>
                        ))}
                    </select>
                    <input placeholder="Field" value={newRuleField} onChange={(e) => setNewRuleField(e.target.value)} style={{ width: 110 }} />
                    <select value={newRuleOperator} onChange={(e) => setNewRuleOperator(e.target.value)}>
                        {ruleOperators.map((entry) => (
                            <option key={entry.value} value={entry.value}>{entry.label}</option>
                        ))}
                    </select>
                    <input placeholder="Value" value={newRuleValue} onChange={(e) => setNewRuleValue(e.target.value)} style={{ width: 80 }} />
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !newRuleCalloutId}
                        onClick={() => run(async () => onAddRule?.({
                            calloutId: newRuleCalloutId,
                            conditions: [{ field: newRuleField, operator: newRuleOperator, value: newRuleValue }]
                        }), 'Rule added.')}
                    >
                        Add rule
                    </button>
                </div>
            </div>
        </>
    );

    const renderDesignLayersStep = () => (
        <>
            <div className="form-group">
                <label>Design layers</label>
                <div className="text-xs" style={{ maxHeight: 200, overflow: 'auto' }}>
                    {designLayers.map((layer) => (
                        <label key={layer.id} style={{ display: 'block', marginBottom: 6 }}>
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
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !selectedLayerIds.length}
                onClick={() => run(() => onSelectDesignLayers?.(selectedLayerIds), `Loaded features from ${selectedLayerIds.length} layer(s).`)}
            >
                Load features
            </button>
            {featureCount > 0 ? (
                <p className="text-xs" style={{ marginTop: 8 }}>{featureCount} design features loaded.</p>
            ) : null}
        </>
    );

    const renderAssignStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Run rule-based assignment to match callouts to design features.
            </p>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !featureCount || !rules.length}
                onClick={() => run(() => onRunAssignment?.(), `Assigned callouts to ${assignments.length} feature(s).`)}
            >
                Run assignment
            </button>
            {assignments.length > 0 ? (
                <div className="text-xs" style={{ marginTop: 12, maxHeight: 180, overflow: 'auto' }}>
                    {assignments.slice(0, 20).map((entry) => (
                        <div key={entry.assignmentId}>
                            {entry.featureId}: {(entry.callouts || []).map((c) => c.code).join(', ')}
                        </div>
                    ))}
                    {assignments.length > 20 ? <div>…and {assignments.length - 20} more</div> : null}
                </div>
            ) : null}
        </>
    );

    const toggleSheetLayer = (layerId) => {
        setSelectedSheetLayerIds((current) =>
            current.includes(layerId)
                ? current.filter((id) => id !== layerId)
                : [...current, layerId]
        );
    };

    const renderSheetsStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
                Link sheet frames from Sheet Cutting or map layers, then place callouts per sheet.
            </p>
            {hasLinkedSheetWidget ? (
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => run(() => onLinkSheetSetFromWidget?.(), `Linked ${linkedSheets.length || ''} sheet(s) from Sheet Cutting.`)}
                >
                    Use Sheet Cutting session
                </button>
            ) : null}
            <div className="form-group" style={{ marginTop: 12 }}>
                <label>Sheet frame layers</label>
                <div className="text-xs" style={{ maxHeight: 120, overflow: 'auto' }}>
                    {sheetLayers.length ? sheetLayers.map((layer) => (
                        <label key={layer.id} style={{ display: 'block', marginBottom: 4 }}>
                            <input
                                type="checkbox"
                                checked={selectedSheetLayerIds.includes(layer.id)}
                                onChange={() => toggleSheetLayer(layer.id)}
                            />
                            {' '}{layer.name} ({layer.featureCount})
                        </label>
                    )) : <div>No sheet frame layers found. Generate sheets in Sheet Cutting first.</div>}
                </div>
            </div>
            <LayerSelect
                label="Route centerline"
                layers={stationingLayers}
                value={routeLayerId}
                onChange={setRouteLayerId}
                emptyLabel="No stationing centerline layers found"
            />
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                disabled={busy || (!selectedSheetLayerIds.length && !hasLinkedSheetWidget)}
                onClick={() => run(
                    () => onLinkSheetSetFromLayers?.(selectedSheetLayerIds, routeLayerId),
                    'Sheet set linked.'
                )}
            >
                Link sheet layers
            </button>
            {linkedSheets.length > 0 ? (
                <p className="text-xs" style={{ marginTop: 8 }}>{linkedSheets.length} detail sheet(s) linked.</p>
            ) : null}
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                disabled={busy || !linkedSheets.length || !assignments.length}
                onClick={() => run(() => onRunSheetPlacement?.(), `Placed callouts on ${sheetPlacements.length || linkedSheets.length} sheet(s).`)}
            >
                Run sheet-aware placement
            </button>
            {sheetPlacements.length > 0 ? (
                <div className="text-xs" style={{ marginTop: 12, maxHeight: 160, overflow: 'auto' }}>
                    {sheetPlacements.map((sheet) => (
                        <div key={sheet.sheetId}>
                            Sheet {sheet.sheetNumber}: {sheet.placements?.length || 0} callout(s), {sheet.calloutTable?.length || 0} unique code(s)
                        </div>
                    ))}
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
                    const items = onGetLegend?.() || [];
                    setLegend(items);
                    return session;
                }, 'Validation complete.')}
            >
                Run readiness check
            </button>
            {validation ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    {validation.warnings?.length ? (
                        <div>
                            <strong>Warnings</strong>
                            <ul>{validation.warnings.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                        </div>
                    ) : <div>No warnings.</div>}
                </div>
            ) : null}
            {legend.length > 0 ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    <strong>Legend preview ({legend.length})</strong>
                    {legend.slice(0, 10).map((entry) => (
                        <div key={entry.calloutId}>{entry.code} — {entry.shortDescription}</div>
                    ))}
                </div>
            ) : null}
            {sheetPlacements.length > 0 ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    <strong>Per-sheet summary</strong>
                    {(onGetSheetPlacements?.() || sheetPlacements).slice(0, 8).map((sheet) => (
                        <div key={sheet.sheetId}>Sheet {sheet.sheetNumber}: {(sheet.calloutTable || []).map((c) => c.code).join(', ')}</div>
                    ))}
                </div>
            ) : null}
        </>
    );

    const renderExportStep = () => (
        <>
            <div className="gis-widget__btn-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onExportPackage?.()}>
                    Download export package
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAddResultLayers?.()}>
                    Add callout layers to map
                </button>
                <button type="button" className="gis-widget__link-btn" disabled={busy} onClick={() => onSaveSession?.()}>
                    Save session JSON
                </button>
            </div>
        </>
    );

    const stepContent = [
        renderProjectStep,
        renderProfileStep,
        renderRulesStep,
        renderDesignLayersStep,
        renderAssignStep,
        renderSheetsStep,
        renderReviewStep,
        renderExportStep
    ][step - 1]();

    const canGoNext = !busy && (
        step === 1 ? projectName.trim() :
        step === 2 ? definitions.length > 0 :
        step === 3 ? rules.length > 0 :
        step === 4 ? featureCount > 0 :
        step === 5 ? assignments.length > 0 :
        step === 6 ? linkedSheets.length > 0 && sheetPlacements.length > 0 :
        true
    );

    const handleNext = async () => {
        if (step === 1) {
            await run(() => onCreateProject?.({ projectName, projectNumber }), 'Project created.');
        } else if (step === 2 && !definitions.length) {
            await run(() => onLoadProfile?.(), 'Standard profile loaded.');
        } else if (step === 4 && selectedLayerIds.length && !featureCount) {
            await run(() => onSelectDesignLayers?.(selectedLayerIds), 'Features loaded.');
        } else if (step === 5 && !assignments.length) {
            await run(() => onRunAssignment?.(), 'Assignment complete.');
        } else if (step === 6) {
            if (!linkedSheets.length && hasLinkedSheetWidget) {
                await run(() => onLinkSheetSetFromWidget?.());
            } else if (!linkedSheets.length && selectedSheetLayerIds.length) {
                await run(() => onLinkSheetSetFromLayers?.(selectedSheetLayerIds, routeLayerId));
            }
            if (!sheetPlacements.length) {
                await run(() => onRunSheetPlacement?.(), 'Sheet placement complete.');
            }
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
