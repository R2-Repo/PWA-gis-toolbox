import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { RunPreviewFooter } from './shared/RunPreviewFooter.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';

const WORKFLOW_CALCULATOR = 'calculator';
const WORKFLOW_PLOT = 'plot_otdr';
const WORKFLOW_GET = 'get_otdr';

function formatNum(value, digits = 2) {
    if (value == null || !Number.isFinite(value)) return '-';
    if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
    return Number(value).toFixed(digits);
}

function UnitRow({ label, units }) {
    if (!units) return null;
    return (
        <div style={{ fontSize: 12, marginBottom: 4 }}>
            <strong>{label}:</strong>{' '}
            {formatNum(units.feet)} ft · {formatNum(units.meters)} m · {formatNum(units.miles, 4)} mi · {formatNum(units.kilometers, 4)} km
        </div>
    );
}

function WorkflowCard({ option, selected, onSelect }) {
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
                name="workflow"
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

function AdvancedSlackSettings({ settings, onChange }) {
    const fields = [
        { key: 'slackPerLocationFt', label: 'Slack per location (ft)' },
        { key: 'spacingFt', label: 'Spacing between slack locations (ft)' },
        { key: 'manualSlackLocations', label: 'Manual number of slack locations (optional)' },
        { key: 'fixedAddedSlackFt', label: 'Fixed added slack (ft)' },
        { key: 'launchCableFt', label: 'Launch cable length (ft)' },
        { key: 'receiveCableFt', label: 'Receive cable length (ft)' },
        { key: 'panelJumperFt', label: 'Panel jumper length (ft)' },
        { key: 'cabinetJumperFt', label: 'Cabinet jumper length (ft)' },
        { key: 'buildingPassThroughJumperFt', label: 'Building pass-through jumper length (ft)' }
    ];

    return (
        <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                Advanced slack settings
            </summary>
            <div style={{ marginTop: 10 }}>
                {fields.map(({ key, label }) => (
                    <div key={key} className="form-group">
                        <label>{label}</label>
                        <input
                            type="number"
                            min="0"
                            step="any"
                            value={settings[key] ?? ''}
                            onChange={(e) => onChange({ ...settings, [key]: e.target.value })}
                        />
                    </div>
                ))}
                <div className="form-group">
                    <label>Rounding preference</label>
                    <select
                        value={settings.rounding || 'none'}
                        onChange={(e) => onChange({ ...settings, rounding: e.target.value })}
                    >
                        <option value="none">None</option>
                        <option value="nearest_foot">Nearest foot</option>
                    </select>
                </div>
            </div>
        </details>
    );
}

export function FiberSlackOtdrHelperDialog({
    layers = [],
    unitOptions = [],
    workflowOptions = [],
    scenarioOptions = [],
    directionOptions = [],
    defaultSlackSettings = {},
    idealDataHelpText = '',
    onCancel,
    onLayerFocus,
    onSubscribeSelection,
    onRunCalculator,
    onRunPlotOnMap,
    onPickPointOnMap,
    onCreateResultLayer,
    onCancelMapInteraction
}) {
    const [step, setStep] = useState(1);
    const [workflow, setWorkflow] = useState('');
    const [layerId, setLayerId] = useState('');
    const [selectionCount, setSelectionCount] = useState(0);
    const [direction, setDirection] = useState('from_start');
    const [scenario, setScenario] = useState('custom');
    const [slackSettings, setSlackSettings] = useState({ ...defaultSlackSettings });
    const [inputDistance, setInputDistance] = useState('');
    const [inputUnit, setInputUnit] = useState('feet');
    const [calculatorInputType, setCalculatorInputType] = useState('map');
    const [showHelp, setShowHelp] = useState(false);
    const [running, setRunning] = useState(false);
    const [picking, setPicking] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [layerCreated, setLayerCreated] = useState(false);

    const isCalculator = workflow === WORKFLOW_CALCULATOR;
    const isPlot = workflow === WORKFLOW_PLOT;
    const isGet = workflow === WORKFLOW_GET;

    const wizardSteps = useMemo(() => {
        if (isCalculator) return ['Choose workflow', 'Slack settings', 'Enter distance'];
        return ['Choose workflow', 'Select route', 'Slack settings', 'Distance / map click'];
    }, [isCalculator]);

    const maxStep = wizardSteps.length;

    const selectedLayer = useMemo(
        () => layers.find((layer) => layer.id === layerId) || null,
        [layers, layerId]
    );

    useEffect(() => {
        if (!layerId || !onSubscribeSelection) {
            setSelectionCount(0);
            return undefined;
        }
        return onSubscribeSelection(layerId, setSelectionCount);
    }, [layerId, onSubscribeSelection]);

    useEffect(() => {
        if (layerId) onLayerFocus?.(layerId);
    }, [layerId, onLayerFocus]);

    useEffect(() => () => {
        onCancelMapInteraction?.();
    }, [onCancelMapInteraction]);

    const buildPayload = useCallback(() => ({
        workflow,
        layerId,
        direction,
        scenario,
        slackSettings,
        inputDistance: parseFloat(inputDistance),
        inputUnit,
        calculatorInputType
    }), [workflow, layerId, direction, scenario, slackSettings, inputDistance, inputUnit, calculatorInputType]);

    const canAdvanceStep1 = Boolean(workflow);

    const canAdvanceStep2 = isCalculator || (
        layerId && (selectionCount > 0 || (selectedLayer?.featureCount === 1))
    );

    const canAdvanceStep3 = true;

    const canRunStep = isCalculator
        ? Boolean(inputDistance && parseFloat(inputDistance) > 0)
        : isPlot
            ? Boolean(inputDistance && parseFloat(inputDistance) > 0)
            : isGet
                ? Boolean(result)
                : false;

    const goBack = () => {
        setError('');
        onCancelMapInteraction?.();
        setStep((s) => Math.max(1, s - 1));
    };

    const goNext = () => {
        setError('');
        if (step === 1 && !canAdvanceStep1) {
            setError('Choose a workflow to continue.');
            return;
        }
        if (step === 2 && !isCalculator && !canAdvanceStep2) {
            setError('Select a line layer and at least one line feature on the map.');
            return;
        }
        setStep((s) => Math.min(s + 1, maxStep));
    };

    const runCalculator = async () => {
        setRunning(true);
        setError('');
        try {
            const output = await onRunCalculator?.(buildPayload());
            if (!output?.ok) {
                setError((output?.errors || ['Calculation failed.']).join(' '));
                return;
            }
            setResult(output.result);
        } catch (err) {
            setError(err?.message || 'Calculation failed.');
        } finally {
            setRunning(false);
        }
    };

    const runPlot = async () => {
        setRunning(true);
        setError('');
        try {
            const output = await onRunPlotOnMap?.(buildPayload());
            if (!output?.ok) {
                setError((output?.errors || ['Plot failed.']).join(' '));
                return;
            }
            setResult(output.result);
        } catch (err) {
            setError(err?.message || 'Plot failed.');
        } finally {
            setRunning(false);
        }
    };

    const pickOnMap = async () => {
        setPicking(true);
        setError('');
        try {
            const output = await onPickPointOnMap?.(buildPayload());
            if (!output?.ok) {
                setError((output?.errors || ['Map pick failed.']).join(' '));
                return;
            }
            setResult(output.result);
        } catch (err) {
            setError(err?.message || 'Map pick failed.');
        } finally {
            setPicking(false);
        }
    };

    const handlePrimaryAction = async () => {
        if (step < maxStep) {
            goNext();
            return;
        }
        if (isCalculator) {
            await runCalculator();
            return;
        }
        if (isPlot) {
            await runPlot();
            return;
        }
        if (isGet && !result) {
            await pickOnMap();
        }
    };

    const resetAll = () => {
        setResult(null);
        setLayerCreated(false);
        setError('');
        setStep(1);
        setInputDistance('');
    };

    if (result) {
        return (
            <WidgetPanelShell
                footer={(
                    <RunPreviewFooter
                        onCancel={onCancel}
                        cancelLabel="Done"
                        showRun={false}
                        middleActions={(
                            <>
                                {!isCalculator && !layerCreated ? (
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={async () => {
                                            try {
                                                await onCreateResultLayer?.(result);
                                                setLayerCreated(true);
                                            } catch (err) {
                                                setError(err?.message || 'Could not create result layer.');
                                            }
                                        }}
                                    >
                                        Create result layer
                                    </button>
                                ) : null}
                                <button type="button" className="btn btn-secondary" onClick={resetAll}>
                                    New calculation
                                </button>
                            </>
                        )}
                    />
                )}
            >
                <div style={{ fontWeight: 600, marginBottom: 10 }}>Results</div>
                {error ? <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div> : null}
                {layerCreated ? (
                    <div style={{ fontSize: 12, color: 'var(--primary)', marginBottom: 8 }}>
                        Result layer added to the map.
                    </div>
                ) : null}
                {(result.warnings || []).map((w) => (
                    <div key={w} style={{ fontSize: 12, color: 'var(--warning, #b45309)', marginBottom: 6 }}>{w}</div>
                ))}

                <div style={{ fontSize: 12, marginBottom: 12 }}>
                    <div><strong>Workflow:</strong> {result.workflowLabel}</div>
                    {result.scenarioLabel ? <div><strong>Scenario:</strong> {result.scenarioLabel}</div> : null}
                    {result.directionLabel ? <div><strong>Direction:</strong> {result.directionLabel}</div> : null}
                    {result.sourceLayer ? <div><strong>Source layer:</strong> {result.sourceLayer}</div> : null}
                    {result.sourceFeatureIds?.length ? (
                        <div><strong>Source feature IDs:</strong> {result.sourceFeatureIds.join(', ')}</div>
                    ) : null}
                    {result.routeLengthFt != null ? (
                        <div><strong>Route length:</strong> {formatNum(result.routeLengthFt)} ft</div>
                    ) : null}
                </div>

                <UnitRow label="Input distance" units={result.units?.input} />
                <UnitRow label="Estimated slack" units={result.units?.estimatedSlack} />
                <UnitRow label="Map distance" units={result.units?.mapDistance} />
                <UnitRow label="Estimated OTDR distance" units={result.units?.otdrDistance} />
                {result.units?.routeLength ? (
                    <UnitRow label="Route length" units={result.units.routeLength} />
                ) : null}
            </WidgetPanelShell>
        );
    }

    const primaryLabel = step < maxStep
        ? 'Next'
        : isCalculator
            ? 'Calculate'
            : isPlot
                ? 'Plot on map'
                : isGet
                    ? (result ? 'Done' : 'Pick point on map')
                    : 'Run';

    const primaryDisabled = step === 1
        ? !canAdvanceStep1
        : step === 2 && !isCalculator
            ? !canAdvanceStep2
            : step === maxStep && !canRunStep && !isGet;

    return (
        <WidgetPanelShell
            status={error || (picking ? 'Click a point on the selected route…' : '')}
            statusTone={error ? 'danger' : 'muted'}
            footer={(
                <RunPreviewFooter
                    onCancel={onCancel}
                    showBack={step > 1}
                    onBack={goBack}
                    onRun={handlePrimaryAction}
                    runLabel={primaryLabel}
                    running={running || picking}
                    runBusyLabel={picking ? 'Waiting for map click…' : 'Working…'}
                    disabled={primaryDisabled}
                />
            )}
        >
            <WidgetStepWizard steps={wizardSteps} currentStep={step} />

            {step === 1 ? (
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                        What would you like to do?
                    </p>
                    {workflowOptions.map((option) => (
                        <WorkflowCard
                            key={option.value}
                            option={option}
                            selected={workflow === option.value}
                            onSelect={(value) => {
                                setWorkflow(value);
                                setResult(null);
                                setError('');
                            }}
                        />
                    ))}
                </div>
            ) : null}

            {step === 2 && !isCalculator ? (
                <div>
                    <LayerSelect
                        label="Line layer"
                        value={layerId}
                        onChange={(id) => {
                            setLayerId(id);
                            setError('');
                        }}
                        layers={layers}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                        {selectionCount > 0
                            ? `${selectionCount} feature${selectionCount === 1 ? '' : 's'} selected on the map.`
                            : selectedLayer?.featureCount === 1
                                ? 'Single line feature will be used automatically.'
                                : 'Select one or more line features on the map.'}
                    </div>

                    <div className="form-group">
                        <label>Direction of measurement</label>
                        {directionOptions.map((opt) => (
                            <label key={opt.value} style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                                <input
                                    type="radio"
                                    name="direction"
                                    checked={direction === opt.value}
                                    onChange={() => setDirection(opt.value)}
                                    style={{ marginRight: 6 }}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </div>

                    <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 8px' }}
                        onClick={() => setShowHelp((v) => !v)}
                    >
                        {showHelp ? 'Hide' : 'Ideal line data help'}
                    </button>
                    {showHelp ? (
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{idealDataHelpText}</p>
                    ) : null}
                </div>
            ) : null}

            {(step === 2 && isCalculator) || (step === 3 && !isCalculator) ? (
                <div>
                    <div className="form-group">
                        <label>Scenario preset</label>
                        {scenarioOptions.map((opt) => (
                            <label key={opt.value} style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                                <input
                                    type="radio"
                                    name="scenario"
                                    checked={scenario === opt.value}
                                    onChange={() => setScenario(opt.value)}
                                    style={{ marginRight: 6 }}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </div>
                    <AdvancedSlackSettings settings={slackSettings} onChange={setSlackSettings} />
                </div>
            ) : null}

            {((step === 3 && isCalculator) || (step === 4 && !isCalculator)) ? (
                <div>
                    {isCalculator ? (
                        <div className="form-group">
                            <label>Input type</label>
                            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                                <input
                                    type="radio"
                                    name="calcInputType"
                                    checked={calculatorInputType === 'map'}
                                    onChange={() => setCalculatorInputType('map')}
                                    style={{ marginRight: 6 }}
                                />
                                Map distance → estimate OTDR distance
                            </label>
                            <label style={{ display: 'block', fontSize: 12 }}>
                                <input
                                    type="radio"
                                    name="calcInputType"
                                    checked={calculatorInputType === 'otdr'}
                                    onChange={() => setCalculatorInputType('otdr')}
                                    style={{ marginRight: 6 }}
                                />
                                OTDR distance → estimate map distance
                            </label>
                        </div>
                    ) : null}

                    {isPlot || isCalculator ? (
                        <>
                            <div className="form-group">
                                <label>{isPlot ? 'Known OTDR distance' : 'Distance'}</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={inputDistance}
                                    onChange={(e) => setInputDistance(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>Unit</label>
                                <select value={inputUnit} onChange={(e) => setInputUnit(e.target.value)}>
                                    {unitOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    ) : null}

                    {isGet ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Click <strong>Pick point on map</strong> below, then click a location on your selected route.
                            The widget will measure map distance, add estimated slack, and show the estimated OTDR distance.
                        </div>
                    ) : null}
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
