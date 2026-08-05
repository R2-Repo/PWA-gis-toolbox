import { useEffect, useState } from 'react';
import { getVisibleWidgets } from '../../js/widgets/registry.js';

/** Fired when the web platform bundle is ready for widget filtering. */
export const PLATFORM_READY_EVENT = 'gis-platform-ready';

export function WidgetPanel() {
    const [widgets, setWidgets] = useState(() => getVisibleWidgets());

    useEffect(() => {
        const sync = () => setWidgets(getVisibleWidgets());
        sync();
        window.addEventListener(PLATFORM_READY_EVENT, sync);
        return () => window.removeEventListener(PLATFORM_READY_EVENT, sync);
    }, []);

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {widgets.map((widget) => (
                <span key={widget.type} className="geo-tool-btn">
                    <button type="button" className="btn btn-sm btn-secondary" data-app-action={widget.action}>
                        {widget.icon} {widget.label}
                    </button>
                    <span className="geo-tip">{widget.tip}</span>
                </span>
            ))}
        </div>
    );
}
