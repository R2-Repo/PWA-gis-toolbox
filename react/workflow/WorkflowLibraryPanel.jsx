import React, { useCallback, useEffect, useState } from 'react';

export function WorkflowLibraryPanel({ controller, open, onClose }) {
    const [graphs, setGraphs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [versions, setVersions] = useState([]);
    const [saveName, setSaveName] = useState('');
    const [busy, setBusy] = useState(false);

    const refreshList = useCallback(async () => {
        setLoading(true);
        try {
            const list = await controller.listSavedWorkflows();
            setGraphs(list);
        } finally {
            setLoading(false);
        }
    }, [controller]);

    useEffect(() => {
        if (!open) return;
        const active = controller.getActiveLibraryGraph?.();
        setSaveName(active?.name || '');
        setSelectedId(active?.id || null);
        void refreshList();
    }, [open, controller, refreshList]);

    useEffect(() => {
        if (!open || !selectedId) {
            setVersions([]);
            return;
        }
        let cancelled = false;
        controller.listWorkflowVersions(selectedId).then((rows) => {
            if (!cancelled) setVersions(rows);
        });
        return () => { cancelled = true; };
    }, [open, selectedId, controller]);

    if (!open) return null;

    const onSave = async (saveAs) => {
        setBusy(true);
        try {
            const id = await controller.saveWorkflowToLibrary(saveName, { saveAs });
            if (id) {
                setSelectedId(id);
                await refreshList();
            }
        } finally {
            setBusy(false);
        }
    };

    const onOpen = async (graphId) => {
        setBusy(true);
        try {
            const ok = await controller.openWorkflowFromLibrary(graphId);
            if (ok) {
                const active = controller.getActiveLibraryGraph?.();
                setSaveName(active?.name || '');
                setSelectedId(active?.id || graphId);
                onClose();
            }
        } finally {
            setBusy(false);
        }
    };

    const onRename = async (graphId) => {
        const current = graphs.find((g) => g.id === graphId);
        const next = window.prompt('Rename workflow', current?.name || '');
        if (next == null || !next.trim()) return;
        setBusy(true);
        try {
            await controller.renameWorkflowInLibrary(graphId, next.trim());
            if (graphId === selectedId) setSaveName(next.trim());
            await refreshList();
        } finally {
            setBusy(false);
        }
    };

    const onDelete = async (graphId) => {
        const current = graphs.find((g) => g.id === graphId);
        if (!window.confirm(`Delete "${current?.name || 'workflow'}"? This cannot be undone.`)) return;
        setBusy(true);
        try {
            await controller.deleteWorkflowFromLibrary(graphId);
            if (selectedId === graphId) setSelectedId(null);
            await refreshList();
        } finally {
            setBusy(false);
        }
    };

    const onDuplicate = async (graphId) => {
        const current = graphs.find((g) => g.id === graphId);
        const name = `${current?.name || 'Workflow'} (copy)`;
        setBusy(true);
        try {
            const id = await controller.duplicateWorkflowInLibrary(graphId, name);
            if (id) {
                setSelectedId(id);
                setSaveName(name);
                await refreshList();
            }
        } finally {
            setBusy(false);
        }
    };

    const onRestoreVersion = async (versionId) => {
        if (!window.confirm('Replace the current canvas with this version? Unsaved changes will be lost.')) return;
        setBusy(true);
        try {
            await controller.restoreWorkflowVersion(versionId);
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="wf-library-backdrop" role="presentation" onClick={onClose}>
            <div
                className="wf-library-panel"
                role="dialog"
                aria-labelledby="wf-library-title"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="wf-library-header">
                    <h2 id="wf-library-title">My workflows</h2>
                    <button type="button" className="wf-topbar-btn" onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                </div>

                <div className="wf-library-save-row">
                    <input
                        type="text"
                        className="wf-library-name-input"
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        placeholder="Workflow name"
                        disabled={busy}
                    />
                    <button type="button" className="wf-topbar-btn" disabled={busy} onClick={() => void onSave(false)}>
                        Save
                    </button>
                    <button type="button" className="wf-topbar-btn" disabled={busy} onClick={() => void onSave(true)}>
                        Save as…
                    </button>
                </div>

                <div className="wf-library-body">
                    <div className="wf-library-list-wrap">
                        <div className="wf-library-section-title">Saved workflows</div>
                        {loading && <div className="wf-library-hint">Loading…</div>}
                        {!loading && graphs.length === 0 && (
                            <div className="wf-library-hint">No saved workflows yet.</div>
                        )}
                        <ul className="wf-library-list">
                            {graphs.map((g) => (
                                <li
                                    key={g.id}
                                    className={`wf-library-item${g.id === selectedId ? ' selected' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className="wf-library-item-main"
                                        onClick={() => setSelectedId(g.id)}
                                    >
                                        <span className="wf-library-item-name">{g.name}</span>
                                        <span className="wf-library-item-meta">
                                            {g.nodeCount} nodes · {new Date(g.updatedAt).toLocaleString()}
                                        </span>
                                    </button>
                                    <div className="wf-library-item-actions">
                                        <button type="button" className="wf-topbar-btn" disabled={busy} onClick={() => void onOpen(g.id)}>Open</button>
                                        <button type="button" className="wf-topbar-btn" disabled={busy} onClick={() => void onRename(g.id)}>Rename</button>
                                        <button type="button" className="wf-topbar-btn" disabled={busy} onClick={() => void onDuplicate(g.id)}>Duplicate</button>
                                        <button type="button" className="wf-topbar-btn wf-library-danger" disabled={busy} onClick={() => void onDelete(g.id)}>Delete</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="wf-library-versions-wrap">
                        <div className="wf-library-section-title">Version history</div>
                        {!selectedId && <div className="wf-library-hint">Select a workflow to see versions.</div>}
                        {selectedId && versions.length === 0 && <div className="wf-library-hint">No versions yet.</div>}
                        <ul className="wf-library-version-list">
                            {versions.map((v) => (
                                <li key={v.id} className="wf-library-version-item">
                                    <div>
                                        <div className="wf-library-version-label">{v.label || 'Saved'}</div>
                                        <div className="wf-library-item-meta">
                                            {v.nodeCount ?? '?'} nodes · {new Date(v.savedAt).toLocaleString()}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="wf-topbar-btn"
                                        disabled={busy}
                                        onClick={() => void onRestoreVersion(v.id)}
                                    >
                                        Restore
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
