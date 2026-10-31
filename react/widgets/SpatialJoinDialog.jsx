import { useMemo, useState } from 'react';
import { mapInitialInputToFields } from '../../js/widgets/widget-initial-input.js';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';

export function SpatialJoinDialog({
    layers = [],
    predicateOptions = [],
    initialInput = null,
    onCancel,
    onRun,
    onLayerFocus,
    onSendToTarget
}) {
    const sendToDefaults = useMemo(
        () => mapInitialInputToFields(initialInput, {
            points: 'leftLayerId',
            polygons: 'rightLayerId',
            in: 'leftLayerId'
        }),
        [initialInput]
    );

    const [leftLayerId, setLeftLayerId] = useState(() => sendToDefaults.leftLayerId || '');
    const [rightLayerId, setRightLayerId] = useState(() => sendToDefaults.rightLayerId || '');
    const [predicate, setPredicate] = useState('within');
    const [outputName, setOutputName] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [producedResult, setProducedResult] = useState(null);

    const leftLayer = useMemo(
        () => layers.find((l) => l.id === leftLayerId) || null,
        [layers, leftLayerId]
    );
    const rightLayer = useMemo(
        () => layers.find((l) => l.id === rightLayerId) || null,
        [layers, rightLayerId]
    );

    const canRun = Boolean(leftLayerId && rightLayerId && leftLayerId !== rightLayerId && !busy);

    const hint = producedResult
        ? 'Join complete — send the output layer to another tool or widget.'
        : 'Runs in the browser (Turf points-in-polygons).';

    return (
        <WidgetPanelShell
            status={error || status || hint}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            runLabel={busy ? 'Joining…' : 'Run spatial join'}
            disabled={!canRun || Boolean(producedResult)}
            showRun={!producedResult}
            producedResult={producedResult}
            onSendToTarget={onSendToTarget}
            onRun={async () => {
                setBusy(true);
                setError('');
                setStatus('Starting…');
                setProducedResult(null);
                try {
                    const output = await onRun?.(
                        {
                            leftLayerId,
                            rightLayerId,
                            predicate,
                            outputName: outputName.trim() || undefined
                        },
                        {
                            onProgress: (msg) => setStatus(typeof msg === 'string' ? msg : 'Working…')
                        }
                    );
                    if (output?.producedResult) {
                        setProducedResult(output.producedResult);
                        setStatus('Join complete.');
                    } else {
                        onCancel?.();
                    }
                } catch (err) {
                    setError(err?.message || String(err));
                } finally {
                    setBusy(false);
                }
            }}
        >
            <p className="text-sm text-muted mb-8">
                Copy attributes from the join layer onto matching features in the browser.
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

            {leftLayer && rightLayer ? (
                <p className="text-xs text-muted">
                    {(leftLayer.featureCount || 0).toLocaleString()} × {(rightLayer.featureCount || 0).toLocaleString()} features
                </p>
            ) : null}
        </WidgetPanelShell>
    );
}
