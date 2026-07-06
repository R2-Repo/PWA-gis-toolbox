import {
    getSequenceStepDefinition,
    listSequenceStepOptions,
    ORBIT_PACE_MS
} from '../../../js/presentation/presentation-link-animations.js';
import { HOLD_STEP_TYPE } from '../../../js/presentation/presentation-sequence-compiler.js';

const DURATION_MIN = 1;
const DURATION_MAX = 60;

function clampDurationSec(value) {
    return Math.min(DURATION_MAX, Math.max(DURATION_MIN, value));
}

function formatDurationSec(durationMs, fallbackMs = ORBIT_PACE_MS.normal) {
    return String(Math.round((durationMs ?? fallbackMs) / 1000));
}

/**
 * @param {object} props
 * @param {number} props.index
 * @param {{ id: string, type: string, durationMs: number }} props.step
 * @param {number} props.totalSteps
 * @param {boolean} props.compatible
 * @param {Record<string, boolean>} [props.compatibilityById]
 * @param {string | null} [props.overlapHint]
 * @param {(patch: object) => void} props.onChange
 * @param {() => void} props.onRemove
 * @param {(direction: -1 | 1) => void} props.onMove
 */
export function SequenceStepCard({
    index,
    step,
    totalSteps,
    compatible,
    compatibilityById = {},
    overlapHint,
    onChange,
    onRemove,
    onMove
}) {
    const stepOptions = listSequenceStepOptions();
    const definition = getSequenceStepDefinition(step.type);
    const isHold = step.type === HOLD_STEP_TYPE;
    const durationLabel = definition.ui.durationLabel ?? 'Duration (seconds)';

    const commitDuration = (rawValue) => {
        const parsed = Number.parseInt(rawValue, 10);
        const clamped = clampDurationSec(Number.isFinite(parsed) ? parsed : DURATION_MIN);
        onChange({ durationMs: clamped * 1000 });
    };

    return (
        <div className={`presentation-sequence-list__card${compatible ? '' : ' is-incompatible'}`}>
            <div className="presentation-sequence-list__card-header">
                <span className="presentation-sequence-list__badge">{index + 1}</span>
                <span className="presentation-sequence-list__card-title">
                    {isHold ? 'Hold / pause' : `Step ${index + 1}`}
                </span>
                <div className="presentation-sequence-list__card-actions">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={index === 0}
                        aria-label="Move step up"
                        onClick={() => onMove(-1)}
                    >
                        ↑
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={index >= totalSteps - 1}
                        aria-label="Move step down"
                        onClick={() => onMove(1)}
                    >
                        ↓
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Remove step"
                        onClick={onRemove}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {!isHold ? (
                <div className="presentation-sequence-list__field">
                    <label className="field-label" htmlFor={`sequence-step-type-${step.id}`}>
                        Animation
                    </label>
                    <select
                        id={`sequence-step-type-${step.id}`}
                        className="input-sm w-full"
                        value={step.type}
                        onChange={(e) => {
                            const nextType = e.target.value;
                            const nextDef = getSequenceStepDefinition(nextType);
                            onChange({
                                type: nextType,
                                durationMs: nextDef.ui.defaultDurationMs ?? step.durationMs
                            });
                        }}
                    >
                        {stepOptions.map((option) => {
                            const optionCompatible = option.id === HOLD_STEP_TYPE
                                || compatibilityById[option.id] !== false;
                            return (
                                <option
                                    key={option.id}
                                    value={option.id}
                                    disabled={!optionCompatible}
                                >
                                    {option.label}
                                </option>
                            );
                        })}
                    </select>
                </div>
            ) : null}

            <div className="presentation-sequence-list__field">
                <label className="field-label" htmlFor={`sequence-step-duration-${step.id}`}>
                    {durationLabel}
                </label>
                <input
                    id={`sequence-step-duration-${step.id}`}
                    type="number"
                    className="input-sm w-full"
                    min={DURATION_MIN}
                    max={DURATION_MAX}
                    value={formatDurationSec(step.durationMs, definition.ui.defaultDurationMs)}
                    onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10);
                        const clamped = clampDurationSec(Number.isFinite(parsed) ? parsed : DURATION_MIN);
                        onChange({ durationMs: clamped * 1000 });
                    }}
                    onBlur={(e) => commitDuration(e.target.value)}
                />
            </div>

            {!compatible && !isHold ? (
                <p className="presentation-sequence-list__warning text-xs text-muted">
                    This animation does not match the selected feature geometry.
                </p>
            ) : null}

            {overlapHint ? (
                <p className="presentation-sequence-list__overlap-hint text-xs text-muted">
                    {overlapHint}
                </p>
            ) : null}
        </div>
    );
}
