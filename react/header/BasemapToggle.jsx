import { useEffect, useRef, useState } from 'react';
import {
    BASEMAP_CATEGORIES,
    getBasemapCategory,
    getCategoryDefaultKey
} from '../../js/map/basemap-catalog.js';
import { BasemapToneMenu } from './BasemapToneMenu.jsx';

function BasemapSegment({ category, config, currentBasemap, openMenu, onOpenChange, onBasemapChange }) {
    const wrapperRef = useRef(null);
    const isActive = getBasemapCategory(currentBasemap) === category;
    const isOpen = openMenu === category;

    useEffect(() => {
        if (!isOpen) return undefined;
        const closeDropdown = (e) => {
            if (!wrapperRef.current?.contains(e.target)) {
                onOpenChange(null);
            }
        };
        document.addEventListener('click', closeDropdown);
        return () => document.removeEventListener('click', closeDropdown);
    }, [isOpen, onOpenChange]);

    return (
        <div
            className={`header-toggle-segment${isActive ? ' active' : ''}`}
            data-category={category}
            ref={wrapperRef}
        >
            <button
                type="button"
                className="header-toggle-option-main"
                data-category={category}
                data-value={config.defaultKey}
                onClick={() => onBasemapChange?.(getCategoryDefaultKey(category))}
            >
                {config.icon} {config.label}
            </button>
            <button
                type="button"
                className="header-toggle-caret"
                title={`More ${config.label.toLowerCase()} basemaps`}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                onClick={(e) => {
                    e.stopPropagation();
                    onOpenChange(isOpen ? null : category);
                }}
            >
                ▾
            </button>
            <div className={`header-basemap-dropdown header-print-dropdown${isOpen ? ' open' : ''}`}>
                {config.options.map((option) => (
                    <button
                        key={option.key}
                        type="button"
                        className={`header-print-item header-basemap-item${currentBasemap === option.key ? ' active' : ''}`}
                        data-value={option.key}
                        onClick={() => {
                            onOpenChange(null);
                            onBasemapChange?.(option.key);
                        }}
                    >
                        {currentBasemap === option.key ? '● ' : '○ '}
                        {option.name}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function BasemapToggle({
    basemap = 'voyager',
    onBasemapChange,
    tone = { tint: 'default', opacity: 1 },
    onToneChange
}) {
    const [openMenu, setOpenMenu] = useState(null);

    return (
        <div className="header-toggle header-basemap-toggle" id="basemap-toggle">
            {Object.entries(BASEMAP_CATEGORIES).map(([category, config]) => (
                <BasemapSegment
                    key={category}
                    category={category}
                    config={config}
                    currentBasemap={basemap}
                    openMenu={openMenu}
                    onOpenChange={setOpenMenu}
                    onBasemapChange={onBasemapChange}
                />
            ))}
            <BasemapToneMenu
                tone={tone}
                onToneChange={onToneChange}
                open={openMenu === 'tone'}
                onOpenChange={(nextOpen) => setOpenMenu(nextOpen ? 'tone' : null)}
            />
        </div>
    );
}
