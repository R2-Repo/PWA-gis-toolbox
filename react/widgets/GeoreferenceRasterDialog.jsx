import { useEffect, useMemo, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import {
    ALIGNMENT_STATUS,
    createGcp,
    formatMeters,
    getAlignmentStatus,
    nextGcpNumber,
    solveAlignment,
    toNormalizedSource,
    transformImageCorners
} from '../../js/widgets/georeference-raster/engine.js';

const STEPS = ['Source', 'Control points', 'Review'];
const ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf';

function gcpNumber(gcps, id) {
    const index = gcps.findIndex((gcp) => gcp.id === id);
    return index >= 0 ? index + 1 : gcps.length;
}

function SourcePreview({
    url,
    displayWidth,
    displayHeight,
    sourceWidth,
    sourceHeight,
    gcps,
    pendingId,
    reviewId,
    placing,
    onSourceClick
}) {
    const viewportRef = useRef(null);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const dragRef = useRef(null);

    useEffect(() => {
        setView({ scale: 1, x: 0, y: 0 });
    }, [url]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return undefined;
        const onWheel = (event) => {
            event.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const cursorX = event.clientX - rect.left;
            const cursorY = event.clientY - rect.top;
            const factor = event.deltaY < 0 ? 1.12 : 0.9;
            setView((current) => {
                const nextScale = Math.min(8, Math.max(0.2, current.scale * factor));
                const ratio = nextScale / current.scale;
                return {
                    scale: nextScale,
                    x: cursorX - (cursorX - current.x) * ratio,
                    y: cursorY - (cursorY - current.y) * ratio
                };
            });
        };
        viewport.addEventListener('wheel', onWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', onWheel);
    }, []);

    const toImagePoint = (clientX, clientY) => {
        const viewport = viewportRef.current;
        if (!viewport) return null;
        const rect = viewport.getBoundingClientRect();
        const x = (clientX - rect.left - view.x) / view.scale;
        const y = (clientY - rect.top - view.y) / view.scale;
        if (x < 0 || y < 0 || x > displayWidth || y > displayHeight) return null;
        return { x, y };
    };

    return (
        <div
            ref={viewportRef}
            className={`georef-widget__preview${placing ? ' georef-widget__preview--placing' : ''}`}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                    /* synthetic or unsupported pointer capture */
                }
                dragRef.current = {
                    moved: false,
                    lastX: event.clientX,
                    lastY: event.clientY
                };
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                const dx = event.clientX - drag.lastX;
                const dy = event.clientY - drag.lastY;
                if (Math.hypot(dx, dy) > 3) drag.moved = true;
                drag.lastX = event.clientX;
                drag.lastY = event.clientY;
                if (drag.moved) {
                    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
                }
            }}
            onPointerUp={(event) => {
                const drag = dragRef.current;
                dragRef.current = null;
                if (!drag || drag.moved) return;
                const point = toImagePoint(event.clientX, event.clientY);
                if (point) onSourceClick?.(point);
            }}
        >
            {url ? (
                <div
                    className="georef-widget__preview-inner"
                    style={{
                        width: displayWidth,
                        height: displayHeight,
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
                    }}
                >
                    <img src={url} alt="Source to georeference" draggable={false} />
                    {gcps.map((gcp) => {
                        const pt = gcp.sourcePx;
                        if (!pt) return null;
                        const number = gcpNumber(gcps, gcp.id);
                        const pending = gcp.id === pendingId;
                        const review = gcp.id === reviewId;
                        const scaleX = (sourceWidth || displayWidth) ? displayWidth / (sourceWidth || displayWidth) : 1;
                        const scaleY = (sourceHeight || displayHeight) ? displayHeight / (sourceHeight || displayHeight) : 1;
                        return (
                            <span
                                key={gcp.id}
                                className={`georef-widget__marker${pending ? ' is-pending' : ''}${review ? ' is-review' : ''}${gcp.enabled === false ? ' is-disabled' : ''}`}
                                style={{ left: pt.x * scaleX, top: pt.y * scaleY }}
                            >
                                {number}
                            </span>
                        );
                    })}
                </div>
            ) : (
                <div className="georef-widget__preview-empty">Load a source to begin</div>
            )}
        </div>
    );
}

