import { useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { formatByteSize } from '../../js/widgets/geojson-file-summary/engine.js';

export function GeoJsonFileSummaryDialog({
    onCancel,
    onPickFile,
    onRun,
    onReveal
}) {
    const [path, setPath] = useState('');
    const [fileName, setFileName] = useState('');
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('Desktop-only: uses the packaged Python sidecar.');

    const pickFile = async () => {
        setError('');
        setMessage('');
        try {
            const picked = await onPickFile?.();
            if (!picked || picked.canceled) return;
            setPath(picked.path || '');
            setFileName(picked.fileName || picked.path || '');
            setResult(null);
            setProgress(null);
            setMessage('File selected. Run summary to analyze.');
        } catch (err) {
            setError(err?.message || 'Unable to open file dialog.');
        }
    };

    const runSummary = async () => {
        setError('');
        setMessage('');
        setRunning(true);
        setProgress({ percent: 0, stage: 'starting', message: 'Starting…' });
        try {
            const output = await onRun?.({
                path,
                onProgress: (p) => setProgress(p || null)
            });
            setResult(output || null);
            setMessage('Summary complete.');
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
                onRun={() => onReveal?.(result.path)}
                runLabel="Reveal in Explorer"
                cancelLabel="Done"
                disabled={!result.path}
                status={message}
            >
                <div className="text-sm" style={{ display: 'grid', gap: 10 }}>
                    <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>File</div>
                        <div style={{ wordBreak: 'break-all' }}>{result.path || fileName}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Stat label="Features" value={String(result.featureCount)} />
                        <Stat label="Size" value={formatByteSize(result.byteSize)} />
                        <Stat label="Root type" value={String(result.rootType)} />
                        <Stat label="Property fields" value={String(result.propertyKeys?.length || 0)} />
                    </div>
                    <div>
                        <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Geometry types</div>
                        {(result.geometryTypeEntries || []).length ? (
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {result.geometryTypeEntries.map((entry) => (
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
            disabled={!path || running}
            status={error || message}
            statusTone={error ? 'danger' : 'muted'}
        >
            <div className="text-sm" style={{ display: 'grid', gap: 12 }}>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    Pick a local GeoJSON file. Analysis runs in the Windows Python sidecar
                    and never loads the full file into the web UI.
                </p>
                <div>
                    <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={pickFile}
                        disabled={running}
                    >
                        Choose GeoJSON file…
                    </button>
                </div>
                {fileName ? (
                    <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Selected</div>
                        <div style={{ wordBreak: 'break-all' }}>{fileName}</div>
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
