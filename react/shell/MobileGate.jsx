import { useEffect, useState } from 'react';
import { TOOL_GUIDE_SECTIONS } from '../../js/tools/tool-guide-sections.js';
import { ToolGuideTitle } from '../tools/ToolGuideDialog.jsx';

const MOBILE_BREAKPOINT = 768;

const GATE_MESSAGE = 'GIS Toolbox works best on a larger screen. Please use a tablet or computer for the full experience.';

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

function useMobileViewport() {
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
    );

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return isMobile;
}

export function MobileGate() {
    const isMobile = useMobileViewport();
    if (!isMobile) return null;

    const howToSection = TOOL_GUIDE_SECTIONS.find((section) => section.title === 'How To');

    return (
        <div
            className="mobile-gate"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-gate-notice"
        >
            <div className="mobile-gate-inner">
                <ToolGuideTitle isMobile />
                <p className="mobile-gate-notice" id="mobile-gate-notice">
                    {GATE_MESSAGE}
                </p>
                {howToSection ? (
                    <div className="mobile-gate-howto">
                        <div className="mobile-gate-howto-title">{howToSection.title}</div>
                        <HowToList tools={howToSection.tools} />
                    </div>
                ) : null}
            </div>
        </div>
    );
}
