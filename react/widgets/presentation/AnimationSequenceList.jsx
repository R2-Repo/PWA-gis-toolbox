import {
    listSequenceStepOptions,
    getSequenceStepDefinition,
    ORBIT_PACE_MS
} from '../../../js/presentation/presentation-link-animations.js';
import {
    createSequenceStepId,
    MAX_SEQUENCE_STEPS,
    HOLD_STEP_TYPE
} from '../../../js/presentation/presentation-sequence-compiler.js';

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
 * @param {{ id: string, type: string, durationMs: number }[]} props.steps
 * @param {(steps: object[]) => void} props.onChange
 * @param {Record<string, boolean>} [props.compatibilityById]
 */
export function AnimationSequenceList({ steps = [], onChange, compatibilityById = {} }) {
    const stepOptions = listSequenceStepOptions();

    const updateStep = (index, patch) => {
        onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
    };

    const removeStep = (index) => {
        onChange(steps.filter((_, i) => i !== index));
    };

    const moveStep = (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= steps.length) return;
        const next = [...steps];
        const [row] = next.splice(index, 1);
        next.splice(target, 0, row);
        onChange(next);
    };

    const addStep = (type = 'flyToFeature') => {
        if (steps.length >= MAX_SEQUENCE_STEPS) return;
        const definition = getSequenceStepDefinition(type);
        onChange([
            ...steps,
            {
                id: createSequenceStepId(),
                type,
                durationMs: definition.ui.defaultDurationMs ?? ORBIT_PACE_MS.normal
            }
        ]);
    };

    const commitDuration = (index, rawValue) => {
        const parsed = Number.parseInt(rawValue, 10);
        const clamped = clampDurationSec(Number.isFinite(parsed) ? parsed : DURATION_MIN);
        updateStep(index, { durationMs: clamped * 1000 });
    };

    return (
        <div className="presentation-sequence-list">
            {steps.length === 0 ? (
                <p className="text-xs text-muted">Add at least one animation step.</p>
            ) : null}

            {steps.map((step, index) => {
                const definition = getSequenceStepDefinition(step.type);
                const compatible = step.type === HOLD_STEP_TYPE
                    || compatibilityById[step.type] !== false;

                return (
                    <div
                        key={step.id}
                        className={`presentation-sequence-list__row${compatible ? '' : ' is-incompatible'}`}
                    >
                        <span className="presentation-sequence-list__index">{index + 1}</span>
                        <select
                            className="input-sm presentation-sequence-list__type"
                            value={step.type}
                            aria-label={`Animation step ${index + 1}`}
                            onChange={(e) => {
                                const nextType = e.target.value;
                                const nextDef = getSequenceStepDefinition(nextType);
                                updateStep(index, {
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
                        <input
                            type="number"
                            className="input-sm presentation-sequence-list__duration"
                            min={DURATION_MIN}
                            max={DURATION_MAX}
                            value={formatDurationSec(step.durationMs, definition.ui.defaultDurationMs)}
                            aria-label={`Duration for step ${index + 1}`}
                            onChange={(e) => updateStep(index, {
                                durationMs: clampDurationSec(Number.parseInt(e.target.value, 10) || DURATION_MIN) * 1000
                            })}
                            onBlur={(e) => commitDuration(index, e.target.value)}
                        />
                        <span className="presentation-sequence-list__unit text-xs text-muted">s</span>
                        <div className="presentation-sequence-list__order">
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={index === 0}
                                aria-label="Move up"
                                onClick={() => moveStep(index, -1)}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={index === steps.length - 1}
                                aria-label="Move down"
                                onClick={() => moveStep(index, 1)}
                            >
                                ↓
                            </button>
                        </div>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm presentation-sequence-list__remove"
                            aria-label="Remove step"
                            onClick={() => removeStep(index)}
                        >
                            ✕
                        </button>
                    </div>
                );
            })}

            <div className="presentation-sequence-list__actions gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={steps.length >= MAX_SEQUENCE_STEPS}
                    onClick={() => addStep('flyToFeature')}
                >
                    + Add animation
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={steps.length >= MAX_SEQUENCE_STEPS}
                    onClick={() => addStep(HOLD_STEP_TYPE)}
                >
                    + Add hold
                </button>
            </div>

            {steps.length >= MAX_SEQUENCE_STEPS ? (
                <p className="presentation-sequence-list__hint text-xs text-muted">
                    Maximum {MAX_SEQUENCE_STEPS} steps per presentation.
                </p>
            ) : (
                <p className="presentation-sequence-list__hint text-xs text-muted">
                    Fly in followed by orbit plays as one smooth cinematic transition.
                </p>
            )}
        </div>
    );
}
