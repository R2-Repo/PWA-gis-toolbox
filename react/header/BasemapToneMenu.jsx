import { useEffect, useRef, useState } from 'react';
import { BASEMAP_OPACITY_MAX, BASEMAP_OPACITY_MIN } from '../../js/map/basemap-tone.js';

const TINT_OPTIONS = [
    { value: 'light', label: 'Lighter' },
    { value: 'default', label: 'Default' },
    { value: 'dark', label: 'Darker' }
];

function formatOpacity(value) {
    return `${Math.round(value * 100)}%`;
}

export function BasemapToneMenu({
    tone = { tint: 'default', opacity: 1 },
    onToneChange,
    disabled = false
}) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const closeDropdown = (e) => {
            if (!wrapperRef.current?.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('click', closeDropdown);
        return () => document.removeEventListener('click', closeDropdown);
    }, [open]);

    const handleTintChange = (tint) => {
        onToneChange?.({ tint, opacity: tone.opacity });
    };

    const handleOpacityChange = (opacity) => {
        onToneChange?.({ tint: tone.tint, opacity });
    };

    return (
        <div className="header-print-menu header-basemap-tone-menu" ref={wrapperRef}>
            <button
                type="button"
                className="btn btn-ghost btn-sm"
                id="btn-basemap-tone"
                title="Adjust basemap brightness"
                disabled={disabled}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((value) => !value);
                }}
            >
                Tone ▾
            </button>
            <div className={`header-print-dropdown header-basemap-tone-panel${open ? ' open' : ''}`} id="basemap-tone-dropdown">
                <div className="header-basemap-tone-section">
                    <span className="header-basemap-tone-label">Map tone</span>
                    <div className="header-toggle header-basemap-tone-toggle">
                        {TINT_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                className={`header-toggle-option${tone.tint === option.value ? ' active' : ''}`}
                                onClick={() => handleTintChange(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="style-row header-basemap-tone-slider">
                    <label htmlFor="basemap-tone-opacity">Basemap opacity</label>
                    <input
                        id="basemap-tone-opacity"
                        type="range"
                        className="style-range"
                        min={BASEMAP_OPACITY_MIN}
                        max={BASEMAP_OPACITY_MAX}
                        step="0.01"
                        value={tone.opacity}
                        onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                    />
                    <span className="style-value">{formatOpacity(tone.opacity)}</span>
                </div>
            </div>
        </div>
    );
}
