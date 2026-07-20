import { useCallback, useEffect, useState } from 'react';
import {
    ensureAtlasImportInbox,
    openAtlasImportInbox,
    scanAtlasImportInbox
} from '../../js/atlas/import/inbox.js';
import { previewAtlasImport, runAtlasImport } from '../../js/atlas/controller.js';

/**
 * Dedicated Atlas import (not GIS map import).
 * Preferred path: drop files in the Atlas import inbox folder → scan → review → apply (replaces DB).
 */
export function AtlasImportDialog({ open, onClose, busy: busyProp, onImported }) {
    const [inboxPath, setInboxPath] = useState('');
    const [workbookPath, setWorkbookPath] = useState('');
    const [atmsPath, setAtmsPath] = useState('');
    const [workbookName, setWorkbookName] = useState('');
    const [atmsName, setAtmsName] = useState('');
    const [filePickerWorkbook, setFilePickerWorkbook] = useState(null);
    const [filePickerAtms, setFilePickerAtms] = useState(null);
    const [summary, setSummary] = useState(null);
    const [payload, setPayload] = useState(null);
    const [error, setError] = useState('');
    const [busyLocal, setBusyLocal] = useState(false);
    const busy = busyProp || busyLocal;

    const resetReview = () => {
        setSummary(null);
        setPayload(null);
    };

    useEffect(() => {
        if (!open) return;
        setError('');
        resetReview();
        void ensureAtlasImportInbox()
            .then((path) => setInboxPath(path))
            .catch(() => setInboxPath(''));
    }, [open]);

    const onScan = useCallback(async () => {
        setError('');
        resetReview();
        setBusyLocal(true);
        try {
            const scan = await scanAtlasImportInbox();
            setInboxPath(scan.inboxPath || '');
            setWorkbookPath(scan.workbook?.path || '');
            setWorkbookName(scan.workbook?.name || '');
            setAtmsPath(scan.atms?.path || '');
            setAtmsName(scan.atms?.name || '');
            setFilePickerWorkbook(null);
            setFilePickerAtms(null);
            if (!scan.workbook && !scan.atms) {
                setError('No FiberSwitchLocation workbook or ATMS CSV found in the import folder.');
            }
        } catch (err) {
            setError(err?.message || String(err));
        } finally {
            setBusyLocal(false);
        }
    }, []);

    const buildInput = () => {
        if (filePickerWorkbook || filePickerAtms) {
            return { workbookFile: filePickerWorkbook, atmsFile: filePickerAtms };
        }
        return {
            workbookPath: workbookPath || undefined,
            atmsPath: atmsPath || undefined
        };
    };

    const onReview = async () => {
        setError('');
        setBusyLocal(true);
        try {
            const result = await previewAtlasImport(buildInput());
            setSummary(result.summary);
            setPayload(result.payload);
        } catch (err) {
            setError(err?.message || String(err));
            resetReview();
        } finally {
            setBusyLocal(false);
        }
    };

    const onApply = async () => {
        setError('');
        setBusyLocal(true);
        try {
            const applied = await runAtlasImport(payload ? { payload } : buildInput());
            onImported?.(applied);
            setFilePickerWorkbook(null);
            setFilePickerAtms(null);
            resetReview();
            onClose?.();
        } catch (err) {
            setError(err?.message || String(err));
        } finally {
            setBusyLocal(false);
        }
    };

    if (!open) return null;

    const counts = summary?.counts;

    return (
        <div className="atlas-modal-backdrop" role="presentation" onClick={onClose}>
            <div
                className="atlas-modal atlas-modal--wide"
                role="dialog"
                aria-labelledby="atlas-import-title"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id="atlas-import-title">Atlas Import</h2>
                <p className="atlas-muted">
                    Separate from GIS map import. Place exports in the Atlas import folder, scan, review, then apply.
                    <strong> Apply replaces</strong> the current Atlas network database.
                </p>

                <section className="atlas-import-section">
                    <h3>1. Import folder</h3>
                    <p className="atlas-mono atlas-muted">{inboxPath || 'Desktop only — open Network Atlas in the Windows app.'}</p>
                    <div className="atlas-toolbar">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => void openAtlasImportInbox().catch((err) => setError(err?.message || String(err)))}
                        >
                            Open folder
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onScan()}>
                            Scan folder
                        </button>
                    </div>
                    <ul className="atlas-import-detected">
                        <li>
                            <strong>Workbook:</strong> {workbookName || '—'}
                        </li>
                        <li>
                            <strong>ATMS CSV:</strong> {atmsName || '—'}
                        </li>
                    </ul>
                </section>

                <section className="atlas-import-section">
                    <h3>2. Or pick files manually</h3>
                    <label className="atlas-file-label">
                        FiberSwitchLocation (.xlsx)
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            disabled={busy}
                            onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                setFilePickerWorkbook(f);
                                if (f) {
                                    setWorkbookName(f.name);
                                    setWorkbookPath('');
                                }
                                resetReview();
                            }}
                        />
                    </label>
                    <label className="atlas-file-label">
                        ATMS Master Device List (.csv)
                        <input
                            type="file"
                            accept=".csv,.txt"
                            disabled={busy}
                            onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                setFilePickerAtms(f);
                                if (f) {
                                    setAtmsName(f.name);
                                    setAtmsPath('');
                                }
                                resetReview();
                            }}
                        />
                    </label>
                </section>

                <section className="atlas-import-section">
                    <h3>3. Review &amp; apply</h3>
                    <div className="atlas-toolbar">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onReview()}>
                            Review
                        </button>
                    </div>
                    {counts && (
                        <div className="atlas-import-summary">
                            <p>
                                Ready to replace Atlas DB from{' '}
                                <strong>{summary.workbookName || '—'}</strong>
                                {' + '}
                                <strong>{summary.atmsName || '—'}</strong>
                            </p>
                            <ul>
                                <li>TMD sites: {counts.tmd}</li>
                                <li>SwitchFiber: {counts.switchFiber}</li>
                                <li>ATMS switches: {counts.atmsSwitches}</li>
                                <li>Hubs / channels / drops / devices: {counts.hubs} / {counts.channels} / {counts.drops} / {counts.devices}</li>
                                <li>Findings: {counts.findings}</li>
                            </ul>
                        </div>
                    )}
                </section>

                {error && <p className="atlas-error">{error}</p>}

                <div className="atlas-modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void onApply()}
                        disabled={busy || !payload}
                        title={!payload ? 'Run Review first' : 'Replace Atlas database'}
                    >
                        {busy ? 'Working…' : 'Apply (replace DB)'}
                    </button>
                </div>
            </div>
        </div>
    );
}
