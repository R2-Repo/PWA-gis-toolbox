import { useEffect, useRef, useState } from 'react';
import {
    headerPdfDownloadOptions,
    readWidgetProjectName,
    defaultHeaderPdfTitle
} from '../../js/map/header-print-pdf.js';
import { serializeWidgetStore } from '../../js/widgets/widget-state-store.js';

function projectTitleDefault() {
    return defaultHeaderPdfTitle(readWidgetProjectName(serializeWidgetStore().activeWidgets));
}

export function MapPrintMenu({ onExportMapView, onPresentationLink, disabled = false }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [pageSize, setPageSize] = useState('letter');
    const [title, setTitle] = useState('Map');
    const wrapperRef = useRef(null);
    const titleTouched = useRef(false);

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

    useEffect(() => {
        if (!open || titleTouched.current) return;
        setTitle(projectTitleDefault());
    }, [open]);

    const handleExport = async (format, options) => {
        setOpen(false);
        if (busy || !onExportMapView) return;
        setBusy(true);
        try {
            await onExportMapView(format, options);
        } finally {
            setBusy(false);
        }
    };

    const handlePdf = () => {
        const projectName = readWidgetProjectName(serializeWidgetStore().activeWidgets);
        const options = headerPdfDownloadOptions({ pageSize, title, projectName });
        return handleExport('pdf', options);
    };

    return (
        <div className="header-print-menu" ref={wrapperRef}>
            <button
                type="button"
                className="btn btn-ghost btn-sm"
                id="btn-print-map"
                title="Download map as PNG, PDF, or orbit GIF"
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
                <div className="header-print-pdf">
                    <div className="header-print-pdf-label">Page size</div>
                    <div className="header-print-size" role="group" aria-label="Page size">
                        <button
                            type="button"
                            className={`header-print-size-btn${pageSize === 'letter' ? ' active' : ''}`}
                            aria-pressed={pageSize === 'letter'}
                            onClick={() => setPageSize('letter')}
                        >
                            Letter
                        </button>
                        <button
                            type="button"
                            className={`header-print-size-btn${pageSize === 'tabloid' ? ' active' : ''}`}
                            aria-pressed={pageSize === 'tabloid'}
                            onClick={() => setPageSize('tabloid')}
                        >
                            Tabloid
                        </button>
                    </div>
                    <label className="header-print-pdf-label" htmlFor="header-pdf-title">
                        Title
                        <input
                            id="header-pdf-title"
                            type="text"
                            value={title}
                            onChange={(e) => {
                                titleTouched.current = true;
                                setTitle(e.target.value);
                            }}
                        />
                    </label>
                </div>
                <button
                    type="button"
                    className="header-print-item"
                    onClick={() => { void handlePdf(); }}
                >
                    Download PDF
                </button>
                <button
                    type="button"
                    className="header-print-item"
                    onClick={() => { void handleExport('gif'); }}
                >
                    Download Orbit GIF
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
                    <span className="badge badge-warning geo-tool-badge">Beta</span>
                </button>
            </div>
        </div>
    );
}
