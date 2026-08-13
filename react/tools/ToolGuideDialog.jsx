import {
    SPLASH_CARDS,
    SPLASH_FLOW,
    SPLASH_MODE_ICONS,
    SPLASH_SOURCE_ICONS
} from '../../js/tools/tool-guide-sections.js';

const faviconUrl = `${import.meta.env.BASE_URL}icons/favicon.png`;

function SplashIconGrid({ items, compact = false }) {
    return (
        <div className={`splash-icon-grid${compact ? ' splash-icon-grid--compact' : ''}`}>
            {items.map((item) => (
                <div key={item.label} className="splash-icon-grid__item">
                    <img src={item.src} alt="" width={56} height={56} draggable={false} />
                    <span>{item.label}</span>
                </div>
            ))}
        </div>
    );
}

function SplashCard({ card }) {
    return (
        <article className="splash-card">
            {card.type === 'sourceGrid' ? (
                <SplashIconGrid items={SPLASH_SOURCE_ICONS} compact />
            ) : card.type === 'modeRow' ? (
                <SplashIconGrid items={SPLASH_MODE_ICONS} />
            ) : (
                <img
                    className="splash-card__img"
                    src={card.image}
                    alt=""
                    width={120}
                    height={120}
                    draggable={false}
                />
            )}
            <h3 className="splash-card__title">{card.title}</h3>
            <p className="splash-card__caption">{card.caption}</p>
        </article>
    );
}

export function ToolGuideDialog({
    isMobile = false,
    showTitle = true,
    onOpenUgrcSettings,
    onOpenStorageManager
}) {
    return (
        <div className="splash-guide">
            {showTitle ? <ToolGuideTitle isMobile={isMobile} /> : null}

            <section className="splash-flow" aria-label="How it works">
                <img
                    className="splash-flow__img"
                    src={SPLASH_FLOW.image}
                    alt="Import, interact, then export"
                    width={768}
                    height={432}
                    draggable={false}
                />
                <ol className="splash-flow__steps">
                    {SPLASH_FLOW.steps.map((step) => (
                        <li key={step.label}>
                            <strong>{step.label}</strong>
                            <span>{step.hint}</span>
                        </li>
                    ))}
                </ol>
            </section>

            <div className="splash-card-grid">
                {SPLASH_CARDS.map((card) => (
                    <SplashCard key={card.id} card={card} />
                ))}
            </div>

            {(typeof onOpenUgrcSettings === 'function' || typeof onOpenStorageManager === 'function') ? (
                <div className="splash-guide__actions">
                    {typeof onOpenStorageManager === 'function' ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onOpenStorageManager()}
                        >
                            Storage…
                        </button>
                    ) : null}
                    {typeof onOpenUgrcSettings === 'function' ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onOpenUgrcSettings()}
                        >
                            UGRC API key…
                        </button>
                    ) : null}
                </div>
            ) : null}
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
