import { useEffect, useMemo, useRef, useState } from 'react';
import { scanFilesForImport } from '../../js/import/import-scan.js';
import { mergeScanFieldNames } from '../../js/import/import-field-filter.js';
import { assessImportRouteFromScans } from '../../js/import/import-routing.js';
import {
    buildNoticeForRoute,
    buildImportProgressReductionNotice,
    shouldShowImportProgressNotice
} from '../../js/import/import-size-notices.js';
import {
    hasActiveFeatureFilter,
    validateFeatureFilter
} from '../../js/import/import-feature-filter.js';
import { ImportFieldSelector } from './ImportFieldSelector.jsx';
import { ImportProgressPanel } from './ImportProgressPanel.jsx';
import { ImportReductionNotice } from './ImportReductionNotice.jsx';
import { ImportFeatureFilterPanel } from './ImportFeatureFilterPanel.jsx';
import { useFeatureFilterState, useImportValueScan } from './useImportValueScan.js';

export function ImportOptimizerDialog({ files = [], onCancel, onConfirm }) {
    const cancelImportRef = useRef(null);
    const [scans, setScans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [importMode, setImportMode] = useState('preserve');
    const [routeAssessment, setRouteAssessment] = useState(null);
    const [error, setError] = useState('');
    const [selectedFields, setSelectedFields] = useState([]);
    const [importProgress, setImportProgress] = useState({ percent: 0, step: 'Starting import…' });
    const { featureFilter, setFeatureFilter } = useFeatureFilterState();

    const fieldNames = useMemo(() => mergeScanFieldNames(scans), [scans]);
    const reductionNotice = useMemo(() => {
        if (!routeAssessment) return null;
        return buildNoticeForRoute({ ...routeAssessment, scans });
    }, [routeAssessment, scans]);
    const showProgressNotice = shouldShowImportProgressNotice(routeAssessment);

    const valueScan = useImportValueScan({
        files,
        fieldNames,
        enabled: !loading && !importing && fieldNames.length > 0
    });

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const results = await scanFilesForImport(files);
                if (!cancelled) {
                    setScans(results);
                    const names = mergeScanFieldNames(results);
                    setSelectedFields(names);
                    const assessment = assessImportRouteFromScans(results);
                    setRouteAssessment(assessment);
                    const hasKml = results.some((s) => s.format === 'kml' || s.format === 'kmz' || s.format === 'xml');
                    setImportMode(hasKml ? 'preserve' : 'direct');
                }
            } catch (e) {
                if (!cancelled) setError(e?.message || 'Scan failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [files]);

    const hasKml = scans.some((s) => s.format === 'kml' || s.format === 'kmz' || s.format === 'xml');

    const handleConfirm = async () => {
        if (fieldNames.length > 0 && selectedFields.length === 0) {
            setError('Select at least one field to import.');
            return;
        }
        const filterError = validateFeatureFilter(featureFilter);
        if (filterError) {
            setError(filterError);
            return;
        }
        setError('');
        setImporting(true);
        setImportProgress({ percent: 0, step: 'Starting optimized import…' });

        try {
            await onConfirm?.({
                importMode: hasKml ? importMode : undefined,
                useWorkspace: routeAssessment?.useWorkspace === true,
                selectedFields: fieldNames.length ? selectedFields : null,
                featureFilter: hasActiveFeatureFilter(featureFilter) ? featureFilter : null
            }, {
                onProgress: (p) => setImportProgress(p),
                onCancelReady: (fn) => { cancelImportRef.current = fn; },
                close: () => onCancel?.(),
                onAborted: () => setImporting(false)
            });
        } catch (e) {
            setImporting(false);
            setError(e?.message || 'Import failed.');
        }
    };

    if (importing) {
        return (
            <div>
                <ImportProgressPanel
                    step={importProgress.step}
                    percent={importProgress.percent}
                    fileName={importProgress.fileName}
                    notice={showProgressNotice ? buildImportProgressReductionNotice() : null}
                    onCancel={cancelImportRef.current ? () => cancelImportRef.current?.() : null}
                />
            </div>
        );
    }

    return (
        <div>
            {error ? (
                <div className="info-box text-xs mb-8" style={{ color: 'var(--danger)' }}>{error}</div>
            ) : null}

            {loading ? (
                <>
                    {reductionNotice ? <ImportReductionNotice {...reductionNotice} /> : null}
                    <ImportProgressPanel step="Scanning files…" percent={0} />
                </>
            ) : (
                <>
                    {reductionNotice ? <ImportReductionNotice {...reductionNotice} /> : null}
                    <ul className="text-xs text-muted mb-8" style={{ margin: 0, paddingLeft: 18 }}>
                        {scans.map((s) => (
                            <li key={s.fileName}>
                                <strong>{s.fileName}</strong> ({s.sizeLabel})
                                {s.featureEstimate != null ? ` · ~${s.featureEstimate.toLocaleString()} features est.` : ''}
                                {s.fields?.length ? ` · ${s.fields.length} fields detected` : ''}
                            </li>
                        ))}
                    </ul>

                    {hasKml ? (
                        <div className="mb-8">
                            <div className="text-xs mb-4"><strong>KML/KMZ import mode</strong></div>
                            <label className="text-xs" style={{ display: 'block', marginBottom: 6 }}>
                                <input
                                    type="radio"
                                    name="importMode"
                                    checked={importMode === 'preserve'}
                                    onChange={() => setImportMode('preserve')}
                                />
                                {' '}Preserve styling and embedded assets (default)
                            </label>
                            <label className="text-xs" style={{ display: 'block' }}>
                                <input
                                    type="radio"
                                    name="importMode"
                                    checked={importMode === 'gis'}
                                    onChange={() => setImportMode('gis')}
                                />
                                {' '}Import as simplified GIS layer (strips styling, icons, long descriptions — reduces memory)
                            </label>
                        </div>
                    ) : null}

                    <div className="mb-8">
                        <div className="text-xs mb-4"><strong>Attributes to import</strong></div>
                        <ImportFieldSelector
                            fields={fieldNames}
                            selected={selectedFields}
                            onChange={setSelectedFields}
                            hint={reductionNotice
                                ? 'Uncheck fields you do not need — only selected attributes are stored (part of the size reduction plan).'
                                : 'Uncheck fields you do not need — deselected attributes are not stored.'}
                        />
                    </div>

                    {fieldNames.length > 0 ? (
                        <ImportFeatureFilterPanel
                            fieldNames={fieldNames}
                            valueCatalog={valueScan.valueCatalog}
                            scanState={valueScan.scanState}
                            scanProgress={valueScan.scanProgress}
                            scanMessage={valueScan.scanMessage}
                            onCancelScan={valueScan.cancelScan}
                            onRetryScan={valueScan.retryScan}
                            featureFilter={featureFilter}
                            onChange={setFeatureFilter}
                        />
                    ) : null}
                </>
            )}

            <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => onCancel?.()} disabled={loading}>Cancel</button>
                <button
                    className="btn btn-primary"
                    disabled={loading || valueScan.scanState === 'scanning'}
                    onClick={() => void handleConfirm()}
                >
                    Import with reduced settings
                </button>
            </div>
        </div>
    );
}
