import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayerSelect } from '../shared/LayerSelect.jsx';
import { RunPreviewFooter } from '../shared/RunPreviewFooter.jsx';
import { WidgetPanelShell } from '../shared/WidgetPanelShell.jsx';

const WIZARD_STEPS = [
    'Locations',
    'Planning settings',
    'Review & run',
    'Results'
];

const OPTIMIZATION_GOAL_OPTIONS = [
    { value: 'cover_most', label: 'Cover most locations' },
    { value: 'fewest_poles', label: 'Use fewest poles' },
    { value: 'fewest_antennas', label: 'Use fewest antennas' },
    { value: 'balanced', label: 'Balanced' }
];

const SECTOR_WIDTH_MODE_OPTIONS = [
    { value: 'fixed', label: 'Fixed sector width' },
    { value: 'auto_fit', label: 'Auto-fit sector width' }
];

const SECTOR_WIDTH_CHOICES = [30, 45, 60, 90, 120, 180, 360];

function SourceModeToggle({ mode, onChange }) {
    return (
        <div className="form-group">
            <label>Data source</label>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                        type="radio"
                        name="source-locations"
                        checked={mode === 'layer'}
                        onChange={() => onChange('layer')}
                    />
                    Use existing layer
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                        type="radio"
                        name="source-locations"
                        checked={mode === 'draw'}
                        onChange={() => onChange('draw')}
                    />
                    Draw points on map
                </label>
            </div>
        </div>
    );
}

function StatsBlock({ title, stats }) {
    if (!stats) return null;
    return (
        <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
            <div>Total: {stats.total ?? 0}</div>
            <div>Valid: {stats.valid ?? stats.validClients ?? stats.validPoles ?? 0}</div>
            {(stats.invalid ?? stats.invalidClients ?? stats.invalidPoles) > 0 ? (
                <div>Invalid/skipped: {stats.invalid ?? stats.invalidClients ?? stats.invalidPoles}</div>
            ) : null}
            {stats.polesWithExistingAttrs != null ? (
                <div>Poles with existing sector settings: {stats.polesWithExistingAttrs}</div>
            ) : null}
            {stats.polesUsingDefaults != null ? (
                <div>Poles using default settings: {stats.polesUsingDefaults}</div>
            ) : null}
        </div>
    );
}

function DrawPointsBlock({ label, count, drawing, onStart, onStop, disabled }) {
    return (
        <div className="form-group" style={{ marginBottom: 8 }}>
            <label>{label}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {drawing ? (
                    <button type="button" className="btn btn-sm btn-primary" onClick={onStop}>
                        Stop adding
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={onStart}
                        disabled={disabled}
                    >
                        Add points on map
                    </button>
                )}
            </div>
            <div className="text-xs" style={{ marginTop: 6, color: 'var(--text-muted)' }}>
                {count} point{count === 1 ? '' : 's'}
                {drawing ? ' — click the map repeatedly; Esc or Cancel when done' : ''}
            </div>
        </div>
    );
}

