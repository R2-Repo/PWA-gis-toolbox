import { formatBytes } from '../../js/import/import-preflight.js';
import {
    STORED_FEATURE_LIMIT,
    MATERIALIZE_FEATURE_LIMIT
} from '../../js/import/import-admission.js';
import { materializeRestrictionNote } from '../../js/import/import-limit-copy.js';

const STATUS_COLOR = {
    red: 'var(--danger)',
    amber: 'var(--warning, orange)',
    green: 'var(--success, #2a7a3a)',
    idle: 'var(--text-muted, #666)'
};

/**
 * Live estimate of what would be stored after field / feature-filter / fence cuts.
 * Unlock = readyToImport (≤ ~1M stored features).
 */
export function ImportEstimateGauge({
    estimate = null,
    estimateState = 'idle',
    estimateProgress = null,
    estimateMessage = null,
    waitingOnRecount = false,
    readyToImport = false,
    blockReason = null,
    sourceBytes = 0
}) {
    if (!estimate) return null;

    const updating = waitingOnRecount || estimateState === 'scanning';
    const displayStatus = updating
        ? 'amber'
        : (readyToImport
            ? (estimate.exceedsMaterializeLimit ? 'amber' : 'green')
            : (estimate.status === 'idle' ? 'idle' : estimate.status));
    const color = STATUS_COLOR[displayStatus] || STATUS_COLOR.idle;
    const featuresLabel = estimate.estimatedFeatures != null
        ? estimate.estimatedFeatures.toLocaleString()
        : '—';
    const limitFeatures = estimate.limitFeatures ?? STORED_FEATURE_LIMIT;
    const materializeNote = !updating && readyToImport
        ? materializeRestrictionNote(estimate.estimatedFeatures)
        : null;

    return (
        <div className="info-box text-xs mt-8 mb-8" style={{ color }}>
            <div>
                <strong>Estimated stored features:</strong>
                {' '}
                {featuresLabel}
                {' / '}
                {limitFeatures.toLocaleString()}
                {estimate.estimatedBytesLabel
                    ? ` · ~${estimate.estimatedBytesLabel} attributes+geometry`
                    : ''}
                {updating
                    ? ` (${estimateProgress?.percent != null ? `${estimateProgress.percent}% — ` : ''}updating…)`
                    : ''}
            </div>
            <div style={{ marginTop: 4 }}>
                You can store up to {limitFeatures.toLocaleString()} features on the map
                {' '}
                (whole-layer GIS tools use a {MATERIALIZE_FEATURE_LIMIT.toLocaleString()} feature working-set budget).
            </div>
            <div className="text-muted" style={{ marginTop: 4, color: 'inherit', opacity: 0.85 }}>
                Source file size does not change
                {sourceBytes > 0 ? ` (${formatBytes(sourceBytes)})` : ''}
                ; this is what would be stored.
            </div>
            {updating ? (
                <div style={{ marginTop: 4 }}>
                    Updating estimate…
                </div>
            ) : readyToImport ? (
                <div style={{ marginTop: 4 }}>
                    Within the stored-feature limit — you can import.
                </div>
            ) : (
                <div style={{ marginTop: 4 }}>
                    {blockReason
                        || 'Still over the stored-feature limit — tighten filters or place a tighter fence.'}
                </div>
            )}
            {materializeNote ? (
                <div style={{ marginTop: 4 }}>{materializeNote}</div>
            ) : null}
            {estimateMessage && !updating ? (
                <div style={{ marginTop: 4 }}>{estimateMessage}</div>
            ) : null}
        </div>
    );
}

export default ImportEstimateGauge;
