import { useEffect, useRef, useState } from 'react';

export function MapPrintMenu({ onExportMapView, onPresentationLink, disabled = false }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
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

    const handleExport = async (format) => {
        setOpen(false);
        if (busy || !onExportMapView) return;
        setBusy(true);
        try {
            await onExportMapView(format);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="header-print-menu" ref={wrapperRef}>
            <button
                type="button"
                className="btn btn-ghost btn-sm"
                id="btn-print-map"
                title="Download map as PNG or PDF"
                disabled={disabled || busy}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((value) => !value);
                }}
            >
                {busy ? '…' : '🖨️ Print ▾'}
            </button>
            <div className={`header-print-dropdown${open ? ' open' : ''}`} id="map-print-dropdown">
                <button
                    type="button"
                    className="header-print-item"
                    onClick={() => { void handleExport('png'); }}
                >
                    Download PNG
                </button>
                <button
                    type="button"
                    className="header-print-item"
                    onClick={() => { void handleExport('pdf'); }}
                >
                    Download PDF
                </button>
                <button
                    type="button"
                    className="header-print-item"
                    onClick={() => {
                        setOpen(false);
                        onPresentationLink?.();
                    }}
                >
                    Presentation Link
                </button>
            </div>
        </div>
    );
}
