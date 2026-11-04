import { useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';

const CHART_W = 440;
const CHART_H = 200;
const PAD = { l: 46, r: 10, t: 12, b: 26 };

function formatMeters(value) {
    if (value == null || !Number.isFinite(value)) return 'n/a';
    const abs = Math.abs(value);
    const digits = abs >= 100 ? 0 : 1;
    return `${value.toFixed(digits)} m`;
}

function formatDistance(meters) {
    if (!Number.isFinite(meters)) return 'n/a';
    if (Math.abs(meters) >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} m`;
}

function formatCoord(coord) {
    if (!Array.isArray(coord)) return '';
    return `${Number(coord[1]).toFixed(5)}, ${Number(coord[0]).toFixed(5)}`;
}

function chartDomain(samples, segments, sight) {
    const ys = [];
    for (const segment of segments) {
        for (const point of segment) ys.push(point.elevationM);
    }
    if (sight) {
        ys.push(sight.observerAbsoluteM, sight.targetAbsoluteM);
        if (sight.obstruction) ys.push(sight.obstruction.effectiveM, sight.obstruction.losM);
    }
    let minY = ys.length ? Math.min(...ys) : 0;
    let maxY = ys.length ? Math.max(...ys) : 1;
    if (minY === maxY) {
        minY -= 1;
        maxY += 1;
    }
    const padY = (maxY - minY) * 0.08;
    const maxX = samples.length ? samples[samples.length - 1].distanceM : 0;
    return { minY: minY - padY, maxY: maxY + padY, maxX: maxX > 0 ? maxX : 1 };
}

function ElevationChart({ samples, segments, sight, obstruction, label }) {
    const { minY, maxY, maxX } = chartDomain(samples, segments, sight);
    const xOf = (distance) => PAD.l + (distance / maxX) * (CHART_W - PAD.l - PAD.r);
    const yOf = (elevation) => PAD.t + (1 - (elevation - minY) / (maxY - minY)) * (CHART_H - PAD.t - PAD.b);
    const pointsOf = (pts) => pts.map((pt) => `${xOf(pt.distanceM)},${yOf(pt.elevationM)}`).join(' ');
    const sightPoints = sight
        ? samples.map((sample) => {
            const span = samples[samples.length - 1].distanceM;
            const elevation = span > 0
                ? sight.observerAbsoluteM + (sample.distanceM / span) * (sight.targetAbsoluteM - sight.observerAbsoluteM)
                : sight.observerAbsoluteM;
            return { distanceM: sample.distanceM, elevationM: elevation };
        })
        : [];

    return (
        <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            role="img"
            aria-label={label}
            style={{ width: '100%', height: 'auto', background: 'var(--bg-surface)', borderRadius: 6 }}
        >
            <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={CHART_H - PAD.b} stroke="currentColor" strokeOpacity="0.35" />
            <line x1={PAD.l} y1={CHART_H - PAD.b} x2={CHART_W - PAD.r} y2={CHART_H - PAD.b} stroke="currentColor" strokeOpacity="0.35" />
            <text x={PAD.l - 4} y={yOf(maxY) + 3} textAnchor="end" fontSize="10" fill="currentColor">{formatMeters(maxY)}</text>
            <text x={PAD.l - 4} y={yOf(minY) + 3} textAnchor="end" fontSize="10" fill="currentColor">{formatMeters(minY)}</text>
            <text x={PAD.l} y={CHART_H - 6} fontSize="10" fill="currentColor">0</text>
            <text x={CHART_W - PAD.r} y={CHART_H - 6} textAnchor="end" fontSize="10" fill="currentColor">{formatDistance(samples.length ? samples[samples.length - 1].distanceM : 0)}</text>
            {sightPoints.length > 1 ? (
                <polyline
                    fill="none"
                    stroke="#15803d"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    points={pointsOf(sightPoints)}
                />
            ) : null}
            {segments.map((segment, index) => (
                segment.length > 1 ? (
                    <polyline
                        key={`seg-${index}`}
                        fill="none"
                        stroke="#b7791f"
                        strokeWidth="2"
                        points={pointsOf(segment)}
                    />
                ) : (
                    <circle
                        key={`seg-${index}`}
                        cx={xOf(segment[0].distanceM)}
                        cy={yOf(segment[0].elevationM)}
                        r="2.5"
                        fill="#b7791f"
                    />
                )
            ))}
            {obstruction ? (
                <circle
                    cx={xOf(obstruction.distanceM)}
                    cy={yOf(obstruction.effectiveM)}
                    r="5"
                    fill="#b91c1c"
                    stroke="#fff"
                    strokeWidth="1.5"
                />
            ) : null}
        </svg>
    );
}

export function TerrainProfileDialog({
    initialState = null,
    onCancel,
    onDrawLine,
    onPickPoint,
    onPreviewPoints,
    onRun,
    onAddLayer,
    onSendToTarget
}) {
    const [mode, setMode] = useState(initialState?.mode === 'los' ? 'los' : 'profile');
    const [spacing, setSpacing] = useState(String(initialState?.spacingM ?? 30));
    const [coordinates, setCoordinates] = useState(initialState?.coordinates || null);
    const [observer, setObserver] = useState(initialState?.observer || null);
    const [target, setTarget] = useState(initialState?.target || null);
    const [observerHeight, setObserverHeight] = useState(String(initialState?.observerHeightM ?? 1.7));
    const [targetHeight, setTargetHeight] = useState(String(initialState?.targetHeightM ?? 0));
    const [curvature, setCurvature] = useState(!!initialState?.curvature);
    const [picking, setPicking] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [producedResult, setProducedResult] = useState(null);

    const changeMode = (next) => {
        setMode(next);
        setResult(null);
        setProducedResult(null);
        setError('');
        setMessage('');
    };

    const drawLine = async () => {
        setError('');
        setPicking(true);
        try {
            const next = await onDrawLine?.();
            if (!next) return;
            setCoordinates(next);
            setResult(null);
            setProducedResult(null);
            setMessage(`Profile line set (${next.length} points).`);
        } catch (err) {
            setError(err?.message || 'Unable to draw a line.');
        } finally {
            setPicking(false);
        }
    };

    const pickPoint = async (role) => {
        setError('');
        setPicking(true);
        try {
            const coord = await onPickPoint?.(role);
            if (!coord) return;
            const nextObserver = role === 'observer' ? coord : observer;
            const nextTarget = role === 'target' ? coord : target;
            if (role === 'observer') setObserver(coord);
            else setTarget(coord);
            onPreviewPoints?.(nextObserver, nextTarget);
            setResult(null);
            setProducedResult(null);
            setMessage(role === 'observer' ? 'Observer set.' : 'Target set.');
        } catch (err) {
            setError(err?.message || 'Unable to pick a point.');
        } finally {
            setPicking(false);
        }
    };

    const run = async () => {
        setError('');
        setMessage('');
        setRunning(true);
        try {
            const spacingM = Number(spacing);
            const output = await onRun?.(mode === 'los' ? {
                mode: 'los',
                observer,
                target,
                observerHeightM: Number(observerHeight),
                targetHeightM: Number(targetHeight),
                spacingM,
                curvature
            } : {
                mode: 'profile',
                coordinates,
                spacingM
            });
            setResult(output || null);
            setProducedResult(null);
            if (output && !output.stats?.validCount) {
                setError('No terrain elevation was returned along this line.');
            }
        } catch (err) {
            setResult(null);
            setError(err?.message || 'Elevation sampling failed.');
        } finally {
            setRunning(false);
        }
    };

    const addLayer = async () => {
        if (!result) return;
        try {
            const produced = await onAddLayer?.(result);
            if (produced) setProducedResult(produced);
        } catch (err) {
            setError(err?.message || 'Unable to add the layer.');
        }
    };

    const ready = mode === 'los'
        ? !!(observer && target)
        : !!(coordinates && coordinates.length >= 2);
    const statusText = error || message;
    const stats = result?.stats;
    const chartLabel = result?.mode === 'los'
        ? (result.visible ? 'Line of sight is visible' : 'Line of sight is blocked')
        : 'Elevation profile';

    return (
        <WidgetPanelShell
            status={statusText}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            onRun={run}
            runLabel="Run"
            running={running}
            disabled={running || picking || !ready}
            producedResult={producedResult}
            onSendToTarget={onSendToTarget}
        >
            <div className="form-group">
                <label>Mode</label>
                <div className="gis-widget__btn-row">
                    <button
                        type="button"
                        className={`btn btn-sm ${mode === 'profile' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => changeMode('profile')}
                    >
                        Elevation profile
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm ${mode === 'los' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => changeMode('los')}
                    >
                        Line of sight
                    </button>
                </div>
            </div>

            {mode === 'profile' ? (
                <div className="form-group">
                    <label>Profile line</label>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={drawLine} disabled={picking || running}>
                        {coordinates ? `Line ready (${coordinates.length} points)` : 'Draw line'}
                    </button>
                </div>
            ) : (
                <div className="form-group">
                    <label>Observer and target</label>
                    <div className="gis-widget__btn-row">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickPoint('observer')} disabled={picking || running}>
                            {observer ? `Observer ${formatCoord(observer)}` : 'Pick observer'}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickPoint('target')} disabled={picking || running}>
                            {target ? `Target ${formatCoord(target)}` : 'Pick target'}
                        </button>
                    </div>
                </div>
            )}

            <div className="form-group">
                <label htmlFor="terrain-spacing">Sample spacing (m)</label>
                <input
                    id="terrain-spacing"
                    type="number"
                    min="1"
                    step="1"
                    value={spacing}
                    onChange={(event) => setSpacing(event.target.value)}
                />
            </div>

            {mode === 'los' ? (
                <>
                    <div className="form-group">
                        <label htmlFor="terrain-observer-height">Observer height above ground (m)</label>
                        <input
                            id="terrain-observer-height"
                            type="number"
                            min="0"
                            step="0.1"
                            value={observerHeight}
                            onChange={(event) => setObserverHeight(event.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="terrain-target-height">Target height above ground (m)</label>
                        <input
                            id="terrain-target-height"
                            type="number"
                            min="0"
                            step="0.1"
                            value={targetHeight}
                            onChange={(event) => setTargetHeight(event.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={curvature}
                                onChange={(event) => setCurvature(event.target.checked)}
                            />
                            <span className="toggle-track" />
                            <span>Earth curvature and refraction</span>
                        </label>
                    </div>
                </>
            ) : null}

            {result && stats ? (
                <div className="form-group">
                    <label>{result.mode === 'los' ? (result.visible ? 'Visible' : 'Blocked') : 'Profile'}</label>
                    {result.mode === 'los' && result.obstruction ? (
                        <div className="text-xs">
                            Obstruction at {formatDistance(result.obstruction.distanceM)}
                            {result.curvature ? ' (terrain plus earth curvature)' : ''}
                        </div>
                    ) : null}
                    <div className="text-xs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
                        <div>Distance {formatDistance(stats.totalDistanceM)}</div>
                        <div>Samples {result.samples?.length || 0}</div>
                        <div>Min {formatMeters(stats.min)}</div>
                        <div>Max {formatMeters(stats.max)}</div>
                        <div>Total gain {formatMeters(stats.gain)}</div>
                        <div>Total loss {formatMeters(stats.loss)}</div>
                    </div>
                    {stats.gapCount > 0 ? (
                        <div className="text-xs">Elevation gaps: {stats.gapCount}. Those samples are skipped.</div>
                    ) : null}
                    {stats.validCount > 0 ? (
                        <>
                            <ElevationChart
                                samples={result.samples}
                                segments={result.segments || []}
                                sight={result.mode === 'los' ? result : null}
                                obstruction={result.obstruction || null}
                                label={chartLabel}
                            />
                            <div className="text-xs">
                                {result.mode === 'los'
                                    ? 'Solid line: ground. Dashed line: sight line. Red dot: obstruction.'
                                    : 'Solid line: ground elevation. Breaks are samples with no terrain value.'}
                            </div>
                        </>
                    ) : null}
                    <div className="gis-widget__btn-row">
                        <button type="button" className="gis-widget__link-btn" onClick={addLayer}>
                            Add as layer
                        </button>
                    </div>
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
