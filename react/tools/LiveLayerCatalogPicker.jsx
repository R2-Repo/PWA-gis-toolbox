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
    onAddCatalogLiveLayer,
    desktopUdotFiber = null
}) {
    const syncMeta = desktopUdotFiber?.syncMeta;
    const lastSync = syncMeta?.lastSyncAt || syncMeta?.last_sync_at;
    const syncLabel = lastSync
        ? `Last synced ${new Date(lastSync).toLocaleString()}`
        : 'Not synced yet';

    return (
        <div className="live-layer-catalog-picker">
            <p className="import-option-hint mb-8">
                Add pre-styled live service layers to your current map.
                Features load for the viewport and can be selected, measured, and used in GIS tools.
            </p>
            {desktopUdotFiber?.available ? (
                <div className="mb-8" style={{ border: '1px solid var(--border, #334155)', borderRadius: 6, padding: 10 }}>
                    <div className="text-xs mb-4"><strong>Desktop — UDOT Fiber SQLite</strong></div>
                    <p className="import-option-hint mb-8" style={{ margin: 0 }}>
                        {syncLabel}
                        {syncMeta?.lastError ? ` · Last error: ${syncMeta.lastError}` : ''}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={desktopUdotFiber.busy}
                            onClick={() => desktopUdotFiber.onSync?.(false)}
                        >
                            Sync if stale (24h)
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={desktopUdotFiber.busy}
                            onClick={() => desktopUdotFiber.onSync?.(true)}
                        >
                            Force sync now
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={desktopUdotFiber.busy}
                            onClick={() => desktopUdotFiber.onLoadLocal?.()}
                        >
                            Add from local DB
                        </button>
                    </div>
                </div>
            ) : null}
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
