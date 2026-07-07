import { ImportOptionCard } from './ImportOptionCard.jsx';

const CATEGORY_ICONS = {
    Reference: '📍',
    Hazards: '⚠️',
    Wildfire: '🔥',
    Global: '🌍',
    Custom: '✏️'
};

function presetIcon(preset) {
    if (preset.icon) return preset.icon;
    if (preset.category && CATEGORY_ICONS[preset.category]) return CATEGORY_ICONS[preset.category];
    return '🗺️';
}

export function LiveMapPresetPicker({
    presets = [],
    onBuildPresetShareUrl,
    onCreateYourOwn
}) {
    const openPreset = (presetId) => {
        const url = onBuildPresetShareUrl?.(presetId);
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="live-map-preset-picker">
            <p className="import-option-hint mb-8">
                Open a curated live map in a new tab, or build your own.
            </p>
            <div className="import-option-grid">
                {presets.map((preset) => (
                    <ImportOptionCard
                        key={preset.id}
                        icon={presetIcon(preset)}
                        title={preset.name}
                        description={preset.description || 'Curated live map'}
                        badge={preset.category || null}
                        onClick={() => openPreset(preset.id)}
                    />
                ))}
                <ImportOptionCard
                    icon="✏️"
                    title="Create your own"
                    description="Build a custom live map with your own service URLs"
                    onClick={() => onCreateYourOwn?.()}
                />
            </div>
        </div>
    );
}
