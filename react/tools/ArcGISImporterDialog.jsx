import { useRef, useState } from 'react';

function presetButtonLabel(state) {
    if (state === 'loading') return 'Loading...';
    if (state === 'done') return '✅ Done';
    return 'Import';
}

export function ArcGISImporterDialog({
    endpoints = [],
    hasImportFence = false,
    onCancel,
    onImport
}) {
    const [customUrl, setCustomUrl] = useState('');
    const [customLoading, setCustomLoading] = useState(false);
    const [progressVisible, setProgressVisible] = useState(false);
    const [progressText, setProgressText] = useState('Starting download...');
    const [progressPercent, setProgressPercent] = useState(0);
    const [presetStates, setPresetStates] = useState(() =>
        Object.fromEntries(endpoints.map((endpoint) => [endpoint.url, 'idle']))
    );
    const [isImporting, setIsImporting] = useState(false);
    const cancelImportRef = useRef(null);

    const setPresetState = (url, state) => {
        setPresetStates((current) => ({ ...current, [url]: state }));
    };

    const startImport = (url, name, mode) => {
        if (isImporting) return;
        setIsImporting(true);
        setProgressVisible(true);
        setProgressPercent(0);
        setProgressText(`Connecting to ${name || 'layer'}...`);

        if (mode === 'custom') {
            setCustomLoading(true);
        } else {
            setPresetState(url, 'loading');
        }

        const finishIdle = () => {
            setIsImporting(false);
            setProgressVisible(false);
            setCustomLoading(false);
            cancelImportRef.current = null;
            if (mode !== 'custom') {
                setPresetState(url, 'idle');
            }
        };

        try {
            const maybeCancel = onImport?.({
                url,
                name,
                mode,
                onProgress: ({ percent = 0, step = '' } = {}) => {
                    setProgressPercent(Math.max(0, Math.min(100, percent)));
                    if (step) setProgressText(step);
                },
                onComplete: () => {
                    setIsImporting(false);
                    setProgressVisible(false);
                    setCustomLoading(false);
                    cancelImportRef.current = null;
                    if (mode !== 'custom') {
                        setPresetState(url, 'done');
                    }
                },
                onCancelled: () => {
                    finishIdle();
                },
                onError: () => {
                    finishIdle();
                }
            });

            Promise.resolve(maybeCancel)
                .then((cancelFn) => {
                    cancelImportRef.current = typeof cancelFn === 'function' ? cancelFn : null;
                })
                .catch(() => {
                    finishIdle();
                });
        } catch (_) {
            finishIdle();
        }
    };

    return (
        <div>
            {hasImportFence ? (
                <div className="success-box text-xs mb-8" style={{ padding: '6px 10px' }}>
                    ⛶ <strong>Import Fence active</strong> — only features inside the fence will be downloaded from the server.
                </div>
            ) : null}
            <div className="info-box text-xs mb-8">
                Select a layer from the list below or enter a custom ArcGIS REST URL. Only publicly accessible layers are supported (no login required). Colors and labels from the published ArcGIS renderer are applied when available.
            </div>

            <div style={{ maxHeight: '45vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }} id="arcgis-preset-list-react">
                {endpoints.map((endpoint) => {
                    const state = presetStates[endpoint.url] || 'idle';
                    const disabled = state === 'done' || isImporting;
                    const isDone = state === 'done';
                    return (
                        <div
                            key={endpoint.url}
                            className="arcgis-preset-item"
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-surface)' }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{endpoint.name}</div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={endpoint.url}>{endpoint.url}</div>
                            </div>
                            <button
                                className={`btn btn-sm ${isDone ? 'btn-secondary' : 'btn-primary'} arcgis-import-btn`}
                                style={{ flexShrink: 0 }}
                                disabled={disabled}
                                onClick={() => startImport(endpoint.url, endpoint.name, 'preset')}
                            >
                                {presetButtonLabel(state)}
                            </button>
                        </div>
                    );
                })}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                <div className="form-group" style={{ marginBottom: '8px' }}>
                    <label style={{ fontWeight: 600, fontSize: '13px' }}>Custom URL</label>
                    <input
                        type="url"
                        id="arcgis-custom-url-react"
                        placeholder="https://services.arcgis.com/.../FeatureServer/0"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        disabled={isImporting}
                    />
                </div>
                <button
                    className="btn btn-primary"
                    id="arcgis-custom-import-react"
                    disabled={isImporting || customLoading}
                    onClick={() => startImport(customUrl.trim(), 'Custom Layer', 'custom')}
                >
                    {customLoading ? 'Loading...' : 'Import from URL'}
                </button>
            </div>

            {progressVisible ? (
                <div id="arcgis-progress-react" className="mt-8">
                    <div style={{ textAlign: 'center' }}>
                        <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
                        <div id="arcgis-progress-text-react">{progressText}</div>
                        <div className="progress-bar-container mt-8">
                            <div className="progress-bar-fill" id="arcgis-progress-bar-react" style={{ width: `${progressPercent}%` }}></div>
                            <div className="progress-bar-text" id="arcgis-progress-pct-react">{Math.round(progressPercent)}%</div>
                        </div>
                        <button
                            className="btn btn-secondary btn-sm mt-8"
                            id="arcgis-cancel-react"
                            onClick={() => cancelImportRef.current?.()}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="modal-footer">
                <button className="btn btn-secondary cancel-btn" onClick={() => onCancel?.()}>Close</button>
            </div>
        </div>
    );
}
