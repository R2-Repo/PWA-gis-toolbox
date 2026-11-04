/**
 * Dual Screen map bridge.
 * One proxy forwards map-service calls as { method, args } deltas.
 * Every public method is either forwarded or listed as local-only.
 */
import bus from '../core/event-bus.js';
import { blobToDataUrl } from '../core/coverage-raster-layer.js';
import { isPmTilesLayer } from '../core/data-model.js';
import { publishPmtilesDataset } from '../map/pmtiles-protocol.js';
import { initSelectionShortcuts } from '../map/selection-shortcuts.js';
import { MessageType } from './protocol.js';

/** @param {string} message */
export function warnDualScreenDev(message) {
    let dev = false;
    try {
        dev = import.meta.env?.DEV === true;
    } catch {
        dev = false;
    }
    if (dev) console.warn(message);
}

/**
 * Map calls that run on the popup. Results that the caller waits on use MAP_RPC.
 * Everything else is a one-way MAP_CMD. Both go through forwardMapCall.
 */
export const FORWARDED_MAP_METHODS = new Set([
    'addLayer',
    'addLayerIncremental',
    'addWorkspaceLayer',
    'addServiceLayer',
    'removeServiceLayer',
    'refreshServiceLayer',
    'materializeServiceLayer',
    'refreshWorkspaceLayerViewport',
    'syncWorkspaceAttributeFilter',
    'appendFeaturesToLayer',
    'removeLayer',
    'toggleLayer',
    'setLayerScaleRange',
    'restyleLayer',
    'refreshLayerData',
    'setLayerStyle',
    'applyLayerLock',
    'syncLayerOrder',
    'setLayerStylesRecord',
    'setBasemap',
    'setBasemapTone',
    'enable3D',
    'disable3D',
    'reconcile3DState',
    'stopMapCamera',
    'fitToAll',
    'fitToLayers',
    'fitBounds',
    'scheduleMapFit',
    'scheduleFitToLayers',
    'fitToFeatureIndices',
    'focusFeatures',
    'startCameraOrbit',
    'stopCameraOrbit',
    'prepareOrbitView',
    'showTempFeature',
    'showRouteMilepostPreview',
    'showWirelessPlanningPreview',
    'showProjectStationingPreview',
    'showGeoreferencePreview',
    'updateGeoreferencePreview',
    'clearGeoreferencePreview',
    'removeTempFeature',
    'clearTempFeatures',
    'showQueryResults',
    'clearQueryResults',
    'pulseQueryResults',
    'syncAnnotationSources',
    'highlightFeature',
    'clearHighlight',
    'startPointPick',
    'startTwoPointPick',
    'startRouteTwoPointPick',
    'startRectangleDraw',
    'startSketchPolygon',
    'startSketchPolyline',
    'startSketchCirclePolygon',
    'startPresentationFeaturePick',
    'cancelInteraction',
    'startMeasureFrom',
    'selectFeatures',
    'clearSelection',
    'selectAll',
    'invertSelection',
    'enterSelectionMode',
    'exitSelectionMode',
    'setActiveLayerId',
    'blockSelection',
    'unblockSelection',
    'clearSelectionBoxOutline',
    'enablePresentationMultiSelect',
    'disablePresentationMultiSelect',
    'addCoverageHeatmapLayer',
    'addGeoreferencedImageLayer',
    'setPopupMode',
    'startContinuousPointPick'
]);

/** Caller awaits a value from the popup map. */
export const RPC_MAP_METHODS = new Set([
    'startPointPick',
    'startTwoPointPick',
    'startRouteTwoPointPick',
    'startRectangleDraw',
    'startSketchPolygon',
    'startSketchPolyline',
    'startSketchCirclePolygon',
    'startPresentationFeaturePick'
]);

const ADD_LAYER_METHODS = new Set([
    'addLayer',
    'addLayerIncremental',
    'addWorkspaceLayer',
    'addServiceLayer',
    'addCoverageHeatmapLayer',
    'addGeoreferencedImageLayer'
]);

/** Changing one of these updates the layer delta baseline so the next sync does not resend it. */
export const LAYER_STAMP_METHODS = new Set([
    'addLayer',
    'addLayerIncremental',
    'addWorkspaceLayer',
    'addServiceLayer',
    'addCoverageHeatmapLayer',
    'addGeoreferencedImageLayer',
    'removeLayer',
    'removeServiceLayer',
    'toggleLayer',
    'refreshLayerData',
    'appendFeaturesToLayer',
    'syncLayerOrder',
    'setLayerScaleRange',
    'refreshWorkspaceLayerViewport',
    'syncWorkspaceAttributeFilter',
    'materializeServiceLayer',
    'refreshServiceLayer'
]);

