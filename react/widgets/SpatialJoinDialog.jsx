import { useMemo, useState } from 'react';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';

export function SpatialJoinDialog({
    layers = [],
    predicateOptions = [],
    pythonAvailable = false,
    accelThreshold = 5000,
    onCancel,
    onRun,
    onLayerFocus
}) {
    const [leftLayerId, setLeftLayerId] = useState('');
    const [rightLayerId, setRightLayerId] = useState('');
    const [predicate, setPredicate] = useState('within');
    const [preferPython, setPreferPython] = useState(true);
    const [outputName, setOutputName] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');

    const leftLayer = useMemo(
        () => layers.find((l) => l.id === leftLayerId) || null,
        [layers, leftLayerId]
    );
    const rightLayer = useMemo(
        () => layers.find((l) => l.id === rightLayerId) || null,
        [layers, rightLayerId]
    );

    const canRun = Boolean(leftLayerId && rightLayerId && leftLayerId !== rightLayerId && !busy);

    const hint = pythonAvailable
        ? `Windows: layers with a library path or ≥${accelThreshold.toLocaleString()} features use Python when available.`
        : 'Runs in the browser (Turf points-in-polygons).';

    return (
        <WidgetPanelShell
            status={error || status || hint}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            runLabel={busy ? 'Joining…' : 'Run spatial join'}
            disabled={!canRun}
            onRun={async () => {
                setBusy(true);
                setError('');
                setStatus('Starting…');
                try {
                    await onRun?.(
                        {
                            leftLayerId,
                            rightLayerId,
                            predicate,
                            preferPython,
                            outputName: outputName.trim() || undefined
                        },
                        {
                            onProgress: (msg) => setStatus(typeof msg === 'string' ? msg : 'Working…')
                        }
                    );
                    onCancel?.();
                } catch (err) {
                    setError(err?.message || String(err));
                } finally {
                    setBusy(false);
                }
            }}
        >
            <p className="text-sm text-muted mb-8">
                Copy attributes from the join layer onto matching features. Desktop can use the
                Python sidecar for large or library-backed layers.
            </p>

            <LayerSelect
                label="Features layer (left)"
                layers={layers}
                value={leftLayerId}
                onChange={(id) => {
                    setLeftLayerId(id);
                    onLayerFocus?.(id);
                }}
            />
            <LayerSelect
                label="Join layer (right)"
                layers={layers}
                value={rightLayerId}
                onChange={(id) => {
                    setRightLayerId(id);
                    onLayerFocus?.(id);
                }}
            />

            <div className="form-group">
                <label htmlFor="spatial-join-predicate">Predicate</label>
                <select
                    id="spatial-join-predicate"
                    value={predicate}
                    onChange={(e) => setPredicate(e.target.value)}
                >
                    {predicateOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label htmlFor="spatial-join-name">Output layer name (optional)</label>
                <input
                    id="spatial-join-name"
                    type="text"
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    placeholder={leftLayer ? `${leftLayer.name}_spatial_join` : 'Auto'}
                />
            </div>

            {pythonAvailable ? (
                <label className="form-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="checkbox"
                        checked={preferPython}
                        onChange={(e) => setPreferPython(e.target.checked)}
                    />
                    Prefer Python sidecar when available
                </label>
            ) : null}

            {leftLayer && rightLayer ? (
                <p className="text-xs text-muted">
                    {(leftLayer.featureCount || 0).toLocaleString()} × {(rightLayer.featureCount || 0).toLocaleString()} features
                </p>
            ) : null}
        </WidgetPanelShell>
    );
}
