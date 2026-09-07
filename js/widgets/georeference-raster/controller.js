import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import { saveSourceFile, getSourceFile } from '../../workspace/source-file-store.js';
import {
    GEOREF_FORMAT,
    GEOREF_TYPE,
    buildGeoreferenceRecord,
    solveAlignment,
    transformImageCorners
} from './engine.js';
import {
    buildGeorefBoundsGeojson,
    buildGeorefRasterPayload,
    getGeoreferenceRaster,
    getGeoreferenceRecord,
    isGeoreferencedImageLayer,
    listGeoreferencedImageLayers
} from './georef-layer.js';
import { detectGeorefFileKind, disposeSource, loadImageSource } from './source-loader.js';
import { openPdfSource, rasterizePdfPage } from './pdf-source.js';

function snapshotSource(source) {
    if (!source) return null;
    return {
        kind: source.kind,
        name: source.name,
        mime: source.mime,
        width: source.width,
        height: source.height,
        workingWidth: source.workingWidth,
        workingHeight: source.workingHeight,
        workingUrl: source.workingUrl,
        pageIndex: source.pageIndex ?? 0,
        pageCount: source.pageCount ?? 1,
        fingerprint: source.fingerprint,
        thumbnails: (source.thumbnails || []).map((thumb) => ({
            pageIndex: thumb.pageIndex,
            url: thumb.url,
            width: thumb.width,
            height: thumb.height
        }))
    };
}