const FOCUS_COMMANDS = new Set([
    'showTempFeature',
    'showRouteMilepostPreview',
    'showWirelessPlanningPreview',
    'showProjectStationingPreview',
    'showGeoreferencePreview',
    'updateGeoreferencePreview',
    'clearGeoreferencePreview',
    'removeTempFeature',
    'clearTempFeatures',
    'cancelInteraction',
    'startMeasureFrom',
    'startCameraOrbit',
    'prepareOrbitView'
]);

const REMOTE_PREVIEW = new Set([
    'showTempFeature',
    'showRouteMilepostPreview',
    'showWirelessPlanningPreview',
    'showProjectStationingPreview'
]);

/** Selection apply on the main window must not bounce the same call back. */
const SELECTION_ECHO_METHODS = new Set([
    'selectFeatures',
    'clearSelection',
    'setActiveLayerId'
]);

/**
 * Methods that stay in the calling window.
 * A new map-service method must be added here or to FORWARDED_MAP_METHODS.
 */
export const LOCAL_ONLY_MAP_METHODS = {
    init: 'Creates the map in this window',
    destroy: 'Tears down the map in this window',
    getMap: 'No map object in this window while dual-screen is on',
    resize: 'Resizes this window\'s map container',
    getLayerStyle: 'Style store kept on the main window for restore',
    getLayerDefaultColor: 'Color table kept on the main window',
    getCurrentBasemap: 'Basemap key kept on the main window',
    setCurrentBasemap: 'Chrome sync writes the key here and must not bounce',
    getBasemapTone: 'Tone kept on the main window',
    is3DEnabled: '3D flag kept on the main window',
    set3DEnabled: 'Chrome sync writes the flag here and must not bounce',
    getLayerStyles: 'Style map kept on the main window',
    getLayerStylesRecord: 'Style record read on the main window',
    userHasMovedCamera: 'Camera flag belongs to the window that owns the map',
    getBounds: 'Uses the last viewport the popup already sent',
    hasImportFence: 'Fence flag; the draw protocol moves the fence',
    clearImportFence: 'Fence clear already goes out as a draw command',
    startImportFenceDraw: 'Fence draw already goes out as a draw command',
    setImportFenceFromBbox: 'Fence apply already goes out as a draw command',
    getImportFenceEsriEnvelope: 'Built from the fence bbox stored on the main window',
    getSearchLatLng: 'Search marker is moved by the draw protocol',
    clearSearchMarker: 'Search clear already goes out as a draw command',
    getLayerRecord: 'Layer table on this window is empty while the map is in the popup',
    compositeAnnotationOverlay: 'Needs a canvas context, which cannot cross the bridge',
    getLayerIds: 'Layer ids on this window while the map is in the popup',
    isSelectionMode: 'Reads selection state already mirrored by the selection channel',
    isPresentationMultiSelect: 'Reads a flag on this window',
    getActiveLayerId: 'Reads the active layer id on this window',
    getTotalSelectionCount: 'Reads selection state already mirrored by the selection channel',
    getSelectedIndices: 'Reads selection state already mirrored by the selection channel',
    getSelectedFeatures: 'Reads selection state already mirrored by the selection channel',
    getSelectionCount: 'Reads selection state already mirrored by the selection channel',
    getLastSelectionBbox: 'Reads selection state already mirrored by the selection channel',
    isSelectionBlocked: 'Reads selection state on this window',
    showInteractionBanner: 'The cancel callback cannot cross the bridge',
    getHighlightedFeature: 'Reads highlight state on this window',
    getPresentationAnchor: 'Reads presentation state on this window',
    getPresentationSourceFeatures: 'Reads presentation features on this window',
    resolveFeaturesByIndices: 'Looks up features in this window\'s layer table',
    getActivePopupHit: 'Popups belong to the window that owns the map',
    hasPopupHits: 'Popups belong to the window that owns the map',
    cyclePopup: 'Popups belong to the window that owns the map',
    getPopupMode: 'Popups belong to the window that owns the map',
    closePopup: 'Popups belong to the window that owns the map',
    findFeaturesNearClick: 'Hit testing needs this window\'s map pixels',
    queryFeaturesAtPoint: 'Hit testing needs this window\'s map pixels',
    showMultiPopup: 'Popups belong to the window that owns the map',
    showPopup: 'Popups belong to the window that owns the map',
    isOrbiting: 'Reads orbit state on the window that owns the map',
    queryElevationAt: 'Elevation is a synchronous read of the local map'
};

