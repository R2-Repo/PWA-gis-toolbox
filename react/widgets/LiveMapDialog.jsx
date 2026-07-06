import { useCallback, useMemo, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';

function FieldRow({ label, children }) {
    return (
        <label className="live-map-dialog__field">
            <span className="live-map-dialog__label">{label}</span>
            {children}
        </label>
    );
}

function TabButton({ active, children, onClick }) {
    return (
        <button
            type="button"
            className={`live-map-dialog__tab${active ? ' live-map-dialog__tab--active' : ''}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function LiveMapDialog({
    presets = [],
    initialForm,
    onCancel,
    onCaptureView,
    onBuildUrl,
    onAddToMap,
    onCopyUrl,
    onCopyCatalogEntry,
    onValidateCustom
}) {
    const [form, setForm] = useState(initialForm);
    const [status, setStatus] = useState('');
    const [running, setRunning] = useState(false);

    const previewUrl = useMemo(() => onBuildUrl?.(form) || '', [form, onBuildUrl]);

    const update = useCallback((patch) => {
        setForm((prev) => ({ ...prev, ...patch }));
        setStatus('');
    }, []);

    const addCustomUrlRow = () => {
        update({ customUrls: [...form.customUrls, ''] });
    };

    const updateCustomUrl = (index, value) => {
        const next = [...form.customUrls];
        next[index] = value;
        update({ customUrls: next });
    };

    const removeCustomUrl = (index) => {
        const next = form.customUrls.filter((_, i) => i !== index);
        update({ customUrls: next.length ? next : [''] });
    };

    const handleCaptureView = () => {
        const captured = onCaptureView?.(form);
        if (captured) setForm(captured);
        setStatus('Captured current map view.');
    };

    const handleAction = async (action) => {
        setRunning(true);
        setStatus('');
        try {
            if (form.tab === 'custom') {
                const errors = onValidateCustom?.(form.customUrls) || [];
                if (errors.length) {
                    setStatus(errors[0]);
                    return;
                }
            }
            await action();
        } catch (error) {
            setStatus(error?.message || 'Action failed');
        } finally {
            setRunning(false);
        }
    };

    const footer = (
        <div className="live-map-dialog__footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={running}>
                Cancel
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => handleAction(() => onCopyCatalogEntry?.(form))} disabled={running}>
                Copy catalog entry
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => handleAction(() => onCopyUrl?.(form))} disabled={running}>
                Copy URL
            </button>
            <button type="button" className="btn btn-primary" onClick={() => handleAction(() => onAddToMap?.(form))} disabled={running}>
                {running ? 'Adding…' : 'Add to map'}
            </button>
        </div>
    );

    return (
        <WidgetPanelShell
            className="live-map-dialog"
            status={status}
            statusTone={status ? 'danger' : 'muted'}
            onCancel={onCancel}
            showRun={false}
            footer={footer}
        >
            <div className="live-map-dialog__tabs">
                <TabButton active={form.tab === 'prebuilt'} onClick={() => update({ tab: 'prebuilt' })}>
                    Prebuilt maps
                </TabButton>
                <TabButton active={form.tab === 'custom'} onClick={() => update({ tab: 'custom' })}>
                    Custom URL
                </TabButton>
            </div>

            {form.tab === 'prebuilt' ? (
                <div className="live-map-dialog__section">
                    <p className="live-map-dialog__hint">
                        Choose a catalog preset. Layers and default view come from the catalog; chrome options below override the preset.
                    </p>
                    <div className="live-map-dialog__preset-grid">
                        {presets.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                className={`live-map-dialog__preset${form.selectedPresetId === preset.id ? ' live-map-dialog__preset--active' : ''}`}
                                onClick={() => update({ selectedPresetId: preset.id })}
                            >
                                <strong>{preset.name}</strong>
                                {preset.description ? <span>{preset.description}</span> : null}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="live-map-dialog__section">
                    <p className="live-map-dialog__hint">
                        Add one or more public service URLs (FeatureServer, MapServer, GeoJSON feed).
                    </p>
                    {form.customUrls.map((url, index) => (
                        <div key={`url-${index}`} className="live-map-dialog__url-row">
                            <input
                                type="url"
                                className="input"
                                placeholder="https://…/FeatureServer/0"
                                value={url}
                                onChange={(e) => updateCustomUrl(index, e.target.value)}
                            />
                            {form.customUrls.length > 1 ? (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeCustomUrl(index)}>
                                    Remove
                                </button>
                            ) : null}
                        </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addCustomUrlRow}>
                        + Add URL
                    </button>
                </div>
            )}

            <div className="live-map-dialog__section">
                <h4 className="live-map-dialog__section-title">Map appearance</h4>
                <div className="live-map-dialog__grid">
                    <FieldRow label="Basemap">
                        <select className="input" value={form.basemap} onChange={(e) => update({ basemap: e.target.value })}>
                            <option value="voyager">Voyager</option>
                            <option value="satellite">Satellite</option>
                        </select>
                    </FieldRow>
                    <FieldRow label="Dimension">
                        <select className="input" value={form.dim} onChange={(e) => update({ dim: e.target.value })}>
                            <option value="2d">2D</option>
                            <option value="3d">3D</option>
                        </select>
                    </FieldRow>
                    <FieldRow label="Panels">
                        <select className="input" value={form.panel} onChange={(e) => update({ panel: e.target.value })}>
                            <option value="both">Both expanded</option>
                            <option value="left">Left only</option>
                            <option value="right">Right only</option>
                            <option value="none">Collapsed</option>
                        </select>
                    </FieldRow>
                </div>
            </div>

            <div className="live-map-dialog__section">
                <div className="live-map-dialog__section-header">
                    <h4 className="live-map-dialog__section-title">View</h4>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCaptureView}>
                        Use current map view
                    </button>
                </div>
                <div className="live-map-dialog__grid">
                    <FieldRow label="Mode">
                        <select className="input" value={form.viewMode} onChange={(e) => update({ viewMode: e.target.value })}>
                            <option value="center">Center + zoom</option>
                            <option value="bounds">Bounds</option>
                        </select>
                    </FieldRow>
                </div>
                {form.viewMode === 'center' ? (
                    <div className="live-map-dialog__grid live-map-dialog__grid--4">
                        <FieldRow label="Zoom">
                            <input type="number" className="input" step="0.1" value={form.zoom} onChange={(e) => update({ zoom: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="Longitude">
                            <input type="number" className="input" step="0.0001" value={form.lng} onChange={(e) => update({ lng: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="Latitude">
                            <input type="number" className="input" step="0.0001" value={form.lat} onChange={(e) => update({ lat: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="Pitch">
                            <input type="number" className="input" step="1" value={form.pitch} onChange={(e) => update({ pitch: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="Heading">
                            <input type="number" className="input" step="1" value={form.bearing} onChange={(e) => update({ bearing: e.target.value })} />
                        </FieldRow>
                    </div>
                ) : (
                    <div className="live-map-dialog__grid live-map-dialog__grid--4">
                        <FieldRow label="West">
                            <input type="number" className="input" step="0.0001" value={form.boundsWest} onChange={(e) => update({ boundsWest: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="South">
                            <input type="number" className="input" step="0.0001" value={form.boundsSouth} onChange={(e) => update({ boundsSouth: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="East">
                            <input type="number" className="input" step="0.0001" value={form.boundsEast} onChange={(e) => update({ boundsEast: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="North">
                            <input type="number" className="input" step="0.0001" value={form.boundsNorth} onChange={(e) => update({ boundsNorth: e.target.value })} />
                        </FieldRow>
                        <FieldRow label="Padding (px)">
                            <input type="number" className="input" step="1" value={form.padding} onChange={(e) => update({ padding: e.target.value })} />
                        </FieldRow>
                    </div>
                )}
            </div>

            <div className="live-map-dialog__section">
                <h4 className="live-map-dialog__section-title">URL preview</h4>
                <textarea className="input live-map-dialog__preview" readOnly rows={3} value={previewUrl} />
            </div>
        </WidgetPanelShell>
    );
}
