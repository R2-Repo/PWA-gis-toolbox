import { compilePreviewTimeline } from '../../../js/presentation/presentation-sequence-compiler.js';

const SEGMENT_COLORS = [
    'var(--primary)',
    '#4da3ff',
    '#7b68ee',
    '#3ecf8e',
    '#ffb347'
];

function formatTotalSeconds(totalDurationMs) {
    if (!totalDurationMs) return '0';
    return String(Math.max(1, Math.round(totalDurationMs / 1000)));
}

/**
 * @param {object} props
 * @param {{ id: string, type: string, durationMs: number }[]} props.steps
 * @param {object} [props.previewCtx]
 */
export function SequenceTimelineBar({ steps = [], previewCtx = {} }) {
    const timeline = compilePreviewTimeline(steps, previewCtx);
    const { totalDurationMs } = timeline;

    if (!steps.length || totalDurationMs <= 0) {
        return null;
    }

    const laneCount = timeline.steps.some((step) => step.timelineMode === 'overlap') ? 2 : 1;

    return (
        <div className="presentation-sequence-timeline">
            <div className="presentation-sequence-timeline__header">
                <span className="field-label">Timeline preview</span>
                <span className="presentation-sequence-timeline__total text-xs text-muted">
                    Total ~{formatTotalSeconds(totalDurationMs)}s
                </span>
            </div>

            <div
                className="presentation-sequence-timeline__track"
                style={{ '--timeline-lanes': laneCount }}
            >
                {timeline.steps.map((entry, index) => {
                    const leftPct = (entry.startAtMs / totalDurationMs) * 100;
                    const widthPct = Math.max(2, (entry.durationMs / totalDurationMs) * 100);
                    return (
                        <div
                            key={entry.id}
                            className={`presentation-sequence-timeline__segment${entry.timelineMode === 'overlap' ? ' is-overlap' : ''}`}
                            style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                background: SEGMENT_COLORS[index % SEGMENT_COLORS.length]
                            }}
                            title={`${entry.label} (${Math.round(entry.durationMs / 1000)}s)`}
                        >
                            <span className="presentation-sequence-timeline__segment-label">
                                {entry.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            <p className="presentation-sequence-timeline__hint text-xs text-muted">
                Compatible steps blend automatically. Overlapping bars play at the same time.
            </p>
        </div>
    );
}
