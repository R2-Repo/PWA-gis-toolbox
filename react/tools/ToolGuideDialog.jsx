import { SPLASH_FLOW } from '../../js/tools/tool-guide-sections.js';

const faviconUrl = `${import.meta.env.BASE_URL}icons/favicon.png`;

export function SplashFlow() {
    return (
        <section className="splash-flow" aria-label="How it works">
            {SPLASH_FLOW.steps.map((step, i) => (
                <figure key={step.label} className="splash-flow__step">
                    <div className="splash-flow__visual">
                        <span className="splash-flow__num" aria-hidden="true">{i + 1}</span>
                        <img
                            className="splash-flow__img"
                            src={step.image}
                            alt=""
                            width={224}
                            height={224}
                            draggable={false}
                        />
                    </div>
                    <figcaption>
                        <strong>{step.label}</strong>
                    </figcaption>
                </figure>
            ))}
        </section>
    );
}

export function ToolGuideDialog({
    isMobile = false,
    showTitle = true
}) {
    return (
        <div className="splash-guide">
            {showTitle ? <ToolGuideTitle isMobile={isMobile} /> : null}
            <SplashFlow />
        </div>
    );
}

export function ToolGuideTitle({ isMobile = false }) {
    const titleFontSize = isMobile ? 'clamp(18px, 5.5vw, 32px)' : '28px';
    const titleIconSize = isMobile ? 28 : 32;
    const byFontSize = isMobile ? 'clamp(7px, 2vw, 9px)' : '9px';

    return (
        <div className="splash-guide__title">
            <img
                src={faviconUrl}
                alt=""
                width={titleIconSize}
                height={titleIconSize}
                style={{ borderRadius: 4, flexShrink: 0, alignSelf: 'center' }}
            />
            <span style={{ fontSize: titleFontSize, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
                GIS-Toolbox<span style={{ fontSize: '0.65em', fontWeight: 400, opacity: 0.7 }}>.com</span>
            </span>
            <span style={{ fontSize: byFontSize, fontWeight: 400, opacity: 0.7, whiteSpace: 'nowrap' }}>
                by Ryan Romney
            </span>
        </div>
    );
}
