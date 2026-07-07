import { ImportOptionCard } from './ImportOptionCard.jsx';

const CATEGORY_ICONS = {
    Reference: '📍',
    Hazards: '⚠️',
    Wildfire: '🔥',
    Global: '🌍',
    Custom: '✏️'
};

function layerIcon(layer) {
    if (layer.icon) return layer.icon;
    if (layer.category && CATEGORY_ICONS[layer.category]) return CATEGORY_ICONS[layer.category];
    return '🛰️';
}

export function LiveLayerCatalogPicker({
    layers = [],
    onAddCatalogLiveLayer
}) {
    return (
        <div className="live-layer-catalog-picker">
            <p className="import-option-hint mb-8">
                Add pre-styled live service layers to your current map.
            </p>
            <div className="import-option-grid">
                {layers.map((layer) => (
                    <ImportOptionCard
                        key={layer.id}
                        icon={layerIcon(layer)}
                        title={layer.name}
                        description={layer.description || 'Curated live layer'}
                        badge={layer.category || null}
                        onClick={() => onAddCatalogLiveLayer?.(layer.id)}
                    />
                ))}
            </div>
        </div>
    );
}
