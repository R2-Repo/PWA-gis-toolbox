import { formatBytes } from '../../js/import/import-preflight.js';
import { STORED_FEATURE_LIMIT } from '../../js/import/import-admission.js';

const STATUS_COLOR = {
    red: 'var(--danger)',
    amber: 'var(--warning, orange)',
    green: 'var(--success, #2a7a3a)',
    idle: 'var(--text-muted, #666)'
};

/**
 * Live estimate of what would be stored after field / feature-filter / fence cuts.
 * Unlock = readyToImport (≤250k stored features), not gauge color alone.
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
        : (readyToImport ? 'green' : (estimate.status === 'idle' ? 'idle' : estimate.status));
    const color = STATUS_COLOR[displayStatus] || STATUS_COLOR.idle;
    const featuresLabel = estimate.estimatedFeatures != null
        ? estimate.estimatedFeatures.toLocaleString()
        : '—';
    const limitFeatures = estimate.limitFeatures ?? STORED_FEATURE_LIMIT;

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
                You can store up to {limitFeatures.toLocaleString()} features on the map.
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
                    Within the feature limit — you can import.
                </div>
            ) : (
                <div style={{ marginTop: 4 }}>
                    {blockReason
                        || 'Still over the feature limit — tighten filters or place a tighter fence.'}
                </div>
            )}
            {estimateMessage && !updating ? (
                <div style={{ marginTop: 4 }}>{estimateMessage}</div>
            ) : null}
        </div>
    );
}

export default ImportEstimateGauge;
