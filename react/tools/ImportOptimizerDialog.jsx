import { useEffect, useMemo, useRef, useState } from 'react';
import { scanFilesForImport } from '../../js/import/import-scan.js';
import { mergeScanFieldNames } from '../../js/import/import-field-filter.js';
import { assessImportRouteFromScans } from '../../js/import/import-routing.js';
import {
    hasActiveFeatureFilter,
    validateFeatureFilter
} from '../../js/import/import-feature-filter.js';
import { ImportFieldSelector } from './ImportFieldSelector.jsx';
import { ImportProgressPanel } from './ImportProgressPanel.jsx';
import { ImportFeatureFilterPanel } from './ImportFeatureFilterPanel.jsx';
import { STORED_FEATURE_LIMIT } from '../../js/import/import-admission.js';
import { ImportFencePlaceControl } from './ImportFencePlaceControl.jsx';
import { useFeatureFilterState, useImportValueScan } from './useImportValueScan.js';
import { useImportStoreEstimate } from './useImportStoreEstimate.js';
import { formatBytes } from '../../js/import/import-preflight.js';

export function ImportOptimizerDialog({
    files = [],
    onCancel,
    onConfirm,
    hasActiveFence = false,
    fenceBbox = null,
    onPlaceFence = null,
    onClearFence = null,
    initialSelectedFields = null,
    initialFeatureFilter = null,
    initialImportMode = null
}) {
    const cancelImportRef = useRef(null);
    const [scans, setScans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [importMode, setImportMode] = useState(initialImportMode || 'preserve');
    const [routeAssessment, setRouteAssessment] = useState(null);
    const [error, setError] = useState('');
    const [selectedFields, setSelectedFields] = useState([]);
    const [importProgress, setImportProgress] = useState({ percent: 0, step: 'Starting import…' });
    const [fenceActive, setFenceActive] = useState(hasActiveFence === true);
    const { featureFilter, setFeatureFilter } = useFeatureFilterState();
    const restoredFilterRef = useRef(false);
    const restoredFieldsRef = useRef(false);

    const fieldNames = useMemo(() => mergeScanFieldNames(scans), [scans]);

    const valueScan = useImportValueScan({
        files,
        fieldNames,
        enabled: !loading && !importing && fieldNames.length > 0
    });

    const totalFeatureEstimate = useMemo(() => {
        const values = scans.map((s) => s.featureEstimate).filter((n) => n != null && n > 0);
        if (!values.length) return valueScan.valueCatalog?.rowCount ?? null;
        return values.reduce((sum, n) => sum + n, 0);
    }, [scans, valueScan.valueCatalog]);

    const storeEstimate = useImportStoreEstimate({
        files,
        fieldNames,
        selectedFields,
        featureFilter,
        totalFeatureEstimate,
        hasFence: fenceActive,
        fenceBbox: Array.isArray(fenceBbox) ? fenceBbox : null,
        enabled: !loading && !importing && files.length > 0
    });

    useEffect(() => {
        setFenceActive(hasActiveFence === true);
    }, [hasActiveFence]);

    useEffect(() => {
        if (restoredFilterRef.current || !initialFeatureFilter) return;
        restoredFilterRef.current = true;
        setFeatureFilter(initialFeatureFilter);
    }, [initialFeatureFilter, setFeatureFilter]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const results = await scanFilesForImport(files);
                if (!cancelled) {
                    setScans(results);
                    const names = mergeScanFieldNames(results);
                    if (!restoredFieldsRef.current && Array.isArray(initialSelectedFields) && initialSelectedFields.length) {
                        restoredFieldsRef.current = true;
                        const allowed = new Set(names);
                        const restored = initialSelectedFields.filter((f) => allowed.has(f));
                        setSelectedFields(restored.length ? restored : names);
                    } else {
                        setSelectedFields(names);
                    }
                    const assessment = assessImportRouteFromScans(results);
                    setRouteAssessment(assessment);
                    const hasKml = results.some((s) => s.format === 'kml' || s.format === 'kmz' || s.format === 'xml');
                    if (initialImportMode === 'preserve' || initialImportMode === 'gis' || initialImportMode === 'direct') {
                        setImportMode(initialImportMode);
                    } else {
                        setImportMode(hasKml ? 'preserve' : 'direct');
                    }
                }
            } catch (e) {
                if (!cancelled) setError(e?.message || 'Scan failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [files, initialSelectedFields, initialImportMode]);

    const hasKml = scans.some((s) => s.format === 'kml' || s.format === 'kmz' || s.format === 'xml');

    const handlePlaceFence = () => {
        onPlaceFence?.({
            selectedFields,
            featureFilter: hasActiveFeatureFilter(featureFilter) ? featureFilter : null,
            importMode
        });
    };

    const handleClearFence = () => {
        onClearFence?.();
        setFenceActive(false);
    };

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
        if (!storeEstimate.readyToImport) {
            setError(storeEstimate.blockReason || `Stored features must be ≤ ${(storeEstimate.estimate?.limitFeatures ?? STORED_FEATURE_LIMIT).toLocaleString()} before continuing.`);
            return;
        }
        setError('');
        setImporting(true);
        setImportProgress({ percent: 0, step: 'Starting import…' });

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
                <ImportProgressPanel step="Scanning files…" percent={0} />
            ) : (
                <>
                    <ul className="text-xs text-muted mb-8" style={{ margin: 0, paddingLeft: 18 }}>
                        {scans.map((s) => (
                            <li key={s.fileName}>
                                <strong>{s.fileName}</strong>
                                {s.sizeBytes != null ? ` (${formatBytes(s.sizeBytes)})` : (s.sizeLabel ? ` (${s.sizeLabel})` : '')}
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
                                {' '}Preserve styling
                            </label>
                            <label className="text-xs" style={{ display: 'block' }}>
                                <input
                                    type="radio"
                                    name="importMode"
                                    checked={importMode === 'gis'}
                                    onChange={() => setImportMode('gis')}
                                />
                                {' '}Simplified GIS layer
                            </label>
                        </div>
                    ) : null}

                    <div className="mb-8">
                        <div className="text-xs mb-4"><strong>Attributes to import</strong></div>
                        <ImportFieldSelector
                            fields={fieldNames}
                            selected={selectedFields}
                            onChange={setSelectedFields}
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

                    {onPlaceFence ? (
                        <ImportFencePlaceControl
                            hasActiveFence={fenceActive}
                            disabled={valueScan.scanState === 'scanning'}
                            onPlaceFence={handlePlaceFence}
                            onClearFence={handleClearFence}
                        />
                    ) : null}
                </>
            )}

            <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => onCancel?.()} disabled={loading}>Cancel</button>
                <button
                    className="btn btn-primary"
                    disabled={loading || !storeEstimate.readyToImport}
                    onClick={() => void handleConfirm()}
                >
                    Import
                </button>
            </div>
        </div>
    );
}
