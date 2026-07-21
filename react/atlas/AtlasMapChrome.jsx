import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { clearAtlasFocus } from '../../js/atlas/controller.js';
import {
    ATLAS_MAP_LEGEND_EXTRA,
    ATLAS_PING_LEGEND,
    describeAtlasFocus
} from '../../js/atlas/focus-label.js';

/**
 * Overlay chrome for Atlas workspace: focus bar + ping legend.
 */
export function AtlasMapChrome() {
    const [tick, setTick] = useState(0);
    const [legendOpen, setLegendOpen] = useState(true);

    useEffect(() => {
        const unsub = [
            bus.on('atlas:changed', () => setTick((t) => t + 1)),
            bus.on('atlas:selection', () => setTick((t) => t + 1)),
            bus.on('atlas:ping', () => setTick((t) => t + 1)),
            bus.on('atlas:opened', () => setTick((t) => t + 1))
        ];
        return () => unsub.forEach((u) => u?.());
    }, []);

    const snap = useMemo(() => getAtlasSnapshot(), [tick]);
    const focus = useMemo(() => describeAtlasFocus(snap), [snap, tick]);

    return (
        <div className="atlas-map-chrome" aria-label="Atlas map focus">
            <div className="atlas-map-focus-bar">
                <div className="atlas-map-focus-text">
                    <strong>{focus.title}</strong>
                    <span className="atlas-muted">{focus.detail}</span>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!focus.canClear}
                    title={focus.canClear ? 'Clear selection or area (Esc)' : 'Nothing to clear'}
                    onClick={() => clearAtlasFocus()}
                >
                    Clear
                </button>
                <span className="atlas-map-focus-hint atlas-muted">Esc</span>
            </div>

            <div className={`atlas-map-legend${legendOpen ? '' : ' atlas-map-legend--collapsed'}`}>
                <button
                    type="button"
                    className="atlas-map-legend-toggle"
                    onClick={() => setLegendOpen((v) => !v)}
                    aria-expanded={legendOpen}
                >
                    {legendOpen ? 'Legend ▾' : 'Legend ▸'}
                </button>
                {legendOpen ? (
                    <ul className="atlas-map-legend-list">
                        {ATLAS_PING_LEGEND.map((item) => (
                            <li key={item.key}>
                                <span
                                    className="atlas-map-legend-swatch"
                                    style={{ background: item.color }}
                                    aria-hidden="true"
                                />
                                {item.label}
                            </li>
                        ))}
                        {ATLAS_MAP_LEGEND_EXTRA.map((item) => (
                            <li key={item.key}>
                                <span
                                    className={`atlas-map-legend-swatch${item.ring ? ' atlas-map-legend-swatch--ring' : ''}${item.line ? ' atlas-map-legend-swatch--line' : ''}`}
                                    style={item.line || item.ring ? { borderColor: item.color, background: item.line ? item.color : 'transparent' } : { background: item.color }}
                                    aria-hidden="true"
                                />
                                {item.label}
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        </div>
    );
}
