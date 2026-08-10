import { useEffect, useMemo, useRef, useState } from 'react';
import { hasActiveFeatureFilter } from '../../js/import/import-feature-filter.js';
import { estimateImportFilterMatches } from '../../js/import/import-filter-estimate.js';
import { estimateStoredImport } from '../../js/import/import-store-estimate.js';
import { isActiveFenceBbox, STORED_FEATURE_LIMIT } from '../../js/import/import-admission.js';
import { describeImportBlockReason } from '../../js/import/import-limit-copy.js';

const ESTIMATE_DEBOUNCE_MS = 400;

/**
 * Live stored-size / feature estimate for large-file import UI.
 * Aggregates across every selected file (not just files[0]).
 * @param {{
 *   files?: File[],
 *   fieldNames?: string[],
 *   selectedFields?: string[],
 *   featureFilter?: object|null,
 *   totalFeatureEstimate?: number|null,
 *   hasFence?: boolean,
 *   fenceBbox?: number[]|null,
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
    fenceBbox = null,
    enabled = true
} = {}) {
    const [matchCount, setMatchCount] = useState(null);
    const [matchTotal, setMatchTotal] = useState(null);
    const [estimateState, setEstimateState] = useState('idle');
    const [estimateProgress, setEstimateProgress] = useState(null);
    const [estimateMessage, setEstimateMessage] = useState(null);
    const cancelRef = useRef(null);

    const fileList = Array.isArray(files) ? files.filter(Boolean) : [];
    const sourceBytes = useMemo(
        () => fileList.reduce((sum, f) => sum + (f?.size || 0), 0),
        [fileList]
    );
    const filterActive = hasActiveFeatureFilter(featureFilter);
    const fenceActive = hasFence === true || isActiveFenceBbox(fenceBbox);
    const activeFence = isActiveFenceBbox(fenceBbox) ? fenceBbox : null;
    const needsRecount = enabled && fileList.length > 0 && (filterActive || fenceActive);

    const filterKey = useMemo(() => {
        try {
            return JSON.stringify({
                featureFilter: featureFilter || null,
                fenceBbox: activeFence
            });
        } catch {
            return String(Date.now());
        }
    }, [featureFilter, activeFence]);

    const filesKey = useMemo(() => (
        fileList.map((f) => `${f.name}:${f.size}:${f.lastModified || 0}`).join('|')
    ), [fileList]);

    useEffect(() => {
        if (!needsRecount) {
            setMatchCount(null);
            setMatchTotal(null);
            setEstimateState('idle');
            setEstimateProgress(null);
            setEstimateMessage(null);
            return undefined;
        }

        const targets = Array.isArray(files) ? files.filter(Boolean) : [];
        let cancelled = false;
        const cancelFns = [];
        const timer = setTimeout(() => {
            setEstimateState('scanning');
            setEstimateProgress({ percent: 0, step: 'Updating estimate…' });
            setEstimateMessage(null);

            const jobs = targets.map((target) => estimateImportFilterMatches(target, {
                featureFilter,
                fenceBbox: activeFence,
                onProgress: (percent, step) => {
                    if (!cancelled) setEstimateProgress({ percent, step });
                }
            }));
            cancelFns.push(...jobs.map((j) => j.cancel));
            cancelRef.current = () => {
                for (const cancel of cancelFns) cancel?.();
            };

            void Promise.all(jobs.map((j) => j.promise)).then((results) => {
                if (cancelled) return;
                cancelRef.current = null;
                const unsupported = results.find((r) => r.supported === false);
                if (unsupported && results.every((r) => r.supported === false)) {
                    setEstimateState('unsupported');
                    setEstimateMessage(unsupported.message || 'Estimate unavailable.');
                    setMatchCount(null);
                    setMatchTotal(null);
                } else {
                    let matched = 0;
                    let total = 0;
                    let anySupported = false;
                    for (const result of results) {
                        if (result.supported === false) continue;
                        anySupported = true;
                        matched += result.matchCount || 0;
                        total += result.totalCount || 0;
                    }
                    if (!anySupported) {
                        setEstimateState('unsupported');
                        setEstimateMessage('Estimate unavailable.');
                        setMatchCount(null);
                        setMatchTotal(null);
                    } else {
                        setEstimateState('ready');
                        setMatchCount(matched);
                        setMatchTotal(total || null);
                        setEstimateMessage(null);
                    }
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
    // filesKey captures name/size/lastModified for every selected file
    // eslint-disable-next-line react-hooks/exhaustive-deps -- files read via filesKey
    }, [needsRecount, filesKey, filterKey, featureFilter, activeFence]);

    const totalFeatures = matchTotal != null
        ? matchTotal
        : (totalFeatureEstimate != null ? totalFeatureEstimate : null);

    const waitingOnRecount = (filterActive || fenceActive)
        && estimateState === 'scanning'
        && matchCount == null;

    const estimate = useMemo(() => estimateStoredImport({
        sourceBytes,
        totalFeatures,
        matchedFeatures: (filterActive || fenceActive) ? matchCount : totalFeatures,
        fieldNames,
        selectedFields,
        featureFilter,
        hasFence: fenceActive,
        waitingOnRecount
    }), [
        sourceBytes,
        totalFeatures,
        filterActive,
        fenceActive,
        matchCount,
        fieldNames,
        selectedFields,
        featureFilter,
        waitingOnRecount
    ]);

    const readyToImport = estimate.canImport
        && !waitingOnRecount
        && estimateState !== 'error'
        && estimateState !== 'unsupported';

    const blockReason = useMemo(() => describeImportBlockReason({
        readyToImport,
        waitingOnRecount,
        estimateState,
        estimatedFeatures: estimate.estimatedFeatures,
        limitFeatures: estimate.limitFeatures ?? STORED_FEATURE_LIMIT,
        estimateMessage
    }), [
        readyToImport,
        waitingOnRecount,
        estimateState,
        estimate.estimatedFeatures,
        estimate.limitFeatures,
        estimateMessage
    ]);

    return {
        estimate,
        estimateState,
        estimateProgress,
        estimateMessage,
        waitingOnRecount,
        /** @deprecated use readyToImport — same value */
        canImport: readyToImport,
        readyToImport,
        blockReason,
        cancelEstimate: () => cancelRef.current?.()
    };
}

export default { useImportStoreEstimate };
