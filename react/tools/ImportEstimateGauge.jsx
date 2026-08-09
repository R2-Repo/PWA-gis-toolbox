import { formatBytes } from '../../js/import/import-preflight.js';

const STATUS_COLOR = {
    red: 'var(--danger)',
    amber: 'var(--warning, orange)',
    green: 'var(--success, #2a7a3a)',
    idle: 'var(--text-muted, #666)'
};

/**
 * Live estimate of what would be stored after field / feature-filter reduction.
 */
export function ImportEstimateGauge({
    estimate = null,
    estimateState = 'idle',
    estimateProgress = null,
    estimateMessage = null,
    waitingOnRecount = false,
    sourceBytes = 0
}) {
    if (!estimate) return null;

    const color = STATUS_COLOR[estimate.status] || STATUS_COLOR.idle;
    const featuresLabel = estimate.estimatedFeatures != null
        ? estimate.estimatedFeatures.toLocaleString()
        : '—';
    const updating = waitingOnRecount || estimateState === 'scanning';

    return (
        <div className="info-box text-xs mt-8 mb-8" style={{ color }}>
            <div>
                <strong>Estimated after your selections:</strong>
                {' '}
                {estimate.estimatedBytesLabel}
                {' · '}
                {featuresLabel}
                {' '}
                features
                {updating
                    ? ` (${estimateProgress?.percent != null ? `${estimateProgress.percent}% — ` : ''}updating…)`
                    : ''}
            </div>
            <div style={{ marginTop: 4 }}>
                Import limits: {estimate.limitBytesLabel} file size, {estimate.limitFeatures.toLocaleString()} features.
            </div>
            <div className="text-muted" style={{ marginTop: 4, color: 'inherit', opacity: 0.85 }}>
                Source file size does not change
                {sourceBytes > 0 ? ` (${formatBytes(sourceBytes)})` : ''}
                ; this is what would be stored.
            </div>
            {estimate.status === 'red' ? (
                <div style={{ marginTop: 4 }}>
                    Still over the feature limit — tighten filters or uncheck more attributes.
                </div>
            ) : null}
            {estimate.status === 'amber' ? (
                <div style={{ marginTop: 4 }}>
                    Feature count is within limits; estimated stored size is still large (stream import OK).
                </div>
            ) : null}
            {estimate.status === 'green' ? (
                <div style={{ marginTop: 4 }}>
                    Within import limits — you can import.
                </div>
            ) : null}
            {estimateMessage ? (
                <div style={{ marginTop: 4 }}>{estimateMessage}</div>
            ) : null}
        </div>
    );
}

export default ImportEstimateGauge;
