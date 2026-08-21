/**
 * Cursor-follow hover tooltip for UDOT Fiber Network live layers.
 */
import { featurePixelDistance } from '../../live-layers/live-layer-hits.js';
import { isUdotFiberLabelLayerId } from './draw-order.js';
import { buildUdotFiberHoverHtml } from './hover-fields.js';

const TOOLTIP_ID = 'udot-fiber-hover-tooltip';

/**
 * Hover only on visible paint — skip fat hit circles, offset shadows, and labels.
 * @param {string} [layerId]
 */
export function isUdotFiberHoverQueryLayerId(layerId) {
    if (!layerId || isUdotFiberLabelLayerId(layerId)) return false;
    return !layerId.endsWith('-hit') && !layerId.endsWith('-shadow');
}

/**
 * Prefer the geometry closest to the cursor so a nearby box halo cannot beat a line.
 * @param {{ project: (lngLat: number[]) => { x: number, y: number } }} map
 * @param {object[]} hits
 * @param {{ x: number, y: number }} pixel
 * @param {Map<string, { fiberKey: string, layerName: string }>} layers
 * @returns {{ hit: object, meta: { fiberKey: string, layerName: string } } | null}
 */
export function pickClosestUdotFiberHoverHit(map, hits, pixel, layers) {
    if (!map?.project || !hits?.length || !pixel || !layers) return null;
    const project = (lngLat) => map.project(lngLat);
    let best = null;
    let bestDist = Infinity;
    for (const hit of hits) {
        const meta = layers.get(hit.layer?.id);
        if (!meta) continue;
        const dist = featurePixelDistance(project, hit, pixel);
        if (dist < bestDist) {
            bestDist = dist;
            best = { hit, meta };
        }
    }
    return best;
}

/** @type {WeakMap<object, { layers: Map<string, { fiberKey: string, layerName: string }>, onMove: Function, onLeave: Function, onZoom: Function }>} */
const boundMaps = new WeakMap();

/**
 * @param {import('maplibre-gl').Map} map
 */
function ensureTooltipEl(map) {
    let el = document.getElementById(TOOLTIP_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = TOOLTIP_ID;
    el.className = 'udot-fiber-hover-tooltip hidden';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    return el;
}

/**
 * @param {HTMLElement} el
 */
function hideTooltip(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
}

/**
 * @param {import('maplibre-gl').Map} map
 */
function ensureBound(map) {
    let state = boundMaps.get(map);
    if (state) return state;

    const el = ensureTooltipEl(map);
    const layers = new Map();

    const onMove = (e) => {
        const ids = [...layers.keys()].filter((id) => (
            isUdotFiberHoverQueryLayerId(id) && map.getLayer(id)
        ));
        if (!ids.length) {
            hideTooltip(el);
            return;
        }
        let hits = [];
        try {
            hits = map.queryRenderedFeatures(e.point, { layers: ids });
        } catch {
            hideTooltip(el);
            return;
        }
        const picked = pickClosestUdotFiberHoverHit(map, hits, e.point, layers);
        if (!picked) {
            hideTooltip(el);
            return;
        }
        const { hit, meta } = picked;
        el.innerHTML = buildUdotFiberHoverHtml(meta.layerName, meta.fiberKey, hit.properties || {});
        el.classList.remove('hidden');
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const left = rect.left + e.point.x + 14;
        const top = rect.top + e.point.y + 16;
        const maxLeft = window.innerWidth - el.offsetWidth - 8;
        const maxTop = window.innerHeight - el.offsetHeight - 8;
        el.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
        el.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
    };

    const onLeave = () => hideTooltip(el);
    const onZoom = () => hideTooltip(el);

    map.on('mousemove', onMove);
    map.on('mouseout', onLeave);
    map.on('zoom', onZoom);
    state = { layers, onMove, onLeave, onZoom };
    boundMaps.set(map, state);
    return state;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ mapLayerIds?: string[], fiberKey: string, layerName?: string }} spec
 */
export function registerUdotFiberHoverLayers(map, spec) {
    if (!map || !spec?.fiberKey || !spec.mapLayerIds?.length) return;
    const state = ensureBound(map);
    for (const id of spec.mapLayerIds) {
        state.layers.set(id, {
            fiberKey: spec.fiberKey,
            layerName: spec.layerName || spec.fiberKey
        });
    }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string[]} [mapLayerIds]
 */
export function unregisterUdotFiberHoverLayers(map, mapLayerIds) {
    const state = boundMaps.get(map);
    if (!state) return;
    for (const id of mapLayerIds || []) state.layers.delete(id);
    if (state.layers.size) return;

    map.off('mousemove', state.onMove);
    map.off('mouseout', state.onLeave);
    map.off('zoom', state.onZoom);
    document.getElementById(TOOLTIP_ID)?.remove();
    boundMaps.delete(map);
}
