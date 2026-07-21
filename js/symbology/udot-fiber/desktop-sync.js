/**
 * Desktop SQLite sync orchestration for UDOT Fiber Network.
 * Shared code — uses platform service only (no Tauri imports).
 */
import { analyzeSchema, createSpatialDataset } from '../../core/data-model.js';
import { getPlatformBundle } from '../../platform/create-platform.js';
import { hasCapability } from '../../platform/contracts.js';
import {
    UDOT_FIBER_LAYERS,
    UDOT_FIBER_SYNC_INTERVAL_MS
} from './constants.js';
import { downloadUdotFiberLayer } from './download.js';
import { buildUdotFiberLayerStyle } from './resolve-style.js';
import { applyUdotFiberDisplayOffsets } from './display-offsets.js';

/**
 * @returns {import('../../platform/contracts.js').UdotFiberDbService|null}
 */
export function getUdotFiberDbService() {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'localSqlite')) return null;
    return services?.udotFiberDb || null;
}

/**
 * @param {object} [meta]
 * @returns {boolean}
 */
export function isUdotFiberSyncStale(meta) {
    const last = meta?.lastSyncAt || meta?.last_sync_at;
    if (!last) return true;
    const ts = Date.parse(last);
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts >= UDOT_FIBER_SYNC_INTERVAL_MS;
}

/**
 * Sync statewide layers into SQLite when stale (or forced).
 * @param {{ force?: boolean, onProgress?: (p: object) => void, signal?: AbortSignal }} [opts]
 */
export async function syncUdotFiberDbIfStale(opts = {}) {
    const db = getUdotFiberDbService();
    if (!db) {
        return { skipped: true, reason: 'udotFiberDb unavailable' };
    }

    await db.open();
    const meta = await db.getSyncMeta();
    if (!opts.force && !isUdotFiberSyncStale(meta)) {
        return { skipped: true, reason: 'fresh', meta };
    }

    const startedAt = new Date().toISOString();
    const counts = {};

    try {
        for (const layer of UDOT_FIBER_LAYERS) {
            opts.onProgress?.({ stage: 'download', layerKey: layer.key, name: layer.name });
            // eslint-disable-next-line no-await-in-loop
            const downloaded = await downloadUdotFiberLayer(layer.id, {
                onProgress: opts.onProgress,
                signal: opts.signal
            });
            const features = downloaded.geojson.features || [];
            opts.onProgress?.({
                stage: 'write',
                layerKey: layer.key,
                featureCount: features.length
            });
            // eslint-disable-next-line no-await-in-loop
            await db.replaceLayer({
                layerKey: layer.key,
                layerId: layer.id,
                name: layer.name,
                features
            });
            counts[layer.key] = features.length;
        }

        const nextMeta = {
            lastSyncAt: new Date().toISOString(),
            startedAt,
            finishedAt: new Date().toISOString(),
            layerCounts: counts,
            lastError: null
        };
        await db.setSyncMeta(nextMeta);
        return { skipped: false, meta: nextMeta, counts };
    } catch (error) {
        const message = error?.message || String(error);
        await db.setSyncMeta({
            ...(meta || {}),
            lastError: message,
            lastAttemptAt: new Date().toISOString()
        }).catch(() => {});
        throw error;
    }
}

/**
 * Load all layers from SQLite as styled spatial datasets (desktop offline path).
 * @param {{ applyOffsets?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
export async function loadUdotFiberLayersFromDb(opts = {}) {
    const db = getUdotFiberDbService();
    if (!db) throw new Error('UDOT Fiber database is only available on desktop');

    await db.open();
    const snapshot = await db.loadAllLayers();
    const datasets = [];

    for (const layer of UDOT_FIBER_LAYERS) {
        const fc = snapshot?.layers?.[layer.key] || { type: 'FeatureCollection', features: [] };
        let features = fc.features || [];
        if (opts.applyOffsets !== false && layer.key === 'fiber') {
            features = applyUdotFiberDisplayOffsets(features, { field: 'MULTISHEATH' });
        }
        const geojson = { type: 'FeatureCollection', features };
        const style = buildUdotFiberLayerStyle(layer.key);
        const ds = createSpatialDataset(
            `UDOT ${layer.name}`,
            geojson,
            {
                format: 'udot-fiber-db',
                url: `udot-fiber://${layer.key}`,
                layerKey: layer.key
            }
        );
        ds._udotFiberLayerKey = layer.key;
        ds.schema = analyzeSchema(geojson);
        if (style) {
            ds._pendingStyle = style;
            if (style.labels?.enabled) {
                ds._mapLabels = {
                    field: style.labels.field,
                    placement: style.labels.placement,
                    minZoom: style.labels.minZoom,
                    maxZoom: style.labels.maxZoom,
                    size: style.labels.size,
                    color: style.labels.color,
                    haloColor: style.labels.haloColor,
                    haloWidth: style.labels.haloWidth
                };
            }
        }
        datasets.push(ds);
    }

    return datasets;
}
