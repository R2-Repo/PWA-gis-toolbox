import {
    listSequenceStepOptions,
    getSequenceStepDefinition,
    ORBIT_PACE_MS
} from '../../../js/presentation/presentation-link-animations.js';
import {
    createSequenceStepId,
    getOverlapHintForStep,
    MAX_SEQUENCE_STEPS,
    HOLD_STEP_TYPE
} from '../../../js/presentation/presentation-sequence-compiler.js';
import { SequenceStepCard } from './SequenceStepCard.jsx';
import { SequenceTimelineBar } from './SequenceTimelineBar.jsx';

/**
 * @param {object} props
 * @param {{ id: string, type: string, durationMs: number }[]} props.steps
 * @param {(steps: object[]) => void} props.onChange
 * @param {Record<string, boolean>} [props.compatibilityById]
 * @param {object} [props.previewCtx]
 */
export function AnimationSequenceList({
    steps = [],
    onChange,
    compatibilityById = {},
    previewCtx = {}
}) {
    const stepOptions = listSequenceStepOptions();
    const animOptions = stepOptions.filter((option) => option.id !== HOLD_STEP_TYPE);

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

    return (
        <div className="presentation-sequence-list">
            <SequenceTimelineBar steps={steps} previewCtx={previewCtx} />

            {steps.length === 0 ? (
                <p className="text-xs text-muted">Add at least one animation step.</p>
            ) : null}

            <div className="presentation-sequence-list__cards">
                {steps.map((step, index) => {
                    const compatible = step.type === HOLD_STEP_TYPE
                        || compatibilityById[step.type] !== false;
                    const overlapHint = getOverlapHintForStep(steps, index, previewCtx);

                    return (
                        <SequenceStepCard
                            key={step.id}
                            index={index}
                            step={step}
                            totalSteps={steps.length}
                            compatible={compatible}
                            compatibilityById={compatibilityById}
                            overlapHint={overlapHint}
                            onChange={(patch) => updateStep(index, patch)}
                            onRemove={() => removeStep(index)}
                            onMove={(direction) => moveStep(index, direction)}
                        />
                    );
                })}
            </div>

            <div className="presentation-sequence-list__actions gis-widget__btn-row">
                <select
                    className="input-sm presentation-sequence-list__add-select"
                    defaultValue=""
                    disabled={steps.length >= MAX_SEQUENCE_STEPS}
                    aria-label="Add animation type"
                    onChange={(e) => {
                        const type = e.target.value;
                        if (!type) return;
                        addStep(type);
                        e.target.value = '';
                    }}
                >
                    <option value="">+ Add animation…</option>
                    {animOptions.map((option) => {
                        const optionCompatible = compatibilityById[option.id] !== false;
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
                    Steps blend automatically. Fly in + orbit merge smoothly; draw route can start during fly in.
                </p>
            )}
        </div>
    );
}