const UNFORWARDABLE_LOCAL = new Set([
    'getMap',
    'showInteractionBanner',
    'compositeAnnotationOverlay',
    'queryElevationAt'
]);

/** Preview and commit carry blob: URLs that only the main window can read. */
const GEOREFERENCE_IMAGE_METHODS = new Set([
    'showGeoreferencePreview',
    'updateGeoreferencePreview',
    'addGeoreferencedImageLayer'
]);

const blobDataUrlCache = new Map();

/**
 * @param {string} name
 * @returns {'forward' | 'local' | 'unbridged'}
 */
export function classifyMapMethod(name) {
    if (FORWARDED_MAP_METHODS.has(name)) return 'forward';
    if (Object.prototype.hasOwnProperty.call(LOCAL_ONLY_MAP_METHODS, name)) return 'local';
    return 'unbridged';
}

/**
 * @param {object} mapApi
 * @returns {string[]}
 */
export function listPublicMapMethods(mapApi) {
    if (!mapApi || typeof mapApi !== 'object') return [];
    return Object.keys(mapApi).filter((name) => typeof mapApi[name] === 'function').sort();
}

function mixNumber(hash, value) {
    const bits = Number.isFinite(value) ? (Math.round(value * 1e5) | 0) : 0;
    return Math.imul(hash, 33) ^ bits;
}

function mixString(hash, value) {
    const text = String(value);
    let next = Math.imul(hash, 33) ^ text.length;
    for (let i = 0; i < text.length; i += 1) {
        next = Math.imul(next, 33) ^ text.charCodeAt(i);
    }
    return next;
}

function mixCoords(hash, coordinates) {
    if (typeof coordinates === 'number') return mixNumber(hash, coordinates);
    if (!Array.isArray(coordinates)) return hash;
    let next = hash;
    for (let i = 0; i < coordinates.length; i += 1) {
        next = mixCoords(next, coordinates[i]);
    }
    return next;
}

function mixProperties(hash, properties) {
    if (!properties || typeof properties !== 'object') return hash;
    let next = hash;
    for (const [key, value] of Object.entries(properties)) {
        next = mixString(next, key);
        if (typeof value === 'number') next = mixNumber(next, value);
        else if (typeof value === 'string' || typeof value === 'boolean') next = mixString(next, value);
        else if (value == null) next ^= 7;
    }
    return next;
}

