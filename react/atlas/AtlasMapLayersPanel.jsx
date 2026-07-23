import { useMemo, useState } from 'react';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';
import { getAtlasSnapshot } from '../../js/atlas/store.js';

const ATLAS_OVERLAY_LAYERS = [
    { id: 'hubs', label: 'Hubs' },
    { id: 'drops', label: 'Drops' },
    { id: 'buildings', label: 'Connected buildings' },
    { id: 'channel', label: 'Channel path' },
    { id: 'area', label: 'Area query' },
    { id: 'cutExtent', label: 'Cut extent zone' }
];

/**
 * Compact map layer stack for Atlas workspace (V2).
 */
export function AtlasMapLayersPanel({ gisLayers = [], onReorderGisLayer, onAddMapLayer, onToggleGisLayer }) {
    const [overlayOrder, setOverlayOrder] = useState(ATLAS_OVERLAY_LAYERS.map((l) => l.id));

    const orderedOverlays = useMemo(
        () => overlayOrder.map((id) => ATLAS_OVERLAY_LAYERS.find((l) => l.id === id)).filter(Boolean),
        [overlayOrder]
    );

    const moveOverlay = (id, dir) => {
        setOverlayOrder((prev) => {
            const i = prev.indexOf(id);
            if (i < 0) return prev;
            const j = i + dir;
            if (j < 0 || j >= prev.length) return prev;
            const next = [...prev];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    };

    return (
        <CollapsibleSection title="Map layers" bodyId="atlas-map-layers" defaultOpen={false}>
            <div className="atlas-map-layers">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onAddMapLayer}>
                    Add map layer…
                </button>
                <p className="atlas-muted atlas-map-layers__hint">Referral GIS layers</p>
                <ul className="atlas-simple-list">
                    {gisLayers.map((layer, idx) => (
                        <li key={layer.id || idx} className="atlas-map-layer-row">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={layer.visible !== false}
                                    onChange={() => onToggleGisLayer?.(layer.id)}
                                />
                                {' '}
                                {layer.name || layer.id}
                            </label>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReorderGisLayer?.(layer.id, -1)}>↑</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReorderGisLayer?.(layer.id, 1)}>↓</button>
                        </li>
                    ))}
                    {!gisLayers.length && <li className="atlas-muted">No GIS layers loaded</li>}
                </ul>
                <p className="atlas-muted atlas-map-layers__hint">Atlas overlays</p>
                <ul className="atlas-simple-list">
                    {orderedOverlays.map((layer) => (
                        <li key={layer.id} className="atlas-map-layer-row">
                            {layer.label}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveOverlay(layer.id, -1)}>↑</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveOverlay(layer.id, 1)}>↓</button>
                        </li>
                    ))}
                </ul>
            </div>
        </CollapsibleSection>
    );
}

export function useAtlasGisLayers() {
    return getAtlasSnapshot().gisLayers || [];
}
