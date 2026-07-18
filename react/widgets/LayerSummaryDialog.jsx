import { useMemo, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { formatByteSize } from '../../js/widgets/geojson-file-summary/engine.js';

export function LayerSummaryDialog({
    layers = [],
    pythonAvailable = false,
    accelThreshold = 2500,
    onCancel,
    onRun
}) {
    const [layerId, setLayerId] = useState(layers[0]?.id || '');
    const [preferPython, setPreferPython] = useState(true);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState(
        pythonAvailable
            ? `Python acceleration available for layers with ≥ ${accelThreshold.toLocaleString()} features.`
            : 'Summarizes the selected layer in JavaScript.'
    );

    const selected = useMemo(
        () => layers.find((layer) => layer.id === layerId),
        [layers, layerId]
    );

    const runSummary = async () => {
        setError('');
        setMessage('');
        setRunning(true);
        setProgress({ percent: 0, stage: 'starting', message: 'Starting…' });
        try {
            const output = await onRun?.({
                layerId,
                preferPython,
                onProgress: (p) => setProgress(p || null)
            });
            setResult(output || null);
            setMessage(output?.providerLabel
                ? `Complete via ${output.providerLabel}.`
                : 'Summary complete.');
        } catch (err) {
            setError(err?.message || 'Summary failed.');
            setResult(null);
        } finally {
            setRunning(false);
        }
    };

    if (result) {
        return (
            <WidgetPanelShell
                onCancel={onCancel}
                showRun={false}
                cancelLabel="Done"
                status={message}
            >
                <div className="text-sm" style={{ display: 'grid', gap: 10 }}>
                    <ProviderBadge label={result.providerLabel || 'JavaScript'} accelerated={result.provider === 'python'} />
                    <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Layer</div>
                        <div>{result.layerName || selected?.name || '—'}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Stat label="Features" value={String(result.featureCount ?? 0)} />
                        <Stat label="Approx. size" value={formatByteSize(result.byteSize)} />
                        <Stat label="Root type" value={String(result.rootType || '—')} />
                        <Stat label="Property fields" value={String(result.propertyKeys?.length || 0)} />
                    </div>
                    <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Geometry types</div>
                        {(result.geometryTypeEntries || Object.entries(result.geometryTypes || {}).map(([type, count]) => ({ type, count }))).length ? (
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {(result.geometryTypeEntries || Object.entries(result.geometryTypes || {}).map(([type, count]) => ({ type, count }))).map((entry) => (
                                    <li key={entry.type}>{entry.type}: {entry.count}</li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>None</div>
                        )}
                    </div>
                    <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Property keys</div>
                        <div className="text-xs" style={{ wordBreak: 'break-word' }}>
                            {(result.propertyKeys || []).join(', ') || '—'}
                        </div>
                    </div>
                </div>
            </WidgetPanelShell>
        );
    }

    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={runSummary}
            runLabel={running ? 'Summarizing…' : 'Run Summary'}
            running={running}
            disabled={!layerId || running}
            status={error || message}
            statusTone={error ? 'danger' : 'muted'}
        >
            <div className="text-sm" style={{ display: 'grid', gap: 12 }}>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    Summarize feature counts, geometry types, and attribute fields for a map layer.
                    On Windows, large layers can use the Python sidecar when available.
                </p>
                <LayerSelect
                    label="Layer"
                    layers={layers}
                    value={layerId}
                    onChange={setLayerId}
                />
                {pythonAvailable ? (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <input
                            type="checkbox"
                            checked={preferPython}
                            onChange={(event) => setPreferPython(event.target.checked)}
                            disabled={running}
                        />
                        <span>
                            Prefer Python acceleration for large layers
                            <span className="text-xs" style={{ display: 'block', color: 'var(--text-muted)' }}>
                                Uses Python when the layer has at least {accelThreshold.toLocaleString()} features.
                            </span>
                        </span>
                    </label>
                ) : null}
                {selected ? (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Selected: {selected.name}
                        {typeof selected.featureCount === 'number' ? ` · ${selected.featureCount.toLocaleString()} features` : ''}
                    </div>
                ) : null}
                {progress ? (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {progress.stage ? `${progress.stage}: ` : ''}
                        {progress.message || ''}
                        {typeof progress.percent === 'number' ? ` (${Math.round(progress.percent)}%)` : ''}
                    </div>
                ) : null}
            </div>
        </WidgetPanelShell>
    );
}

function ProviderBadge({ label, accelerated }) {
    return (
        <div
            className="text-xs"
            style={{
                display: 'inline-flex',
                alignSelf: 'start',
                padding: '4px 8px',
                borderRadius: 999,
                border: '1px solid var(--border, #333)',
                background: accelerated ? 'rgba(46, 160, 67, 0.15)' : 'transparent',
                color: accelerated ? 'var(--success, #3fb950)' : 'var(--text-muted)'
            }}
        >
            Mode: {label}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div
            style={{
                border: '1px solid var(--border, #333)',
                borderRadius: 6,
                padding: '8px 10px'
            }}
        >
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontWeight: 600 }}>{value}</div>
        </div>
    );
}