function stableJson(value) {
    if (value == null) return '';
    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

/** Cheap content stamp so a later sync can send one changed layer, not the whole map. */
export function layerContentStamp(layer) {
    const features = layer?.geojson?.features;
    const count = Array.isArray(features) ? features.length : 0;
    let hash = count >>> 0;
    if (Array.isArray(features)) {
        for (let i = 0; i < count; i += 1) {
            const geometry = features[i]?.geometry;
            hash = mixString(hash, geometry?.type || '');
            hash = mixCoords(hash, geometry?.coordinates);
            hash = mixProperties(hash, features[i]?.properties);
        }
    }
    const markerIds = (layer?._arcgisPictureMarkers?.markers || layer?.pictureMarkers?.markers || [])
        .map((marker) => marker?.imageId || '')
        .join(',');
    return {
        hash,
        visible: layer?.visible !== false,
        name: layer?.name || '',
        storage: layer?.storage || '',
        workspaceLayerId: layer?.workspaceLayerId || '',
        scale: `${layer?.scaleRangeEnabled ? 1 : 0}:${layer?.minScale ?? ''}:${layer?.maxScale ?? ''}`,
        filter: stableJson(layer?.workspaceAttributeFilter || layer?._activeFilter || null),
        service: layer?.type === 'service'
            ? stableJson({
                url: layer.service?.url || '',
                kind: layer.service?.kind || '',
                style: layer.service?.style || null,
                opacity: layer.service?.opacity ?? null
            })
            : '',
        pmtiles: isPmTilesLayer(layer)
            ? stableJson({
                url: layer.pmtiles?.url || layer.source?.url || '',
                sourceLayer: layer.pmtiles?.sourceLayer || ''
            })
            : '',
        markers: markerIds
    };
}

/**
 * @param {Map<string, object> | null | undefined} prevStamps
 * @param {string[] | null | undefined} prevOrder
 * @param {object[]} layers
 */
export function planLayerDelta(prevStamps, prevOrder, layers) {
    const prev = prevStamps instanceof Map ? prevStamps : new Map();
    const orderBefore = Array.isArray(prevOrder) ? prevOrder : [];
    /** @type {{ method: string, args: unknown[] }[]} */
    const calls = [];
    const stamps = new Map();
    const spatial = [];

    for (const layer of layers || []) {
        if (!layer?.id) continue;
        spatial.push(layer);
        stamps.set(layer.id, layerContentStamp(layer));
    }

    for (const id of prev.keys()) {
        if (!stamps.has(id)) calls.push({ method: 'removeLayer', args: [id] });
    }

    spatial.forEach((layer, index) => {
        const stamp = stamps.get(layer.id);
        const old = prev.get(layer.id);
        if (!old) {
            calls.push({ method: 'addLayer', args: [layer, index, { fit: false }] });
            return;
        }
        const geometryChanged = old.hash !== stamp.hash
            || old.name !== stamp.name
            || old.storage !== stamp.storage
            || old.workspaceLayerId !== stamp.workspaceLayerId
            || old.scale !== stamp.scale;
        const identityChanged = old.service !== stamp.service
            || old.pmtiles !== stamp.pmtiles
            || old.markers !== stamp.markers;
        // Style, archive location, or picture markers need a fresh add.
        // A live service data change re-queries on the pop-out map instead of
        // copying the main window's last viewport packet.
        if (identityChanged) {
            calls.push({ method: 'addLayer', args: [layer, index, { fit: false }] });
        } else if (geometryChanged) {
            if (layer.type === 'service') calls.push({ method: 'refreshServiceLayer', args: [layer.id] });
            else calls.push({ method: 'refreshLayerData', args: [layer] });
        }
        if (!identityChanged && old.filter !== stamp.filter) {
            calls.push({ method: 'syncWorkspaceAttributeFilter', args: [layer] });
        }
        if (old.visible !== stamp.visible) calls.push({ method: 'toggleLayer', args: [layer.id, stamp.visible] });
    });

    const order = spatial.map((layer) => layer.id);
    const orderChanged = order.join('|') !== orderBefore.join('|');
    if (orderChanged && (orderBefore.length > 0 || prev.size > 0)) {
        calls.push({ method: 'syncLayerOrder', args: [order] });
    }

    return { calls, stamps, order };
}

/**
 * @param {object[]} layers
 */
export function stampSpatialLayers(layers) {
    const planned = planLayerDelta(new Map(), [], layers || []);
    return { stamps: planned.stamps, order: planned.order };
}

function hasCircular(value, stack = new WeakSet()) {
    if (value == null || typeof value !== 'object') return false;
    if (stack.has(value)) return true;
    stack.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    const cyclic = children.some((child) => hasCircular(child, stack));
    stack.delete(value);
    return cyclic;
}

function collectNonSerializable(value, path, dropped, seen) {
    if (value == null) return;
    const kind = typeof value;
    if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
        dropped.push(path || 'arg');
        return;
    }
    if (kind !== 'object') return;
    if (typeof Element !== 'undefined' && value instanceof Element) {
        dropped.push(path || 'node');
        return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            collectNonSerializable(item, `${path}[${index}]`, dropped, seen);
        });
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        collectNonSerializable(child, path ? `${path}.${key}` : key, dropped, seen);
    }
}

/**
 * @param {unknown[]} args
 * @returns {{ ok: boolean, args: unknown[] | null, dropped: string[], error?: Error }}
 */
export function serializeMapCallArgs(args) {
    const list = Array.isArray(args) ? args : [];
    const dropped = [];
    collectNonSerializable(list, '', dropped, new WeakSet());
    if (hasCircular(list)) {
        return { ok: false, args: null, dropped, error: new Error('circular value') };
    }
    try {
        const json = JSON.stringify(list, (_key, value) => {
            if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
                return undefined;
            }
            if (typeof Element !== 'undefined' && value instanceof Element) return undefined;
            return value;
        });
        return { ok: true, args: JSON.parse(json), dropped };
    } catch (error) {
        return {
            ok: false,
            args: null,
            dropped,
            error: error instanceof Error ? error : new Error(String(error))
        };
    }
}

