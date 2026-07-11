export function WidgetStepWizard({ steps = [], currentStep = 1, variant = 'full' }) {
    if (!steps.length) return null;

    if (variant === 'compact') {
        const total = steps.length;
        const label = steps[currentStep - 1] || '';
        const pct = Math.round((currentStep / total) * 100);

        return (
            <div className="gis-widget__step-wizard gis-widget__step-wizard--compact">
                <div className="gis-widget__step-wizard-label">
                    Step {currentStep} of {total} · {label}
                </div>
                <div className="gis-widget__progress" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={total}>
                    <div className="gis-widget__progress-bar" style={{ width: `${pct}%` }} />
                </div>
            </div>
        );
    }

    return (
        <div className="gis-widget__step-wizard" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {steps.map((step, index) => {
                const stepNumber = index + 1;
                const active = stepNumber === currentStep;
                const done = stepNumber < currentStep;
                return (
                    <div
                        key={step}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 12,
                            color: active ? 'var(--text)' : 'var(--text-muted)',
                            fontWeight: active ? 600 : 400
                        }}
                    >
                        <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: done || active ? 'var(--primary)' : 'var(--bg-surface)',
                            color: done || active ? '#000' : 'var(--text-muted)',
                            fontSize: 11,
                            fontWeight: 700
                        }}>
                            {stepNumber}
                        </span>
                        <span>{step}</span>
                    </div>
                );
            })}
        </div>
    );
}