function rasterFileName(source) {
    const base = String(source?.name || 'georef').replace(/\.[^.]+$/, '');
    const page = Number.isFinite(source?.pageIndex) && source.kind !== 'image'
        ? `-p${source.pageIndex + 1}`
        : '';
    return `${base}${page}.png`.replace(/[<>:"/\\|?*]+/g, '-');
}

export async function openGeoreferenceRaster(ctx) {
    const runtime = {
        imageSource: null,
        pdfSource: null,
        pageSource: null,
        pickGen: 0,
        blinkTimer: null
    };

    const existingLayers = () => listGeoreferencedImageLayers(ctx.getLayers() || []).map((layer) => ({
        id: layer.id,
        name: layer.name
    }));

    const activeSource = () => runtime.pageSource || runtime.imageSource;

    const disposeRuntimeSources = ({ keepPdf = false } = {}) => {
        disposeSource(runtime.pageSource);
        runtime.pageSource = null;
        disposeSource(runtime.imageSource);
        runtime.imageSource = null;
        if (!keepPdf) {
            disposeSource(runtime.pdfSource);
            runtime.pdfSource = null;
        }
    };

    const stopBlink = () => {
        if (runtime.blinkTimer) {
            clearInterval(runtime.blinkTimer);
            runtime.blinkTimer = null;
        }
    };

    const cleanup = () => {
        runtime.pickGen += 1;
        stopBlink();
        ctx.mapService.cancelInteraction?.();
        ctx.mapService.clearGeoreferencePreview?.();
        disposeRuntimeSources();
    };

    const previewAlignment = (payload) => {
        ctx.mapService.showGeoreferencePreview?.({
            url: payload.url,
            coordinates: payload.coordinates,
            opacity: payload.opacity,
            visible: payload.visible,
            gcps: payload.gcps
        });
    };

    await openReactIsland({
        title: 'Georeference Image / PDF',
        width: '800px',
        fillPanel: true,
        mountPath: '../../../react/widgets/mountGeoreferenceRasterDialog.jsx',
        mountExport: 'mountGeoreferenceRasterDialog',
        onOverlayDestroy: cleanup,
        getProps: (close) => ({
            existingLayers: existingLayers(),
            onCancel: () => {
                cleanup();
                close();
            },
            onLoadFile: async (file) => {
                const kind = detectGeorefFileKind(file);
                if (!kind) {
                    throw new Error('Use a PNG, JPEG, WebP, or PDF file.');
                }
                return withActivity(kind === 'pdf' ? 'Opening PDF…' : 'Opening image…', async () => {
                    disposeRuntimeSources();
                    if (kind === 'pdf') {
                        runtime.pdfSource = await openPdfSource(file);
                        return {
                            kind: 'pdf',
                            name: runtime.pdfSource.name,
                            pageCount: runtime.pdfSource.pageCount,
                            thumbnails: snapshotSource({
                                ...runtime.pdfSource,
                                width: 0,
                                height: 0,
                                workingWidth: 0,
                                workingHeight: 0,
                                workingUrl: ''
                            }).thumbnails
                        };
                    }
                    runtime.imageSource = await loadImageSource(file);
                    return snapshotSource(runtime.imageSource);
                });
            },
            onSelectPdfPage: async (pageIndex) => {
                if (!runtime.pdfSource) throw new Error('Open a PDF first.');
                return withActivity('Rendering page…', async () => {
                    disposeSource(runtime.pageSource);
                    runtime.pageSource = await rasterizePdfPage(runtime.pdfSource, pageIndex);
                    return snapshotSource(runtime.pageSource);
                });
            },
            onLoadExistingLayer: async (layerId) => {
                const layer = ctx.getLayerById?.(layerId) || ctx.getLayers().find((item) => item.id === layerId);
                if (!isGeoreferencedImageLayer(layer)) {
                    throw new Error('That layer is not a georeferenced image.');
                }
                const record = getGeoreferenceRecord(layer);
                const raster = getGeoreferenceRaster(layer);
                let file = null;
                if (layer.source?.opfsKey) {
                    file = await getSourceFile(layer.source.opfsKey);
                }
                if (!file && raster?.url) {
                    try {
                        const res = await fetch(raster.url);
                        const blob = await res.blob();
                        file = new File(
                            [blob],
                            record?.sourceName || `${layer.name}.png`,
                            { type: blob.type || raster.mime || 'image/png' }
                        );
                    } catch {
                        file = null;
                    }
                }
                if (!file) {
                    throw new Error('The original image is not available. Load the file again.');
                }
                disposeRuntimeSources();
                runtime.imageSource = await loadImageSource(file, {
                    pageIndex: record?.pageIndex ?? 0
                });
                const source = snapshotSource(runtime.imageSource);
                return {
                    layerId: layer.id,
                    name: layer.name,
                    source,
                    gcps: record?.gcps || []
                };
            },
            onPickMapPoint: async (prompt) => {
                runtime.pickGen += 1;
                const gen = runtime.pickGen;
                const coord = await ctx.mapService.startPointPick(prompt || 'Click the same location on the map');
                if (gen !== runtime.pickGen) return null;
                if (!coord) return null;
                return { lng: coord[0], lat: coord[1] };
            },
            onCancelMapPick: () => {
                runtime.pickGen += 1;
                ctx.mapService.cancelInteraction?.();
            },
            onPreviewAlignment: (payload) => {
                previewAlignment(payload);
            },
            onClearPreview: () => {
                stopBlink();
                ctx.mapService.clearGeoreferencePreview?.();
            },
            onZoomToMapPoint: (lngLat) => {
                if (!lngLat) return;
                const pad = 0.0008;
                ctx.mapService.fitBounds?.(
                    [[lngLat.lng - pad, lngLat.lat - pad], [lngLat.lng + pad, lngLat.lat + pad]],
                    { padding: 60, maxZoom: 18 }
                );
            },
            onBlinkOverlay: ({ url, coordinates, opacity, gcps }) => {
                stopBlink();
                let visible = true;
                let ticks = 0;
                runtime.blinkTimer = setInterval(() => {
                    visible = !visible;
                    previewAlignment({ url, coordinates, opacity, visible, gcps });
                    ticks += 1;
                    if (ticks >= 6) {
                        stopBlink();
                        previewAlignment({ url, coordinates, opacity, visible: true, gcps });
                    }
                }, 280);
            },
            onCommit: async ({ name, gcps, reviewed, layerId }) => {
                const source = activeSource();
                if (!source?.workingUrl) {
                    throw new Error('Load an image or PDF page first.');
                }
                const alignment = solveAlignment(gcps, {
                    width: source.width,
                    height: source.height
                });
                if (!alignment.ok || !alignment.transform) {
                    throw new Error(alignment.error || 'Add at least three well-spaced points.');
                }
                const coordinates = transformImageCorners(
                    alignment.transform,
                    source.width,
                    source.height
                );
                const record = buildGeoreferenceRecord(alignment, {
                    name: source.name,
                    sourceName: source.name,
                    width: source.width,
                    height: source.height,
                    pageIndex: source.pageIndex,
                    fingerprint: source.fingerprint
                }, alignment.gcps || gcps);
                const layerUrl = source.workingBlob
                    ? URL.createObjectURL(source.workingBlob)
                    : source.workingUrl;
                const raster = buildGeorefRasterPayload({
                    url: layerUrl,
                    mime: source.mime || 'image/png',
                    width: source.width,
                    height: source.height,
                    coordinates,
                    file: rasterFileName(source)
                });
                const layerName = name || source.name.replace(/\.[^.]+$/, '') || 'Georeferenced_Image';
                const bounds = buildGeorefBoundsGeojson(coordinates, { name: layerName });
                const existing = layerId
                    ? (ctx.getLayerById?.(layerId) || ctx.getLayers().find((item) => item.id === layerId))
                    : null;
                const layerSource = {
                    format: GEOREF_FORMAT,
                    georeferenceType: GEOREF_TYPE,
                    file: source.name,
                    widget: 'georeference-raster',
                    georeference: record,
                    georeferenceRaster: raster,
                    ...(existing?.source?.opfsKey ? { opfsKey: existing.source.opfsKey } : {})
                };

                const dataset = existing || ctx.createSpatialDataset(layerName, bounds, layerSource);
                if (existing) {
                    existing.name = layerName;
                    existing.geojson = bounds;
                    existing.source = { ...(existing.source || {}), ...layerSource };
                }

                const persistFile = source.kind === 'image' && source.file instanceof File
                    ? source.file
                    : (source.workingBlob
                        ? new File([source.workingBlob], raster.file, { type: source.workingBlob.type || 'image/png' })
                        : null);
                const opfsKey = dataset.source.opfsKey || `georef-${dataset.id}`;
                if (persistFile) {
                    const saved = await saveSourceFile(opfsKey, persistFile);
                    if (saved.ok) dataset.source.opfsKey = opfsKey;
                }

                if (!existing) ctx.addLayer(dataset);
                const index = ctx.getLayers().indexOf(dataset);
                if (ctx.mapService.addGeoreferencedImageLayer) {
                    ctx.mapService.addGeoreferencedImageLayer(dataset, index, { fit: true });
                } else {
                    ctx.mapService.addLayer(dataset, index, { fit: true });
                }
                ctx.setActiveLayer?.(dataset.id);
                ctx.refreshUI?.();
                ctx.showToast?.(
                    existing ? 'Georeferenced image updated' : 'Georeferenced image added to the map',
                    'success'
                );
                cleanup();
                close();
                return { layerId: dataset.id, reviewed: reviewed === true };
            }
        })
    });
}

export default { openGeoreferenceRaster };
