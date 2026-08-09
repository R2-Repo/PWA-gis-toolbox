import { useCallback, useEffect, useState } from 'react';

export function StorageManagerDialog({
    onClose,
    onLoad,
    onRemove,
    onRemoveUnreferenced,
    formatBytes = (n) => String(n)
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [quota, setQuota] = useState(null);
    const [sources, setSources] = useState([]);
    const [busyKey, setBusyKey] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await onLoad?.();
            setQuota(data?.quota || null);
            setSources(data?.sources || []);
        } catch (e) {
            setError(e?.message || 'Could not load storage info.');
        } finally {
            setLoading(false);
        }
    }, [onLoad]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleRemove = async (key, referenced) => {
        setBusyKey(key);
        setError('');
        try {
            await onRemove?.(key, { force: !referenced ? false : true, referenced });
            await refresh();
        } catch (e) {
            setError(e?.message || 'Remove failed.');
        } finally {
            setBusyKey(null);
        }
    };

    const handleRemoveUnreferenced = async () => {
        setBusyKey('__bulk__');
        setError('');
        try {
            await onRemoveUnreferenced?.();
            await refresh();
        } catch (e) {
            setError(e?.message || 'Cleanup failed.');
        } finally {
            setBusyKey(null);
        }
    };

    const unsupported = quota && quota.supported === false;
    const orphanCount = sources.filter((s) => !s.referenced).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="text-muted text-sm" style={{ margin: 0 }}>
                Original files preserved during high-capacity import (OPFS). Removing a source does not delete map layers unless you also remove those layers.
            </p>

            {loading && <div className="text-muted">Loading…</div>}
            {error && <div className="text-danger" style={{ fontSize: 13 }}>{error}</div>}

            {!loading && unsupported && (
                <div className="text-muted" style={{ fontSize: 13 }}>
                    Preserved-source storage is not available in this browser (OPFS writable streams required).
                </div>
            )}

            {!loading && quota?.quota > 0 && (
                <div style={{ fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Browser storage</span>
                        <span>{formatBytes(quota.usage)} / {formatBytes(quota.quota)}</span>
                    </div>
                    <div className="gis-widget__progress" style={{ marginTop: 4 }}>
                        <div
                            className="gis-widget__progress-bar"
                            style={{ width: `${Math.min(100, Math.round((quota.usageRatio || 0) * 100))}%` }}
                        />
                    </div>
                </div>
            )}

            {!loading && !unsupported && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 13 }}>
                            {sources.length} preserved source{sources.length === 1 ? '' : 's'}
                        </strong>
                        <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            disabled={!orphanCount || busyKey != null}
                            onClick={handleRemoveUnreferenced}
                        >
                            Remove unreferenced ({orphanCount})
                        </button>
                    </div>
                    {sources.length === 0 ? (
                        <div className="text-muted text-sm">No preserved source files.</div>
                    ) : (
                        <div style={{ maxHeight: 280, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {sources.map((source) => (
                                <div
                                    key={source.key}
                                    style={{
                                        border: '1px solid var(--border)',
                                        borderRadius: 4,
                                        padding: 8,
                                        fontSize: 12
                                    }}
                                >
                                    <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{source.name}</div>
                                    <div className="text-muted">
                                        {formatBytes(source.size)}
                                        {source.referenced
                                            ? ` · used by ${source.layerNames.join(', ')}`
                                            : ' · unreferenced'}
                                    </div>
                                    <div style={{ marginTop: 6 }}>
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-secondary"
                                            disabled={busyKey != null}
                                            onClick={() => handleRemove(source.key, source.referenced)}
                                        >
                                            {busyKey === source.key ? 'Removing…' : (source.referenced ? 'Force remove' : 'Remove')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
            </div>
        </div>
    );
}

export default StorageManagerDialog;
