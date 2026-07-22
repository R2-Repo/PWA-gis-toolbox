import { useCallback, useEffect, useState } from 'react';
import {
    ensureAtlasImportInbox,
    openAtlasImportInbox,
    scanAtlasImportInbox
} from '../../js/atlas/import/inbox.js';
import { previewAtlasImport, runAtlasImport } from '../../js/atlas/controller.js';
import { countFindingsByType, exportImportDiffCsv } from '../../js/atlas/export.js';

/**
 * Dedicated Atlas import (not GIS map import).
 * Preferred path: drop files in the Atlas import inbox folder → scan → review → apply (replaces DB).
 */
export function AtlasImportDialog({ open, onClose, busy: busyProp, onImported }) {
    const [inboxPath, setInboxPath] = useState('');
    const [workbookPath, setWorkbookPath] = useState('');
    const [atmsPath, setAtmsPath] = useState('');
    const [hubListPath, setHubListPath] = useState('');
    const [connectedBuildingsPath, setConnectedBuildingsPath] = useState('');
    const [workbookName, setWorkbookName] = useState('');
    const [atmsName, setAtmsName] = useState('');
    const [hubListName, setHubListName] = useState('');
    const [connectedBuildingsName, setConnectedBuildingsName] = useState('');
    const [filePickerWorkbook, setFilePickerWorkbook] = useState(null);
    const [filePickerAtms, setFilePickerAtms] = useState(null);
    const [filePickerHubList, setFilePickerHubList] = useState(null);
    const [filePickerConnectedBuildings, setFilePickerConnectedBuildings] = useState(null);
    const [summary, setSummary] = useState(null);
    const [payload, setPayload] = useState(null);
    const [diff, setDiff] = useState(null);
    const [showDiffLists, setShowDiffLists] = useState(false);
    const [error, setError] = useState('');
    const [busyLocal, setBusyLocal] = useState(false);
    const busy = busyProp || busyLocal;

    const resetReview = () => {
        setSummary(null);
        setPayload(null);
        setDiff(null);
        setShowDiffLists(false);
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
            setHubListPath(scan.hubList?.path || '');
            setHubListName(scan.hubList?.name || '');
            setConnectedBuildingsPath(scan.connectedBuildings?.path || '');
            setConnectedBuildingsName(scan.connectedBuildings?.name || '');
            setFilePickerWorkbook(null);
            setFilePickerAtms(null);
            setFilePickerHubList(null);
            setFilePickerConnectedBuildings(null);
            if (!scan.workbook && !scan.atms && !scan.hubList && !scan.connectedBuildings) {
                setError('No FiberSwitchLocation workbook, ATMS CSV, Hub List, or Connected Buildings found in the import folder.');
            }
        } catch (err) {
            setError(err?.message || String(err));
        } finally {
            setBusyLocal(false);
        }
    }, []);

    const buildInput = () => {
        if (filePickerWorkbook || filePickerAtms || filePickerHubList || filePickerConnectedBuildings) {
            return {
                workbookFile: filePickerWorkbook,
                atmsFile: filePickerAtms,
                hubListFile: filePickerHubList,
                connectedBuildingsFile: filePickerConnectedBuildings
            };
        }
        return {
            workbookPath: workbookPath || undefined,
            atmsPath: atmsPath || undefined,
            hubListPath: hubListPath || undefined,
            connectedBuildingsPath: connectedBuildingsPath || undefined
        };
    };

    const onReview = async () => {
        setError('');
        setBusyLocal(true);
        try {
            const result = await previewAtlasImport(buildInput());
            setSummary(result.summary);
            setPayload(result.payload);
            setDiff(result.diff || result.summary?.diffDetails || null);
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
            setFilePickerHubList(null);
            setFilePickerConnectedBuildings(null);
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
                        <li>
                            <strong>Hub List:</strong> {hubListName || '— (optional)'}
                        </li>
                        <li>
                            <strong>Connected Buildings:</strong> {connectedBuildingsName || '— (optional)'}
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
                    <label className="atlas-file-label">
                        Hub List (.csv, optional)
                        <input
                            type="file"
                            accept=".csv,.txt"
                            disabled={busy}
                            onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                setFilePickerHubList(f);
                                if (f) {
                                    setHubListName(f.name);
                                    setHubListPath('');
                                }
                                resetReview();
                            }}
                        />
                    </label>
                    <label className="atlas-file-label">
                        Connected Buildings (.csv, optional)
                        <input
                            type="file"
                            accept=".csv,.txt"
                            disabled={busy}
                            onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                setFilePickerConnectedBuildings(f);
                                if (f) {
                                    setConnectedBuildingsName(f.name);
                                    setConnectedBuildingsPath('');
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
                                Ready to replace Atlas network tables from{' '}
                                <strong>{summary.workbookName || '—'}</strong>
                                {' + '}
                                <strong>{summary.atmsName || '—'}</strong>
                                {summary.hubListName ? (
                                    <>
                                        {' + '}
                                        <strong>{summary.hubListName}</strong>
                                    </>
                                ) : null}
                                {summary.connectedBuildingsName ? (
                                    <>
                                        {' + '}
                                        <strong>{summary.connectedBuildingsName}</strong>
                                    </>
                                ) : null}
                            </p>
                            <p className="atlas-muted">Ping history is kept (matched by IP). Findings are rebuilt.</p>
                            <ul>
                                <li>TMD sites: {counts.tmd}</li>
                                <li>SwitchFiber: {counts.switchFiber}</li>
                                <li>ATMS switches: {counts.atmsSwitches}</li>
                                <li>
                                    Hubs: {counts.hubs}
                                    {counts.hubsOfficial != null || counts.hubsInferred != null
                                        ? ` (${counts.hubsOfficial ?? 0} official · ${counts.hubsInferred ?? 0} inferred)`
                                        : ''}
                                    {' / '}channels / drops / devices: {counts.channels} / {counts.drops} / {counts.devices}
                                </li>
                                <li>Connected buildings: {counts.connectedBuildings ?? 0}</li>
                                <li>Findings: {counts.findings}</li>
                            </ul>
                            {!!payload?.findings?.length && (
                                <div className="atlas-import-findings-by-type">
                                    <strong>Findings by type</strong>
                                    <ul>
                                        {countFindingsByType(payload.findings, { openOnly: false }).map((row) => (
                                            <li key={row.type}>{row.type}: {row.count}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {summary.diff && !diff?.emptyCurrent && (
                                <div className="atlas-import-diff">
                                    <strong>Compared to current DB</strong>
                                    <ul>
                                        <li>New IPs: {summary.diff.newIps}</li>
                                        <li>Missing IPs: {summary.diff.missingIps}</li>
                                        <li>Changed IPs: {summary.diff.changedIps}</li>
                                        <li>New / missing channels: {summary.diff.newChannels} / {summary.diff.missingChannels}</li>
                                        <li>New / missing drops: {summary.diff.newDrops} / {summary.diff.missingDrops}</li>
                                    </ul>
                                    <div className="atlas-toolbar">
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => setShowDiffLists((v) => !v)}
                                        >
                                            {showDiffLists ? 'Hide lists' : 'Show full lists'}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => exportImportDiffCsv(diff)}
                                        >
                                            Export diff CSV
                                        </button>
                                    </div>
                                    {showDiffLists && diff && (
                                        <div className="atlas-diff-lists">
                                            {!!diff.newIps?.length && (
                                                <p><strong>New IPs:</strong> {diff.newIps.join(', ')}</p>
                                            )}
                                            {!!diff.missingIps?.length && (
                                                <p><strong>Missing IPs:</strong> {diff.missingIps.join(', ')}</p>
                                            )}
                                            {!!diff.changedIpDetails?.length && (
                                                <div>
                                                    <p><strong>Changed IPs:</strong></p>
                                                    <ul className="atlas-simple-list">
                                                        {diff.changedIpDetails.map((row) => (
                                                            <li key={row.ip}>
                                                                <span className="atlas-mono">{row.ip}</span>
                                                                <ul className="atlas-simple-list">
                                                                    {row.changes.map((c) => (
                                                                        <li key={`${row.ip}-${c.field}`} className="atlas-muted">
                                                                            {c.field}: {c.from || '—'} → {c.to || '—'}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                            {!diff.changedIpDetails?.length && !!diff.changedIps?.length && (
                                                <p><strong>Changed IPs:</strong> {diff.changedIps.join(', ')}</p>
                                            )}
                                            {!!diff.newChannels?.length && (
                                                <p><strong>New channels:</strong> {diff.newChannels.join(', ')}</p>
                                            )}
                                            {!!diff.missingChannels?.length && (
                                                <p><strong>Missing channels:</strong> {diff.missingChannels.join(', ')}</p>
                                            )}
                                            {!!diff.newDrops?.length && (
                                                <p><strong>New drops:</strong> {diff.newDrops.join(', ')}</p>
                                            )}
                                            {!!diff.missingDrops?.length && (
                                                <p><strong>Missing drops:</strong> {diff.missingDrops.join(', ')}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            {diff?.emptyCurrent && (
                                <p className="atlas-muted">No existing Atlas data — this will be the first load.</p>
                            )}
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
