import { useEffect, useRef, useState } from 'react';

const OPTIONS = [
    { value: 'full', label: 'Full', hint: 'Layer name and all attributes' },
    { value: 'minimal', label: 'Minimal', hint: 'Layer name and feature title only' },
    { value: 'off', label: 'Off', hint: 'No popups on map click' }
];

const BUTTON_LABELS = {
    full: 'Popups ▾',
    minimal: 'Popups ··· ▾',
    off: 'Popups ✕ ▾'
};

export function PopupModeMenu({ mode = 'full', onModeChange, disabled = false }) {
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

    return (
        <div className="header-print-menu header-popup-mode-menu" ref={wrapperRef}>
            <button
                type="button"
                className="btn btn-ghost btn-sm"
                id="btn-popup-mode"
                title="Popup display mode for all map layers"
                disabled={disabled}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((value) => !value);
                }}
            >
                {BUTTON_LABELS[mode] || BUTTON_LABELS.full}
            </button>
            <div className={`header-print-dropdown${open ? ' open' : ''}`} id="popup-mode-dropdown">
                {OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={`header-print-item header-popup-mode-item${mode === option.value ? ' active' : ''}`}
                        onClick={() => {
                            setOpen(false);
                            onModeChange?.(option.value);
                        }}
                    >
                        <span className="header-popup-mode-item-label">
                            {mode === option.value ? '● ' : '○ '}
                            {option.label}
                        </span>
                        <span className="header-popup-mode-item-hint">{option.hint}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