function buildFenceEnvelope(bbox) {
    const [west, south, east, north] = bbox;
    return {
        xmin: west,
        ymin: south,
        xmax: east,
        ymax: north,
        spatialReference: { wkid: 4326 }
    };
}

function mirrorLocal(name, args, originals) {
    switch (name) {
        case 'setLayerStyle':
            originals.setLayerStyle?.(...args);
            bus.emit('map:styleChanged', { layerId: args[0] });
            return undefined;
        case 'restyleLayer':
            originals.setLayerStyle?.(args[0], args[2]);
            bus.emit('map:styleChanged', { layerId: args[0] });
            return undefined;
        case 'setBasemap': {
            const key = args[0];
            originals.setCurrentBasemap?.(key);
            bus.emit('map:chrome', {
                basemap: key,
                is3d: originals.is3DEnabled?.(),
                basemapTone: originals.getBasemapTone?.()
            });
            return undefined;
        }
        case 'setBasemapTone':
            return originals.setBasemapTone?.(...args);
        case 'enable3D':
            originals.set3DEnabled?.(true);
            return undefined;
        case 'disable3D':
            originals.set3DEnabled?.(false);
            return undefined;
        case 'setLayerStylesRecord':
            return originals.setLayerStylesRecord?.(...args);
        case 'setPopupMode':
            return originals.setPopupMode?.(...args);
        case 'addLayer':
        case 'addLayerIncremental':
        case 'addWorkspaceLayer':
        case 'addServiceLayer':
        case 'addCoverageHeatmapLayer':
        case 'addGeoreferencedImageLayer':
            if (args[2]?.style && args[0]?.id) originals.setLayerStyle?.(args[0].id, args[2].style);
            return undefined;
        default:
            return undefined;
    }
}

function runLocal(name, args, originals, coordinator) {
    if (UNFORWARDABLE_LOCAL.has(name)) {
        const reason = LOCAL_ONLY_MAP_METHODS[name] || 'cannot cross the bridge';
        warnDualScreenDev(`[DualScreen] cannot forward ${name}: ${reason}`);
        if (name === 'getMap') return null;
        if (name === 'queryElevationAt') return null;
        return undefined;
    }
    if (name === 'getBounds' && typeof coordinator?.getBounds === 'function') {
        return coordinator.getBounds();
    }
    if (name === 'getImportFenceEsriEnvelope' && coordinator?._fenceBbox) {
        return buildFenceEnvelope(coordinator._fenceBbox);
    }
    return originals[name]?.(...args);
}

/**
 * Apply one forwarded call on the window that owns the map.
 * @param {object} mapApi
 * @param {{ method?: string, args?: unknown[] }} payload
 */
export function applyForwardedMapCall(mapApi, payload) {
    const method = payload?.method;
    const args = Array.isArray(payload?.args) ? payload.args : [];
    const fn = method ? mapApi?.[method] : null;
    if (typeof fn !== 'function') {
        warnDualScreenDev(`[DualScreen] cannot forward map method ${method || '(missing)'}: not on the map`);
        return undefined;
    }
    try {
        return fn.apply(mapApi, args);
    } catch (err) {
        warnDualScreenDev(`[DualScreen] map call ${method} failed: ${err?.message || err}`);
        return undefined;
    }
}

