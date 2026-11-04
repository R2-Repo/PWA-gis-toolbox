import { useEffect, useState } from 'react';
import { MapLegend } from './MapLegend.jsx';
import { popoutLegendEntries, subscribePopoutLegend } from '../../js/dual-screen/popout-legend.js';

export function PopoutLegend() {
    const [entries, setEntries] = useState(() => popoutLegendEntries());

    useEffect(() => subscribePopoutLegend((next) => setEntries(next)), []);

    return <MapLegend entries={entries} />;
}
