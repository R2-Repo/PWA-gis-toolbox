import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanImportFieldValues } from '../../js/import/import-value-scan.js';
import { createEmptyFeatureFilter } from '../../js/import/import-feature-filter.js';

/**
 * Run a distinct-value scan when files + field names are ready.
 * @param {{ files: File[], fieldNames: string[], enabled?: boolean }} args
 */
export function useImportValueScan({ files = [], fieldNames = [], enabled = true }) {
    const [scanState, setScanState] = useState('idle');
    const [scanProgress, setScanProgress] = useState(null);
    const [valueCatalog, setValueCatalog] = useState(null);
    const [scanMessage, setScanMessage] = useState(null);
    const [retryToken, setRetryToken] = useState(0);
    const cancelRef = useRef(null);

    const scanKey = useMemo(() => {
        const fileKey = (files || []).map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');
        const fieldKey = (fieldNames || []).join('\0');
        return `${fileKey}::${fieldKey}::${retryToken}`;
    }, [files, fieldNames, retryToken]);

    useEffect(() => {
        if (!enabled || !files?.length || !fieldNames?.length) {
            setScanState('idle');
            setValueCatalog(null);
            setScanMessage(null);
            return undefined;
        }

        let cancelled = false;
        setScanState('scanning');
        setScanProgress({ percent: 0, step: 'Reading attribute values…' });
        setScanMessage(null);
        setValueCatalog(null);

        const target = files[0];
        const names = fieldNames;
        const job = scanImportFieldValues(target, {
            fieldNames: names,
            onProgress: (percent, step) => {
                if (!cancelled) setScanProgress({ percent, step });
            }
        });
        cancelRef.current = job.cancel;

        void job.promise.then((result) => {
            if (cancelled) return;
            cancelRef.current = null;
            setValueCatalog(result);
            if (result.supported === false) {
                setScanState('unsupported');
                setScanMessage(result.message || 'Enter filter values manually.');
            } else {
                setScanState('ready');
                setScanMessage(result.sampled ? (result.message || null) : null);
            }
            setScanProgress(null);
        }).catch((err) => {
            if (cancelled || err?.cancelled) return;
            cancelRef.current = null;
            setScanState('error');
            setScanMessage(err?.message || 'Attribute value scan failed.');
            setScanProgress(null);
        });

        return () => {
            cancelled = true;
            cancelRef.current?.();
            cancelRef.current = null;
        };
    }, [enabled, scanKey, files, fieldNames]);

    const retryScan = useCallback(() => {
        setRetryToken((n) => n + 1);
    }, []);

    return {
        scanState,
        scanProgress,
        valueCatalog,
        scanMessage,
        cancelScan: () => cancelRef.current?.(),
        retryScan
    };
}

export function useFeatureFilterState() {
    const [featureFilter, setFeatureFilter] = useState(() => createEmptyFeatureFilter());
    const resetFeatureFilter = () => setFeatureFilter(createEmptyFeatureFilter());
    return { featureFilter, setFeatureFilter, resetFeatureFilter };
}