function containsBlobUrl(value, seen = new WeakSet()) {
    if (typeof value === 'string') return value.startsWith('blob:');
    if (!value || typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const list = Array.isArray(value) ? value : Object.values(value);
    return list.some((item) => containsBlobUrl(item, seen));
}

async function blobUrlToDataUrl(url) {
    if (blobDataUrlCache.has(url)) return blobDataUrlCache.get(url);
    const res = await fetch(url);
    if (res && res.ok === false) throw new Error(`image fetch failed (${res.status})`);
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    blobDataUrlCache.set(url, dataUrl);
    return dataUrl;
}

function datasetHasBlobPmtiles(args) {
    const dataset = args?.[0];
    if (!dataset || typeof dataset !== 'object' || !isPmTilesLayer(dataset)) return false;
    const url = String(dataset.pmtiles?.url || dataset.source?.url || '');
    return url.startsWith('blob:');
}

async function rewritePmtilesArgs(args) {
    const next = Array.isArray(args) ? args.slice() : [];
    if (next[0] && typeof next[0] === 'object') {
        await publishPmtilesDataset(next[0]);
    }
    return next;
}

async function rewriteBlobUrls(value, seen = new WeakMap()) {
    if (typeof value === 'string') {
        return value.startsWith('blob:') ? blobUrlToDataUrl(value) : value;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
        const copy = [];
        seen.set(value, copy);
        for (const item of value) copy.push(await rewriteBlobUrls(item, seen));
        return copy;
    }
    const copy = {};
    seen.set(value, copy);
    for (const [key, child] of Object.entries(value)) {
        copy[key] = await rewriteBlobUrls(child, seen);
    }
    return copy;
}

/**
 * Shift popup client pixels into the main window's coordinate space.
 * @param {{ clientX?: number, clientY?: number, screenBbox?: object | null }} detail
 * @param {number} dx
 * @param {number} dy
 */
export function shiftClientPoint(detail, dx, dy) {
    const box = detail?.screenBbox;
    return {
        clientX: (detail?.clientX ?? 0) + dx,
        clientY: (detail?.clientY ?? 0) + dy,
        screenBbox: box ? {
            left: box.left + dx,
            top: box.top + dy,
            right: box.right + dx,
            bottom: box.bottom + dy
        } : null
    };
}

function openerClientShift() {
    try {
        const opener = window.opener;
        if (!opener || opener.closed) return { dx: 0, dy: 0 };
        return {
            dx: (window.screenX || 0) - (opener.screenX || 0),
            dy: (window.screenY || 0) - (opener.screenY || 0)
        };
    } catch {
        return { dx: 0, dy: 0 };
    }
}

/**
 * Box-select finished on the popup. Selection itself already went out on selection:changed.
 * @param {object} detail
 */
export function boxSelectRelayPayload(detail) {
    const { dx, dy } = openerClientShift();
    const point = shiftClientPoint(detail, dx, dy);
    return {
        source: 'secondary',
        event: 'boxComplete',
        layerId: detail?.layerId ?? null,
        count: detail?.count ?? 0,
        bbox: detail?.bbox ?? null,
        screenBbox: point.screenBbox,
        clientX: point.clientX,
        clientY: point.clientY,
        syncSelection: false
    };
}

export function boxClearedRelayPayload() {
    return { source: 'secondary', event: 'boxCleared', syncSelection: false };
}

/**
 * Popup keyboard shortcuts. The main window runs the same actions it would if it had focus.
 * @param {(type: string, payload: object) => void} post
 */
export function popupSelectionShortcutActions(post) {
    const send = (shortcut) => post(MessageType.CTX_CMD, { action: 'selectionShortcut', shortcut });
    return {
        clearSelection: () => send('clearSelection'),
        selectAllFeatures: () => send('selectAll'),
        invertSelection: () => send('invertSelection'),
        deleteSelectedFeatures: () => send('deleteSelected')
    };
}

/**
 * Box-select events and selection shortcuts from the popup window.
 * @param {object} opts
 * @param {(type: string, payload: object) => void} opts.post
 * @param {() => number} [opts.getSelectionCount]
 * @param {() => boolean} [opts.isDrawToolActive]
 * @returns {() => void}
 */
export function attachPopupSelectionBridges(opts) {
    const post = opts?.post;
    const unsubs = [
        bus.on('selection:boxComplete', (detail) => {
            post?.(MessageType.SELECTION, boxSelectRelayPayload(detail));
        }),
        bus.on('selection:boxCleared', () => {
            post?.(MessageType.SELECTION, boxClearedRelayPayload());
        }),
        initSelectionShortcuts({
            ...popupSelectionShortcutActions(post || (() => {})),
            getSelectionCount: opts?.getSelectionCount,
            isDrawToolActive: opts?.isDrawToolActive
        })
    ];
    return () => {
        unsubs.forEach((fn) => fn?.());
    };
}

/**
 * Dual-mode zoom. The popup owns the camera, so this is fitToLayers on the bridge.
 * @returns {boolean} true when the call was forwarded
 */
export function zoomToLayerInDualMode(mapApi, layerId, active) {
    if (!active) return false;
    mapApi?.fitToLayers?.([layerId]);
    return true;
}

/**
 * Apply one map RPC on the popup, including continuous pick points sent back one at a time.
 * @param {object} mapApi
 * @param {{ requestId?: string, method?: string, args?: unknown[] }} payload
 * @param {(type: string, body: object) => void} postFn
 */
export async function runForwardedMapRpc(mapApi, payload, postFn) {
    const { requestId, method, args = [] } = payload || {};
    try {
        if (method === 'startContinuousPointPick') {
            await mapApi?.startContinuousPointPick?.(args[0], (coord) => {
                postFn(MessageType.MAP_RPC_RESULT, { requestId, event: 'point', result: coord });
            });
            postFn(MessageType.MAP_RPC_RESULT, { requestId, event: 'done', result: null });
            return;
        }
        const fn = method ? mapApi?.[method] : null;
        if (typeof fn !== 'function') {
            warnDualScreenDev(`[DualScreen] cannot forward map method ${method || '(missing)'}: not on the map`);
            throw new Error(`Unknown map method: ${method}`);
        }
        const result = await fn.apply(mapApi, args);
        postFn(MessageType.MAP_RPC_RESULT, { requestId, result });
    } catch (err) {
        postFn(MessageType.MAP_RPC_RESULT, {
            requestId,
            error: err?.message || String(err)
        });
    }
}

/**
 * @param {object} mapApi
 * @param {object} coordinator
 * @returns {() => void}
 */
export function installDualScreenMapServiceDecorator(mapApi, coordinator) {
    if (!mapApi || typeof mapApi !== 'object') {
        throw new Error('installDualScreenMapServiceDecorator requires a map API object');
    }
    if (!coordinator || typeof coordinator !== 'object') {
        throw new Error('installDualScreenMapServiceDecorator requires a coordinator object');
    }

    let asyncForwardChain = Promise.resolve();
    const originals = {};
    for (const name of listPublicMapMethods(mapApi)) {
        originals[name] = mapApi[name].bind(mapApi);
        mapApi[name] = function bridgedMapCall(...args) {
            if (!coordinator.isActive) return originals[name](...args);

            const kind = classifyMapMethod(name);
            if (kind === 'local') return runLocal(name, args, originals, coordinator);
            if (kind !== 'forward') {
                warnDualScreenDev(`[DualScreen] cannot forward map method ${name}: not bridged`);
                return undefined;
            }

            if (SELECTION_ECHO_METHODS.has(name) && coordinator.isSelectionSyncInbound?.()) {
                return originals[name](...args);
            }

            const mirrored = mirrorLocal(name, args, originals);
            const options = {
                rpc: RPC_MAP_METHODS.has(name),
                focusMap: RPC_MAP_METHODS.has(name) || FOCUS_COMMANDS.has(name)
            };
            if (name === 'startContinuousPointPick') {
                return coordinator.forwardContinuousPointPick?.(args[0], args[1]);
            }
            if (GEOREFERENCE_IMAGE_METHODS.has(name) && containsBlobUrl(args)) {
                asyncForwardChain = asyncForwardChain.then(async () => {
                    try {
                        const nextArgs = await rewriteBlobUrls(args);
                        coordinator.forwardMapCall?.(name, nextArgs, options);
                    } catch (err) {
                        warnDualScreenDev(
                            `[DualScreen] georeference image could not cross the bridge: ${err?.message || err}`
                        );
                        coordinator.forwardMapCall?.(name, args, options);
                    }
                }).then(() => {}, () => {});
                return undefined;
            }
            if (datasetHasBlobPmtiles(args)) {
                asyncForwardChain = asyncForwardChain.then(async () => {
                    try {
                        const nextArgs = await rewritePmtilesArgs(args);
                        coordinator.forwardMapCall?.(name, nextArgs, options);
                    } catch (err) {
                        warnDualScreenDev(
                            `[DualScreen] PMTiles archive could not cross the bridge: ${err?.message || err}`
                        );
                    }
                }).then(() => {}, () => {});
                return undefined;
            }
            const forwarded = coordinator.forwardMapCall?.(name, args, options);
            if (REMOTE_PREVIEW.has(name)) return { dualScreenRemote: true };
            if (name === 'setBasemapTone' || name === 'setLayerStylesRecord' || name === 'setPopupMode') {
                return mirrored;
            }
            return forwarded;
        };
    }

    return function uninstallDualScreenMapServiceDecorator() {
        for (const [name, fn] of Object.entries(originals)) {
            if (typeof fn === 'function') mapApi[name] = fn;
        }
    };
}

export { ADD_LAYER_METHODS };
