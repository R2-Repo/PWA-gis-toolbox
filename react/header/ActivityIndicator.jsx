import { useEffect, useState } from 'react';
import { subscribeAppActivity } from '../../js/ui/app-activity.js';

/**
 * Header chrome: indeterminate bar + "Working…" after ~1s of global activity.
 */
export function ActivityIndicator() {
    const [state, setState] = useState({ visible: false, label: 'Working…' });

    useEffect(() => {
        return subscribeAppActivity((next) => {
            setState({ visible: next.visible, label: next.label || 'Working…' });
        });
    }, []);

    return (
        <>
            <div
                className={`header-activity-bar${state.visible ? ' is-visible' : ''}`}
                aria-hidden={!state.visible}
            />
            <div
                className={`header-activity-label${state.visible ? ' is-visible' : ''}`}
                id="header-activity-label"
                role="status"
                aria-live="polite"
                aria-busy={state.visible}
            >
                {state.visible ? state.label : ''}
            </div>
        </>
    );
}
