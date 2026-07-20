import { useState } from 'react';

export function AtlasImportDialog({ open, onClose, onImport, busy }) {
    const [workbook, setWorkbook] = useState(null);
    const [atms, setAtms] = useState(null);
    const [error, setError] = useState('');

    if (!open) return null;

    const submit = async () => {
        setError('');
        if (!workbook && !atms) {
            setError('Select a FiberSwitchLocation workbook and/or ATMS CSV.');
            return;
        }
        try {
            await onImport?.({ workbookFile: workbook, atmsFile: atms });
            setWorkbook(null);
            setAtms(null);
            onClose?.();
        } catch (err) {
            setError(err?.message || String(err));
        }
    };

    return (
        <div className="atlas-modal-backdrop" role="presentation" onClick={onClose}>
            <div className="atlas-modal" role="dialog" aria-labelledby="atlas-import-title" onClick={(e) => e.stopPropagation()}>
                <h2 id="atlas-import-title">Atlas Import</h2>
                <p className="atlas-muted">Import FiberSwitchLocation workbook and ATMS Master Device List (switches).</p>
                <label className="atlas-file-label">
                    FiberSwitchLocation (.xlsx)
                    <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) => setWorkbook(e.target.files?.[0] || null)}
                    />
                </label>
                <label className="atlas-file-label">
                    ATMS Master Device List (.csv)
                    <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={(e) => setAtms(e.target.files?.[0] || null)}
                    />
                </label>
                {error && <p className="atlas-error">{error}</p>}
                <div className="atlas-modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                        {busy ? 'Importing…' : 'Import'}
                    </button>
                </div>
            </div>
        </div>
    );
}