export function PoleSectorOptimizerPanel({
    layers = [],
    unitOptions = [],
    onCancel,
    onValidateLocations,
    onStartDrawClientPoints,
    onStartDrawPolePoints,
    onStopPointDraw,
    onDownloadLocationsTemplate,
    onUpdateDrawPreview,
    onRun,
    onCreateOutputs
}) {
    const [step, setStep] = useState(1);
    const [sourceMode, setSourceMode] = useState('layer');
    const [drawingMode, setDrawingMode] = useState(null);
    const drawingModeRef = useRef(null);
    const [locationsLayerId, setLocationsLayerId] = useState('');
    const [drawnClients, setDrawnClients] = useState([]);
    const [drawnPoles, setDrawnPoles] = useState([]);
    const [clientStats, setClientStats] = useState(null);
    const [poleStats, setPoleStats] = useState(null);
    const [units, setUnits] = useState('miles');
    const [defaultRange, setDefaultRange] = useState('1');
    const [defaultSectorWidth, setDefaultSectorWidth] = useState('45');
    const [sectorWidthMode, setSectorWidthMode] = useState('fixed');
    const [maxAntennasPerPole, setMaxAntennasPerPole] = useState(1);
    const [optimizationGoal, setOptimizationGoal] = useState('balanced');
    const [createAssignmentLines, setCreateAssignmentLines] = useState(false);
    const [results, setResults] = useState(null);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [running, setRunning] = useState(false);
    const [creating, setCreating] = useState(false);

    const unitsLabel = useMemo(
        () => unitOptions.find((opt) => opt.value === units)?.label?.match(/\(([^)]+)\)/)?.[1] || units,
        [unitOptions, units]
    );

    const settings = useMemo(() => ({
        defaultRange,
        defaultSectorWidth,
        sectorWidthMode,
        maxAntennasPerPole,
        optimizationGoal,
        units,
        createAssignmentLines
    }), [defaultRange, defaultSectorWidth, sectorWidthMode, maxAntennasPerPole, optimizationGoal, units, createAssignmentLines]);

    const refreshLocationStats = useCallback(async () => {
        if (!onValidateLocations) return;
        try {
            const result = await onValidateLocations({
                sourceMode,
                locationsLayerId,
                drawnClients,
                drawnPoles,
                settings
            });
            setClientStats(result.clientStats);
            setPoleStats(result.poleStats);
        } catch {
            setClientStats(null);
            setPoleStats(null);
        }
    }, [onValidateLocations, sourceMode, locationsLayerId, drawnClients, drawnPoles, settings]);

    useEffect(() => {
        if (step >= 1) refreshLocationStats();
    }, [step, refreshLocationStats]);

    useEffect(() => {
        if (!onUpdateDrawPreview) return;
        onUpdateDrawPreview({
            drawnClients: sourceMode === 'draw' ? drawnClients : [],
            drawnPoles: sourceMode === 'draw' ? drawnPoles : []
        });
    }, [drawnClients, drawnPoles, sourceMode, onUpdateDrawPreview]);

    const canAdvanceStep1 = sourceMode === 'layer'
        ? Boolean(locationsLayerId) && (clientStats?.valid ?? 0) > 0 && (poleStats?.valid ?? 0) > 0
        : drawnClients.length > 0 && drawnPoles.length > 0;

    const canAdvanceStep2 = parseFloat(defaultRange) > 0 && parseFloat(defaultSectorWidth) > 0;

    const stopDrawing = useCallback(() => {
        onStopPointDraw?.();
        drawingModeRef.current = null;
        setDrawingMode(null);
    }, [onStopPointDraw]);

    useEffect(() => () => stopDrawing(), [stopDrawing]);

    useEffect(() => {
        if (step !== 1 && drawingMode) stopDrawing();
    }, [step, drawingMode, stopDrawing]);

    const handleSourceModeChange = (mode) => {
        if (drawingMode) stopDrawing();
        setSourceMode(mode);
    };

    const handleStartDrawClient = async () => {
        if (drawingModeRef.current) stopDrawing();
        drawingModeRef.current = 'client';
        setDrawingMode('client');
        setError('');
        setStatus('Click the map to add client locations. Press Esc or Cancel on the map when done.');
        try {
            await onStartDrawClientPoints?.({
                onPoint: (feature) => {
                    setDrawnClients((prev) => [...prev, feature]);
                }
            });
        } catch (err) {
            setError(err.message || 'Could not add client points.');
        } finally {
            drawingModeRef.current = null;
            setDrawingMode(null);
            setStatus('');
        }
    };

    const handleStartDrawPole = async () => {
        if (drawingModeRef.current) stopDrawing();
        drawingModeRef.current = 'pole';
        setDrawingMode('pole');
        setError('');
        setStatus('Click the map to add pole locations. Press Esc or Cancel on the map when done.');
        try {
            await onStartDrawPolePoints?.({
                settings,
                onPoint: (feature) => {
                    setDrawnPoles((prev) => [...prev, feature]);
                }
            });
        } catch (err) {
            setError(err.message || 'Could not add pole points.');
        } finally {
            drawingModeRef.current = null;
            setDrawingMode(null);
            setStatus('');
        }
    };

    const handleRun = async () => {
        stopDrawing();
        setRunning(true);
        setError('');
        setStatus('Running optimizer…');
        try {
            const result = await onRun?.({
                sourceMode,
                locationsLayerId,
                drawnClients,
                drawnPoles,
                settings
            });
            setResults(result);
            setStep(4);
            setStatus('Optimization complete. Review results below.');
        } catch (err) {
            setError(err.message || 'Optimization failed.');
            setStatus('');
        } finally {
            setRunning(false);
        }
    };

    const handleCreateOutputs = async () => {
        if (!results) return;
        setCreating(true);
        setError('');
        try {
            await onCreateOutputs?.(results, { createAssignmentLines, settings });
            setStatus('Output layers created.');
        } catch (err) {
            setError(err.message || 'Could not create output layers.');
        } finally {
            setCreating(false);
        }
    };

    const handleBackFromResults = () => {
        setResults(null);
        setStep(2);
        setStatus('');
        setError('');
    };

    const wizardFooter = () => {
        if (step < 3) {
            return (
                <RunPreviewFooter
                    onCancel={onCancel}
                    showBack={step > 1}
                    onBack={() => setStep((s) => s - 1)}
                    onRun={() => setStep((s) => s + 1)}
                    runLabel="Next"
                    disabled={
                        (step === 1 && !canAdvanceStep1)
                        || (step === 2 && !canAdvanceStep2)
                    }
                />
            );
        }
        if (step === 3) {
            return (
                <RunPreviewFooter
                    onCancel={onCancel}
                    showBack
                    onBack={() => setStep(2)}
                    onRun={handleRun}
                    runLabel="Run optimizer"
                    running={running}
                    disabled={running || !canAdvanceStep2}
                />
            );
        }
        return (
            <RunPreviewFooter
                onCancel={onCancel}
                showBack
                onBack={handleBackFromResults}
                onRun={handleCreateOutputs}
                runLabel="Create output layers"
                running={creating}
                runBusyLabel="Creating…"
                disabled={creating}
            />
        );
    };

    return (
        <WidgetPanelShell
            status={error || status}
            statusTone={error ? 'danger' : 'muted'}
            showRun={false}
            footer={wizardFooter()}
        >
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, lineHeight: 1.35 }}>
                {WIZARD_STEPS[step - 1]}
            </div>

            {step === 1 ? (
                <>
                    <SourceModeToggle mode={sourceMode} onChange={handleSourceModeChange} />
                    {sourceMode === 'layer' ? (
                        <LayerSelect
                            label="Locations layer"
                            value={locationsLayerId}
                            layers={layers}
                            onChange={setLocationsLayerId}
                            placeholder="- select layer -"
                            headerExtra={(
                                <button
                                    type="button"
                                    className="btn-icon"
                                    onClick={() => onDownloadLocationsTemplate?.()}
                                    title="Download CSV template"
                                    aria-label="Download CSV template"
                                >
                                    📄
                                </button>
                            )}
                        />
                    ) : (
                        <>
                            <DrawPointsBlock
                                label="Client points"
                                count={drawnClients.length}
                                drawing={drawingMode === 'client'}
                                onStart={handleStartDrawClient}
                                onStop={stopDrawing}
                                disabled={Boolean(drawingMode) && drawingMode !== 'client'}
                            />
                            <DrawPointsBlock
                                label="Pole points"
                                count={drawnPoles.length}
                                drawing={drawingMode === 'pole'}
                                onStart={handleStartDrawPole}
                                onStop={stopDrawing}
                                disabled={Boolean(drawingMode) && drawingMode !== 'pole'}
                            />
                        </>
                    )}
                    <StatsBlock title="Client points" stats={clientStats} />
                    <StatsBlock title="Pole points" stats={poleStats} />
                </>
            ) : null}

            {step === 2 ? (
                <>
                    <div className="form-group">
                        <label htmlFor="wsp-coverage-distance">Coverage distance</label>
                        <input
                            id="wsp-coverage-distance"
                            type="number"
                            min="0"
                            step="any"
                            value={defaultRange}
                            placeholder="e.g. 1"
                            onChange={(e) => setDefaultRange(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="wsp-coverage-units">Distance units</label>
                        <select
                            id="wsp-coverage-units"
                            value={units}
                            onChange={(e) => setUnits(e.target.value)}
                        >
                            {unitOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Sector width mode</label>
                        <select value={sectorWidthMode} onChange={(e) => setSectorWidthMode(e.target.value)}>
                            {SECTOR_WIDTH_MODE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    {sectorWidthMode === 'fixed' ? (
                        <div className="form-group">
                            <label>Sector width (degrees)</label>
                            <select value={defaultSectorWidth} onChange={(e) => setDefaultSectorWidth(e.target.value)}>
                                {SECTOR_WIDTH_CHOICES.map((width) => (
                                    <option key={width} value={String(width)}>{width}°</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            The optimizer will try sector widths from 30° to 360° and prefer the smallest width that covers each group.
                        </p>
                    )}
                    <div className="form-group">
                        <label>Maximum antennas per pole</label>
                        <select value={maxAntennasPerPole} onChange={(e) => setMaxAntennasPerPole(parseInt(e.target.value, 10))}>
                            <option value={1}>1 antenna</option>
                            <option value={2}>2 antennas</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Optimization goal</label>
                        <select value={optimizationGoal} onChange={(e) => setOptimizationGoal(e.target.value)}>
                            {OPTIMIZATION_GOAL_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <input
                            type="checkbox"
                            checked={createAssignmentLines}
                            onChange={(e) => setCreateAssignmentLines(e.target.checked)}
                        />
                        Create client-to-pole assignment lines
                    </label>
                </>
            ) : null}

            {step === 3 ? (
                <div className="text-xs" style={{ lineHeight: 1.7 }}>
                    <p style={{ marginBottom: 8 }}>Ready to run the pole / sector coverage optimizer.</p>
                    <div><strong>Client points:</strong> {clientStats?.valid ?? 0} valid</div>
                    <div><strong>Pole points:</strong> {poleStats?.valid ?? 0} valid</div>
                    <div><strong>Coverage distance:</strong> {defaultRange} {unitsLabel}</div>
                    <div><strong>Sector width:</strong> {sectorWidthMode === 'fixed' ? `${defaultSectorWidth}°` : 'Auto-fit'}</div>
                    <div><strong>Max antennas per pole:</strong> {maxAntennasPerPole}</div>
                    <div><strong>Goal:</strong> {OPTIMIZATION_GOAL_OPTIONS.find((o) => o.value === optimizationGoal)?.label}</div>
                    <div><strong>Assignment lines:</strong> {createAssignmentLines ? 'Yes' : 'No'}</div>
                    <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
                        Source layers will not be changed. New output layers will be created after you review results.
                    </p>
                </div>
            ) : null}

            {step === 4 && results ? (
                <div className="text-xs" style={{ lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Coverage summary</div>
                    <div>Total locations: {results.summary?.totalClients ?? 0}</div>
                    <div>Covered locations: {results.summary?.coveredClients ?? 0}</div>
                    <div>Uncovered locations: {results.summary?.uncoveredClients ?? 0}</div>
                    <div>Recommended poles: {results.summary?.recommendedPoles ?? 0}</div>
                    <div>Recommended antennas: {results.summary?.recommendedAntennas ?? 0}</div>
                    <div>Coverage: {results.summary?.coveragePercent ?? 0}%</div>
                    <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
                        The map preview shows signal heatmaps, radiation patterns, recommended poles, and client locations.
                        Click Create output layers to add permanent layers to the map.
                    </p>
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