export function GeoreferenceRasterDialog({
    existingLayers = [],
    onCancel,
    onLoadFile,
    onSelectPdfPage,
    onLoadExistingLayer,
    onPickMapPoint,
    onCancelMapPick,
    onPreviewAlignment,
    onClearPreview,
    onZoomToMapPoint,
    onBlinkOverlay,
    onCommit
}) {
    const fileRef = useRef(null);
    const [step, setStep] = useState(1);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [pdfMeta, setPdfMeta] = useState(null);
    const [source, setSource] = useState(null);
    const [gcps, setGcps] = useState([]);
    const [pendingId, setPendingId] = useState(null);
    const [reposition, setReposition] = useState(null);
    const [opacity, setOpacity] = useState(0.7);
    const [overlayVisible, setOverlayVisible] = useState(true);
    const [reviewed, setReviewed] = useState(false);
    const [existingId, setExistingId] = useState('');
    const [layerName, setLayerName] = useState('');
    const [editingLayerId, setEditingLayerId] = useState('');

    const alignment = useMemo(() => {
        if (!source?.width || !source?.height) return null;
        return solveAlignment(gcps, { width: source.width, height: source.height });
    }, [gcps, source]);

    const status = useMemo(
        () => getAlignmentStatus(alignment, { reviewed }),
        [alignment, reviewed]
    );

    const coordinates = useMemo(() => {
        if (!alignment?.transform || !source) return null;
        return transformImageCorners(alignment.transform, source.width, source.height);
    }, [alignment, source]);

    const markerGcps = useMemo(
        () => gcps.map((gcp, index) => ({
            ...gcp,
            number: index + 1,
            review: status.worstPointId === gcp.id
        })),
        [gcps, status.worstPointId]
    );

    useEffect(() => {
        if (!source?.workingUrl || !coordinates) {
            onClearPreview?.();
            return;
        }
        onPreviewAlignment?.({
            url: source.workingUrl,
            coordinates,
            opacity,
            visible: overlayVisible,
            gcps: markerGcps
        });
    }, [source?.workingUrl, coordinates, opacity, overlayVisible, markerGcps, onPreviewAlignment, onClearPreview]);

    useEffect(() => {
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            if (pendingId || reposition) {
                event.preventDefault();
                onCancelMapPick?.();
                setPendingId(null);
                setReposition(null);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [pendingId, reposition, onCancelMapPick]);

    const displayWidth = source?.workingWidth || source?.width || 1;
    const displayHeight = source?.workingHeight || source?.height || 1;

    const setSourceFromSnapshot = (snapshot) => {
        setSource(snapshot);
        setLayerName((current) => current || snapshot.name.replace(/\.[^.]+$/, ''));
        setReviewed(false);
    };

    const handleFiles = async (files) => {
        const file = files?.[0];
        if (!file) return;
        setError('');
        setBusy(true);
        try {
            const loaded = await onLoadFile?.(file);
            setGcps([]);
            setPendingId(null);
            setReposition(null);
            setEditingLayerId('');
            setExistingId('');
            if (loaded?.kind === 'pdf') {
                setPdfMeta(loaded);
                setSource(null);
            } else {
                setPdfMeta(null);
                setSourceFromSnapshot(loaded);
            }
        } catch (err) {
            setError(err?.message || 'Could not open that file.');
        } finally {
            setBusy(false);
        }
    };

    const handlePdfPage = async (pageIndex) => {
        setError('');
        setBusy(true);
        try {
            const page = await onSelectPdfPage?.(pageIndex);
            setGcps([]);
            setPendingId(null);
            setSourceFromSnapshot(page);
        } catch (err) {
            setError(err?.message || 'Could not render that page.');
        } finally {
            setBusy(false);
        }
    };

    const handleExisting = async () => {
        if (!existingId) return;
        setError('');
        setBusy(true);
        try {
            const loaded = await onLoadExistingLayer?.(existingId);
            setPdfMeta(null);
            setSourceFromSnapshot(loaded.source);
            setGcps(loaded.gcps || []);
            setEditingLayerId(loaded.layerId);
            setLayerName(loaded.name || '');
            setPendingId(null);
        } catch (err) {
            setError(err?.message || 'Could not reopen that layer.');
        } finally {
            setBusy(false);
        }
    };

    const completeMapSide = (gcpId, mapLngLat) => {
        setGcps((current) => current.map((gcp) => (
            gcp.id === gcpId ? { ...gcp, mapLngLat } : gcp
        )));
        setPendingId(null);
        setReposition(null);
        setReviewed(false);
    };

    const pickMap = async (gcpId, prompt) => {
        setPendingId(gcpId);
        const point = await onPickMapPoint?.(prompt);
        if (!point) {
            setPendingId(null);
            return;
        }
        completeMapSide(gcpId, point);
    };

    const handleSourceClick = async (displayPoint) => {
        if (!source) return;
        const scaleX = source.width / displayWidth;
        const scaleY = source.height / displayHeight;
        const sourcePx = { x: displayPoint.x * scaleX, y: displayPoint.y * scaleY };
        const sourceNorm = toNormalizedSource(sourcePx, source.width, source.height);

        if (reposition?.side === 'source') {
            setGcps((current) => current.map((gcp) => (
                gcp.id === reposition.id ? { ...gcp, sourcePx, sourceNorm } : gcp
            )));
            setReposition(null);
            setReviewed(false);
            return;
        }

        if (pendingId && !reposition) {
            setGcps((current) => current.map((gcp) => (
                gcp.id === pendingId ? { ...gcp, sourcePx, sourceNorm } : gcp
            )));
            return;
        }

        const next = createGcp({
            id: `gcp-${nextGcpNumber(gcps)}`,
            sourcePx,
            sourceNorm
        });
        setGcps((current) => [...current, next]);
        await pickMap(next.id, 'Now click the same location on the map.');
    };

    const instruction = (() => {
        if (reposition?.side === 'source') return `Click a new source location for Point ${gcpNumber(gcps, reposition.id)}.`;
        if (reposition?.side === 'map' || pendingId) return 'Now click the same location on the map.';
        return 'Click a recognizable point on the source, then the same place on the map.';
    })();

    const canAdvanceSource = !!(source?.workingUrl);
    const canCommit = status.code === ALIGNMENT_STATUS.READY_ADD
        || (status.code === ALIGNMENT_STATUS.READY_REVIEW && reviewed)
        || (alignment?.ok && reviewed);

    const footerForStep = () => {
        if (step === 1) {
            return (
                <div className="modal-footer">
                    <button className="btn btn-secondary cancel-btn" type="button" onClick={onCancel}>Cancel</button>
                    <button
                        className="btn btn-primary apply-btn"
                        type="button"
                        disabled={!canAdvanceSource || busy}
                        onClick={() => setStep(2)}
                    >
                        Next
                    </button>
                </div>
            );
        }
        if (step === 2) {
            return (
                <div className="modal-footer">
                    <button className="btn btn-secondary cancel-btn" type="button" onClick={() => setStep(1)}>Back</button>
                    <button
                        className="btn btn-primary apply-btn"
                        type="button"
                        disabled={!alignment?.ok}
                        onClick={() => {
                            setReviewed(true);
                            setStep(3);
                        }}
                    >
                        Review
                    </button>
                </div>
            );
        }
        return (
            <div className="modal-footer">
                <button className="btn btn-secondary cancel-btn" type="button" onClick={() => setStep(2)}>Back</button>
                <button
                    className="btn btn-primary apply-btn"
                    type="button"
                    disabled={!canCommit || busy}
                    onClick={async () => {
                        setError('');
                        setBusy(true);
                        try {
                            await onCommit?.({
                                name: layerName,
                                gcps,
                                reviewed: true,
                                layerId: editingLayerId || undefined
                            });
                        } catch (err) {
                            setError(err?.message || 'Could not add the image to the map.');
                            setBusy(false);
                        }
                    }}
                >
                    {busy ? 'Adding…' : 'Add to Map'}
                </button>
            </div>
        );
    };

    return (
        <WidgetPanelShell
            className="georef-widget"
            onCancel={onCancel}
            showRun={false}
            footer={footerForStep()}
            status={error}
            statusTone="danger"
        >
            <WidgetStepWizard steps={STEPS} currentStep={step} variant="compact" />

            {step === 1 ? (
                <>
                    <div
                        className={`drop-zone${busy ? ' disabled' : ''}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            event.currentTarget.classList.add('dragover');
                        }}
                        onDragLeave={(event) => event.currentTarget.classList.remove('dragover')}
                        onDrop={(event) => {
                            event.preventDefault();
                            event.currentTarget.classList.remove('dragover');
                            handleFiles(Array.from(event.dataTransfer.files || []));
                        }}
                        onClick={() => fileRef.current?.click()}
                    >
                        <p>{busy ? 'Opening…' : 'Drop a PNG, JPEG, WebP, or PDF — or click to browse'}</p>
                        <input
                            ref={fileRef}
                            type="file"
                            accept={ACCEPT}
                            hidden
                            onChange={(event) => handleFiles(Array.from(event.target.files || []))}
                        />
                    </div>

                    {existingLayers.length ? (
                        <LayerSelect
                            label="Or reopen a georeferenced layer"
                            value={existingId}
                            onChange={setExistingId}
                            layers={existingLayers}
                            placeholder="- select layer -"
                            formatOption={(layer) => layer.name}
                            selectExtra={(
                                <button type="button" className="btn btn-sm" disabled={!existingId || busy} onClick={handleExisting}>
                                    Open
                                </button>
                            )}
                        />
                    ) : null}

                    {pdfMeta ? (
                        <div className="form-group">
                            <label>{pdfMeta.name} — {pdfMeta.pageCount} page{pdfMeta.pageCount === 1 ? '' : 's'}</label>
                            <div className="georef-widget__thumbs">
                                {pdfMeta.thumbnails.map((thumb) => (
                                    <button
                                        key={thumb.pageIndex}
                                        type="button"
                                        className={`georef-widget__thumb${source?.pageIndex === thumb.pageIndex ? ' is-active' : ''}`}
                                        onClick={() => handlePdfPage(thumb.pageIndex)}
                                    >
                                        <img src={thumb.url} alt={`Page ${thumb.pageIndex + 1}`} />
                                        <span>{thumb.pageIndex + 1}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {source ? (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {source.name}
                            {source.kind === 'pdf-page' ? ` · page ${source.pageIndex + 1}` : ''}
                            {` · ${source.width}×${source.height} px`}
                        </div>
                    ) : null}
                </>
            ) : null}

            {step > 1 && source ? (
                <>
                    <p className="georef-widget__instruction">{instruction}</p>
                    <SourcePreview
                        url={source.workingUrl}
                        displayWidth={displayWidth}
                        displayHeight={displayHeight}
                        sourceWidth={source.width}
                        sourceHeight={source.height}
                        gcps={gcps}
                        pendingId={pendingId}
                        reviewId={status.worstPointId}
                        placing={!pendingId || reposition?.side === 'source'}
                        onSourceClick={handleSourceClick}
                    />
                    <div className="georef-widget__points">
                        {gcps.length === 0 ? (
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>No control points yet.</div>
                        ) : gcps.map((gcp, index) => {
                            const complete = !!(gcp.sourcePx && gcp.mapLngLat);
                            const residual = alignment?.gcps?.find((item) => item.id === gcp.id)?.residualMeters;
                            return (
                                <div key={gcp.id} className="georef-widget__point-row">
                                    <span>
                                        Point {index + 1}
                                        {' · '}
                                        {!complete && pendingId === gcp.id ? 'Pending map' : complete ? 'Complete' : 'Incomplete'}
                                        {Number.isFinite(residual) ? ` · ${formatMeters(residual)}` : ''}
                                        {gcp.enabled === false ? ' · Off' : ''}
                                    </span>
                                    <span className="georef-widget__point-actions">
                                        <button type="button" className="gis-widget__link-btn" onClick={() => {
                                            setReposition({ id: gcp.id, side: 'source' });
                                            setPendingId(null);
                                            onCancelMapPick?.();
                                        }}>
                                            Move source
                                        </button>
                                        <button type="button" className="gis-widget__link-btn" onClick={() => {
                                            setReposition({ id: gcp.id, side: 'map' });
                                            pickMap(gcp.id, `Click a new map location for Point ${index + 1}.`);
                                        }}>
                                            Move map
                                        </button>
                                        {gcp.mapLngLat ? (
                                            <button type="button" className="gis-widget__link-btn" onClick={() => onZoomToMapPoint?.(gcp.mapLngLat)}>
                                                Zoom
                                            </button>
                                        ) : null}
                                        <button type="button" className="gis-widget__link-btn" onClick={() => {
                                            setGcps((current) => current.map((item) => (
                                                item.id === gcp.id ? { ...item, enabled: item.enabled === false } : item
                                            )));
                                            setReviewed(false);
                                        }}>
                                            {gcp.enabled === false ? 'Enable' : 'Disable'}
                                        </button>
                                        <button type="button" className="gis-widget__link-btn" onClick={() => {
                                            if (pendingId === gcp.id) onCancelMapPick?.();
                                            setGcps((current) => current.filter((item) => item.id !== gcp.id));
                                            setPendingId((current) => current === gcp.id ? null : current);
                                            setReviewed(false);
                                        }}>
                                            Delete
                                        </button>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                                onCancelMapPick?.();
                                setGcps((current) => current.slice(0, -1));
                                setPendingId(null);
                                setReposition(null);
                                setReviewed(false);
                            }}
                            disabled={!gcps.length}
                        >
                            Undo last
                        </button>
                    </div>
                </>
            ) : null}

            {step === 3 ? (
                <div className="georef-widget__review">
                    <div className="georef-widget__status-line">
                        <strong>{status.label}</strong>
                        <span>{status.detail}</span>
                        {Number.isFinite(alignment?.rmsResidualMeters) ? (
                            <span>RMS {formatMeters(alignment.rmsResidualMeters)}</span>
                        ) : null}
                    </div>
                    <label className="georef-widget__opacity">
                        Overlay opacity
                        <input
                            type="range"
                            min="0.15"
                            max="1"
                            step="0.05"
                            value={opacity}
                            onChange={(event) => setOpacity(Number(event.target.value))}
                        />
                    </label>
                    <div className="gis-widget__btn-row">
                        <button type="button" className="btn btn-sm" onClick={() => setOverlayVisible((value) => !value)}>
                            {overlayVisible ? 'Hide overlay' : 'Show overlay'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => onBlinkOverlay?.({
                                url: source.workingUrl,
                                coordinates,
                                opacity,
                                gcps: markerGcps
                            })}
                            disabled={!coordinates}
                        >
                            Blink
                        </button>
                    </div>
                    <div className="form-group">
                        <label>Layer name</label>
                        <input value={layerName} onChange={(event) => setLayerName(event.target.value)} />
                    </div>
                    <label className="georef-widget__check">
                        <input
                            type="checkbox"
                            checked={reviewed}
                            onChange={(event) => setReviewed(event.target.checked)}
                        />
                        I reviewed the overlay on the map
                    </label>
                </div>
            ) : null}
        </WidgetPanelShell>
    );
}
