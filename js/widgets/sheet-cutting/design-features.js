/**
 * Collect design-layer features for Sheet Cutter, including UDOT Fiber live layers.
 * Live Fiber is viewport-scoped on the map; sheets query the corridor envelope
 * so every page gets the same decorated features the map would show.
 */
import { isLiveVectorLayer } from '../../core/data-model.js';
import { queryArcgisVectorEnvelope } from '../../live-layers/arcgis-vector-query.js';
import { padEnvelope } from '../../live-layers/live-layer-cache.js';
import { tagServiceFeatures } from '../../live-layers/live-layer-viewport.js';
import { RENDER_LIMITS } from '../../map/render-limits.js';
import {
    prepareUdotFiberExportFeatures,
    resolveUdotFiberLayerKey,
    udotFiberExportWhere
} from '../../symbology/udot-fiber/sheet-export.js';
import { buildSheetFramesGeoJson } from './export-builder.js';

const SHEET_ENVELOPE_PAD = 0.08;
const ROUTE_PAD_FT = 80;
const FEET_PER_DEG_LAT = 364000;

/**
 * @param {number[][]} coords
 * @returns {{ west: number, south: number, east: number, north: number }|null}
 */
export function envelopeFromCoords(coords = []) {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const coord of coords) {
        const lng = Number(coord?.[0]);
        const lat = Number(coord?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
    }
    if (!Number.isFinite(west) || east <= west || north <= south) return null;
    return { west, south, east, north };
}

/**
 * @param {object|null} geometry
 * @param {number[][]} [out]
 */
export function collectGeometryCoords(geometry, out = []) {
    if (!geometry?.coordinates) return out;
    const walk = (coords) => {
        if (!Array.isArray(coords) || !coords.length) return;
        if (typeof coords[0] === 'number') {
            out.push(coords);
            return;
        }
        for (const child of coords) walk(child);
    };
    walk(geometry.coordinates);
    return out;
}

/**
 * Corridor envelope from generated sheet frames, else the route + width.
 * @param {object} session
 * @returns {{ west: number, south: number, east: number, north: number }|null}
 */
export function envelopeFromSheetSession(session) {
    const detailSheets = (session?.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');
    if (detailSheets.length && session?.routeLine) {
        const frames = buildSheetFramesGeoJson(detailSheets, session.routeLine);
        const coords = [];
        for (const feature of frames.features || []) {
            collectGeometryCoords(feature.geometry, coords);
        }
        const env = envelopeFromCoords(coords);
        if (env) return padEnvelope(env, SHEET_ENVELOPE_PAD);
    }

    const routeCoords = [];
    collectGeometryCoords(session?.routeLine?.geometry, routeCoords);
    const env = envelopeFromCoords(routeCoords);
    if (!env) return null;

    const corridorFt = Number(session?.sheets?.template?.corridorWidthFt) || 350;
    const padFt = corridorFt / 2 + ROUTE_PAD_FT;
    const midLat = (env.south + env.north) / 2;
    const padLat = padFt / FEET_PER_DEG_LAT;
    const padLng = padFt / Math.max(1e-6, FEET_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180));
    return {
        west: env.west - padLng,
        south: env.south - padLat,
        east: env.east + padLng,
        north: env.north + padLat
    };
}

/**
 * @param {object} ctx
 * @param {string} layerId
 */
export function getLayerFeatures(ctx, layerId) {
    const layer = ctx.getLayerById?.(layerId) || ctx.getLayers?.()?.find((entry) => entry.id === layerId);
    const fromDataset = layer?.geojson?.features;
    if (fromDataset?.length) return fromDataset;
    const fromMap = ctx.mapService?.getLayerRecord?.(layerId)?.geojson?.features;
    return fromMap?.length ? fromMap : [];
}

/**
 * @param {object} feature
 * @param {string} layerId
 * @param {string|null} [fiberKey]
 */
function stampSource(feature, layerId, fiberKey = null) {
    return {
        ...feature,
        properties: {
            ...(feature.properties || {}),
            _sourceLayerId: layerId,
            ...(fiberKey ? { _udotFiberKey: fiberKey } : {})
        }
    };
}

/**
 * @param {object} ctx
 * @param {object} layer
 * @param {string} fiberKey
 * @param {{ west: number, south: number, east: number, north: number }|null} envelope
 */
async function collectFiberLayerFeatures(ctx, layer, fiberKey, envelope) {
    const layerId = layer.id;
    const url = layer.service?.url || layer.source?.url || layer.url;
    const map = ctx.mapService?.getMap?.();

    if (isLiveVectorLayer(layer) && envelope && url) {
        try {
            const queried = await queryArcgisVectorEnvelope(url, envelope, {
                where: udotFiberExportWhere(fiberKey),
                maxFeatures: RENDER_LIMITS.maxFeaturesPerSource
            });
            if (queried.features.length) {
                const tagged = tagServiceFeatures(layerId, queried.features, layer.service?.objectIdField);
                return prepareUdotFiberExportFeatures(fiberKey, tagged, { layerId, map });
            }
        } catch {
            // Fall through to the current viewport cache.
        }
    }

    const cached = getLayerFeatures(ctx, layerId);
    if (!cached.length) return [];
    return prepareUdotFiberExportFeatures(fiberKey, cached, { layerId, map });
}

/**
 * @param {object} ctx
 * @param {string[]} [layerIds]
 * @param {{ envelope?: object|null }} [opts]
 */
export async function collectSheetDesignFeatures(ctx, layerIds = [], opts = {}) {
    const features = [];
    for (const layerId of layerIds) {
        const layer = ctx.getLayerById?.(layerId)
            || ctx.getLayers?.()?.find((entry) => entry.id === layerId);
        if (!layer) continue;
        const layerStyle = ctx.mapService?.getLayerStyle?.(layerId) || null;
        const fiberKey = resolveUdotFiberLayerKey(layer, layerStyle);
        if (fiberKey) {
            const fiberFeatures = await collectFiberLayerFeatures(ctx, layer, fiberKey, opts.envelope || null);
            features.push(...fiberFeatures);
            continue;
        }
        for (const feature of getLayerFeatures(ctx, layerId)) {
            if (!feature?.geometry) continue;
            features.push(stampSource(feature, layerId));
        }
    }
    return features;
}

/**
 * @param {object} ctx
 * @param {string[]} [layerIds]
 */
export function collectSheetDesignFeaturesSync(ctx, layerIds = []) {
    const features = [];
    for (const layerId of layerIds) {
        const layer = ctx.getLayerById?.(layerId)
            || ctx.getLayers?.()?.find((entry) => entry.id === layerId);
        const layerStyle = ctx.mapService?.getLayerStyle?.(layerId) || null;
        const fiberKey = resolveUdotFiberLayerKey(layer, layerStyle);
        const raw = getLayerFeatures(ctx, layerId).filter((feature) => feature?.geometry);
        if (fiberKey) {
            features.push(...prepareUdotFiberExportFeatures(fiberKey, raw, {
                layerId,
                map: ctx.mapService?.getMap?.()
            }));
            continue;
        }
        for (const feature of raw) {
            features.push(stampSource(feature, layerId));
        }
    }
    return features;
}
