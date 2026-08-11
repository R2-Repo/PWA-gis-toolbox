import { useEffect, useRef, useState } from 'react';
import { ImportFieldSelector } from './ImportFieldSelector.jsx';
import { ImportProgressPanel } from './ImportProgressPanel.jsx';

export function ImportFieldPickerDialog({
    fields = [],
    onCancel,
    onConfirm,
    /** When set, Continue runs this instead of closing — dialog shows progress until done. */
    onImport = null
}) {
    const [selectedFields, setSelectedFields] = useState(() => [...fields]);
    const [error, setError] = useState('');
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ percent: 0, step: 'Starting import…' });
    const cancelImportRef = useRef(null);

    useEffect(() => {
        setSelectedFields([...fields]);
    }, [fields]);

    const handleContinue = async () => {
        if (fields.length > 0 && selectedFields.length === 0) {
            setError('Select at least one field.');
            return;
        }
        setError('');

        if (typeof onImport === 'function') {
            setImporting(true);
            setImportProgress({ percent: 0, step: 'Starting import…' });
            try {
                await onImport(selectedFields, {
                    onProgress: (p) => setImportProgress(p),
                    onCancelReady: (fn) => { cancelImportRef.current = fn; },
                    close: () => onCancel?.()
                });
            } catch (err) {
                if (err?.cancelled) {
                    onCancel?.();
                    return;
                }
                setImporting(false);
                setError(err?.message || 'Import failed.');
            }
            return;
        }

        onConfirm?.(selectedFields);
    };

    if (importing) {
        return (
            <ImportProgressPanel
                step={importProgress.step}
                percent={importProgress.percent}
                fileName={importProgress.fileName}
                onCancel={cancelImportRef.current ? () => cancelImportRef.current?.() : null}
            />
        );
    }

    return (
        <div>
            {error ? (
                <div className="info-box text-xs mb-8" style={{ color: 'var(--danger)' }}>{error}</div>
            ) : null}
            <ImportFieldSelector
                fields={fields}
                selected={selectedFields}
                onChange={setSelectedFields}
            />
            <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => onCancel?.()}>Cancel</button>
                <button className="btn btn-primary" onClick={() => void handleContinue()}>
                    Continue
                </button>
            </div>
        </div>
    );
}
