import { useMemo, useState } from 'react';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { listDetachableFieldNames } from '../../js/widgets/large-dataset-cleanup/engine.js';

export function LargeDatasetCleanupDialog({
    steps = [],
    layers = [],
    formatBytes = (n) => String(n),
    onCancel,
    onOpenStorageManager,
    onLayerFocus,
    onLoadFootprint,
    onRun
}) {
    const [step, setStep] = useState(1);
    const [layerId, setLayerId] = useState(layers[0]?.id || '');
    const [footprint, setFootprint] = useState(null);
    const [detachFields, setDetachFields] = useState([]);
    const [removeLayer, setRemoveLayer] = useState(false);
    const [deleteSource, setDeleteSource] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);

    const layer = useMemo(
        () => layers.find((entry) => entry.id === layerId) || null,
        [layers, layerId]
    );

    const detachable = useMemo(
        () => layer?.fields || listDetachableFieldNames([]),
        [layer]
    );

    const toggleField = (name) => {
        setDetachFields((prev) => (
            prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name]
        ));
    };

    const goNext = async () => {
        setError('');
        if (step === 1) {
            if (!layerId) {
                setError('Select a workspace layer.');
                return;
            }
            onLayerFocus?.(layerId);
            setRunning(true);
            try {
                const summary = await onLoadFootprint?.(layerId);
                setFootprint(summary || null);
                setStep(2);
            } catch (e) {
                setError(e?.message || 'Could not load layer footprint.');
            } finally {
                setRunning(false);
            }
            return;
        }
        if (step === 2) {
            setStep(3);
            return;
        }
        if (step === 3) {
            if (!detachFields.length && !removeLayer && !deleteSource) {
                setError('Choose at least one cleanup action.');
                return;
            }
            if (deleteSource && !removeLayer) {
                setError('Enable “Remove layer” to delete its preserved source, or use Storage Manager.');
                return;
            }
            setStep(4);
        }
    };

    const runCleanup = async () => {
        setError('');
        setRunning(true);
        setStatus('Running cleanup…');
        try {
            const outcome = await onRun?.({
                layerId,
                detachFields,
                removeLayer,
                deleteSource
            });
            setResult(outcome || {});
            setStatus('Cleanup complete.');
        } catch (e) {
            setError(e?.message || 'Cleanup failed.');
            setStatus('');
        } finally {
            setRunning(false);
        }
    };

    return (
        <WidgetPanelShell>
            <WidgetStepWizard steps={steps} currentStep={step} variant="compact" />

            {step === 1 && (
                <>
                    <LayerSelect
                        label="Workspace layer"
                        layers={layers}
                        value={layerId}
                        onChange={(id) => {
                            setLayerId(id);
                            setFootprint(null);
                            setResult(null);
                            setDetachFields([]);
                            setRemoveLayer(false);
                            setDeleteSource(false);
                        }}
                        placeholder={layers.length ? '- select layer -' : 'No workspace layers'}
                    />
                    <p className="text-muted text-sm" style={{ marginTop: 8 }}>
                        Cleanup works on chunked workspace layers from large imports (IndexedDB + optional OPFS source).
                    </p>
                </>
            )}

            {step === 2 && footprint && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                    <div><strong>{footprint.layerName}</strong></div>
                    <div>{footprint.featureCount.toLocaleString()} features{footprint.tiled ? ' · tiled render' : ''}</div>
                    <div>{footprint.hotFieldCount} hot fields · {footprint.coldFieldCount} cold fields</div>
                    <div>
                        Source: {footprint.sourcePreserved
                            ? `${footprint.sourceName || 'preserved'} (${formatBytes(footprint.sourceSize)})`
                            : 'not preserved in OPFS'}
                    </div>
                    {footprint.storageQuota > 0 && (
                        <div>
                            Browser storage: {formatBytes(footprint.storageUsage)} / {formatBytes(footprint.storageQuota)}
                            <div className="gis-widget__progress" style={{ marginTop: 4 }}>
                                <div
                                    className="gis-widget__progress-bar"
                                    style={{ width: `${Math.min(100, Math.round(footprint.usageRatio * 100))}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {typeof onOpenStorageManager === 'function' && (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenStorageManager()}>
                            Manage all preserved sources…
                        </button>
                    )}
                </div>
            )}

            {step === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                        <label style={{ fontWeight: 600 }}>Detach fields for export</label>
                        <p className="text-muted text-sm">Moves selected fields to cold storage (export still includes them).</p>
                        <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', padding: 8, borderRadius: 4 }}>
                            {detachable.length === 0 && (
                                <div className="text-muted text-sm">No detachable hot fields.</div>
                            )}
                            {detachable.map((name) => (
                                <label key={name} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                                    <input
                                        type="checkbox"
                                        checked={detachFields.includes(name)}
                                        onChange={() => toggleField(name)}
                                    />
                                    {name}
                                </label>
                            ))}
                        </div>
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type="checkbox"
                            checked={removeLayer}
                            onChange={(e) => {
                                setRemoveLayer(e.target.checked);
                                if (!e.target.checked) setDeleteSource(false);
                            }}
                        />
                        Remove layer from map / workspace
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type="checkbox"
                            checked={deleteSource}
                            disabled={!removeLayer || !layer?.opfsKey}
                            onChange={(e) => setDeleteSource(e.target.checked)}
                        />
                        Delete preserved source file (if unreferenced)
                    </label>
                </div>
            )}

            {step === 4 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                    <div>Layer: <strong>{layer?.name}</strong></div>
                    {detachFields.length > 0 && <div>Detach {detachFields.length} field(s): {detachFields.join(', ')}</div>}
                    {removeLayer && <div>Remove layer from workspace</div>}
                    {deleteSource && <div>Delete preserved OPFS source</div>}
                    {result && (
                        <div style={{ marginTop: 8, color: 'var(--success, #2a7)' }}>
                            Done
                            {result.detached ? ` · detached ${result.detached} field(s)` : ''}
                            {result.removedLayer ? ' · layer removed' : ''}
                            {result.deletedSource ? ' · source deleted' : ''}
                        </div>
                    )}
                </div>
            )}

            {error && <div className="text-danger" style={{ marginTop: 8, fontSize: 13 }}>{error}</div>}
            {status && !error && <div className="text-muted" style={{ marginTop: 8, fontSize: 13 }}>{status}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={running}>
                    {result ? 'Close' : 'Cancel'}
                </button>
                {step > 1 && step < 4 && !result && (
                    <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={running}>
                        Back
                    </button>
                )}
                {step < 4 && (
                    <button type="button" className="btn btn-primary" onClick={goNext} disabled={running || !layers.length}>
                        {running && step === 1 ? 'Loading…' : 'Next'}
                    </button>
                )}
                {step === 4 && !result && (
                    <button type="button" className="btn btn-primary" onClick={runCleanup} disabled={running}>
                        {running ? 'Working…' : 'Run cleanup'}
                    </button>
                )}
            </div>
        </WidgetPanelShell>
    );
}

export default LargeDatasetCleanupDialog;
