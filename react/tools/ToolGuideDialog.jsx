import { TOOL_GUIDE_SECTIONS } from '../../js/tools/tool-guide-sections.js';

const faviconUrl = `${import.meta.env.BASE_URL}icons/favicon.png`;

function ToolList({ tools }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tools.map(([name, desc]) => (
                <div key={name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', minWidth: 110, color: 'var(--text)' }}>{name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{desc}</span>
                </div>
            ))}
        </div>
    );
}

function HowToList({ tools }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tools.map(([name, desc]) => (
                <div key={name} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', minWidth: 110, color: 'var(--text)', fontSize: 16 }}>{name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 15 }}>{desc}</span>
                </div>
            ))}
        </div>
    );
}

export function ToolGuideDialog({
    isMobile = false,
    showTitle = true,
    onOpenUgrcSettings,
    onOpenStorageManager
}) {
    return (
        <div>
            {showTitle ? <ToolGuideTitle isMobile={isMobile} /> : null}
            <div style={{ overflowY: 'auto', flex: 1 }}>
                {TOOL_GUIDE_SECTIONS.map((section) => {
                    if (section.title === 'How To') {
                        return (
                            <div key={section.title} style={{ marginBottom: 20 }}>
                                <div style={{ fontWeight: 700, fontSize: 22, color: 'var(--gold-light)', marginBottom: 8, borderBottom: '2px solid var(--border)', paddingBottom: 4 }}>
                                    {section.title}
                                </div>
                                <HowToList tools={section.tools} />
                            </div>
                        );
                    }
                    return (
                        <details key={section.title} className="guide-section">
                            <summary className="guide-section-title">{section.title}</summary>
                            <div className="guide-section-body">
                                <ToolList tools={section.tools} />
                            </div>
                        </details>
                    );
                })}
                {(typeof onOpenUgrcSettings === 'function' || typeof onOpenStorageManager === 'function') ? (
                    <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        </div>
    );
}

export function ToolGuideTitle({ isMobile = false }) {
    const titleFontSize = isMobile ? 'clamp(18px, 5.5vw, 32px)' : '32px';
    const titleIconSize = isMobile ? 28 : 36;
    const byFontSize = isMobile ? 'clamp(7px, 2vw, 9px)' : '9px';

    return (
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'nowrap', maxWidth: '100%' }}>
            <img src={faviconUrl} alt="" width={titleIconSize} height={titleIconSize} style={{ borderRadius: 4, flexShrink: 0, alignSelf: 'center' }} />
            <span style={{ fontSize: titleFontSize, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
                GIS-Toolbox<span style={{ fontSize: '0.65em', fontWeight: 400, opacity: 0.7 }}>.com</span>
            </span>
            <span style={{ fontSize: byFontSize, fontWeight: 400, opacity: 0.7, whiteSpace: 'nowrap' }}>by Ryan Romney</span>
        </div>
    );
}
