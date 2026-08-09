import { useEffect, useMemo, useRef, useState } from 'react';
import { hasActiveFeatureFilter } from '../../js/import/import-feature-filter.js';
import { estimateImportFilterMatches } from '../../js/import/import-filter-estimate.js';
import { estimateStoredImport } from '../../js/import/import-store-estimate.js';

const ESTIMATE_DEBOUNCE_MS = 400;

/**
 * Live stored-size / feature estimate for large-file import UI.
 * @param {{
 *   files?: File[],
 *   fieldNames?: string[],
 *   selectedFields?: string[],
 *   featureFilter?: object|null,
 *   totalFeatureEstimate?: number|null,
 *   hasFence?: boolean,
 *   enabled?: boolean
 * }} args
 */
export function useImportStoreEstimate({
    files = [],
    fieldNames = [],
    selectedFields = [],
    featureFilter = null,
    totalFeatureEstimate = null,
    hasFence = false,
    enabled = true
} = {}) {
    const [matchCount, setMatchCount] = useState(null);
    const [matchTotal, setMatchTotal] = useState(null);
    const [estimateState, setEstimateState] = useState('idle');
    const [estimateProgress, setEstimateProgress] = useState(null);
    const [estimateMessage, setEstimateMessage] = useState(null);
    const cancelRef = useRef(null);

    const file = files?.[0] || null;
    const filterActive = hasActiveFeatureFilter(featureFilter);
    const needsRecount = enabled && !!file && filterActive;

    const filterKey = useMemo(() => {
        try {
            return JSON.stringify(featureFilter || null);
        } catch {
            return String(Date.now());
        }
    }, [featureFilter]);

    useEffect(() => {
        if (!needsRecount) {
            setMatchCount(null);
            setMatchTotal(null);
            setEstimateState('idle');
            setEstimateProgress(null);
            setEstimateMessage(null);
            return undefined;
        }

        let cancelled = false;
        const timer = setTimeout(() => {
            setEstimateState('scanning');
            setEstimateProgress({ percent: 0, step: 'Updating estimate…' });
            setEstimateMessage(null);

            const job = estimateImportFilterMatches(file, {
                featureFilter,
                onProgress: (percent, step) => {
                    if (!cancelled) setEstimateProgress({ percent, step });
                }
            });
            cancelRef.current = job.cancel;

            void job.promise.then((result) => {
                if (cancelled) return;
                cancelRef.current = null;
                if (result.supported === false) {
                    setEstimateState('unsupported');
                    setEstimateMessage(result.message || 'Estimate unavailable.');
                    setMatchCount(null);
                    setMatchTotal(null);
                } else {
                    setEstimateState('ready');
                    setMatchCount(result.matchCount);
                    setMatchTotal(result.totalCount || null);
                    setEstimateMessage(null);
                }
                setEstimateProgress(null);
            }).catch((err) => {
                if (cancelled || err?.cancelled) return;
                cancelRef.current = null;
                setEstimateState('error');
                setEstimateMessage(err?.message || 'Estimate failed.');
                setEstimateProgress(null);
            });
        }, ESTIMATE_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            cancelRef.current?.();
            cancelRef.current = null;
        };
    }, [needsRecount, file, filterKey, featureFilter]);

    const totalFeatures = matchTotal != null
        ? matchTotal
        : (totalFeatureEstimate != null ? totalFeatureEstimate : null);

    const estimate = useMemo(() => estimateStoredImport({
        sourceBytes: file?.size || 0,
        totalFeatures,
        matchedFeatures: filterActive ? matchCount : totalFeatures,
        fieldNames,
        selectedFields,
        featureFilter,
        hasFence
    }), [
        file?.size,
        totalFeatures,
        filterActive,
        matchCount,
        fieldNames,
        selectedFields,
        featureFilter,
        hasFence
    ]);

    const waitingOnRecount = filterActive
        && estimateState === 'scanning'
        && matchCount == null;

    const canImport = hasFence
        ? estimate.hasReduction
        : (estimate.canImport && !waitingOnRecount && estimateState !== 'error');

    return {
        estimate,
        estimateState,
        estimateProgress,
        estimateMessage,
        waitingOnRecount,
        canImport,
        cancelEstimate: () => cancelRef.current?.()
    };
}

export default { useImportStoreEstimate };
