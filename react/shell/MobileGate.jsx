import { useEffect, useState } from 'react';
import { SplashFlow, ToolGuideTitle } from '../tools/ToolGuideDialog.jsx';

const MOBILE_BREAKPOINT = 768;

const GATE_MESSAGE = 'GIS Toolbox works best on a larger screen. Please use a tablet or computer for the full experience.';

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
                <SplashFlow />
            </div>
        </div>
    );
}
