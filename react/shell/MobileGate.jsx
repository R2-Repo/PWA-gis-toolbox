import { useEffect, useState } from 'react';
import { SPLASH_FLOW, SPLASH_HOW_TO } from '../../js/tools/tool-guide-sections.js';
import { ToolGuideTitle } from '../tools/ToolGuideDialog.jsx';

const MOBILE_BREAKPOINT = 768;

const GATE_MESSAGE = 'GIS Toolbox works best on a larger screen. Please use a tablet or computer for the full experience.';

function HowToList({ tools }) {
    return (
        <div className="mobile-gate-howto-list">
            {tools.map(([name, desc]) => (
                <div key={name} className="mobile-gate-howto-row">
                    <span className="mobile-gate-howto-name">{name}</span>
                    <span className="mobile-gate-howto-desc">{desc}</span>
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
                <div className="mobile-gate-howto">
                    <img
                        className="mobile-gate-flow-img"
                        src={SPLASH_FLOW.image}
                        alt=""
                        width={768}
                        height={432}
                        draggable={false}
                    />
                    <div className="mobile-gate-howto-title">How To</div>
                    <HowToList tools={SPLASH_HOW_TO} />
                </div>
            </div>
        </div>
    );
}
