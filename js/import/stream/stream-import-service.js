/**
 * High-capacity streaming import — orchestrates the stream worker and writes
 * feature batches straight into the IndexedDB workspace. The full dataset never
 * exists in main-thread memory; the map renders it viewport-by-viewport.
 */
import logger from '../../core/logger.js';
import { createChunkedSpatialDataset } from '../../core/data-model.js';
import {
    createWorkspaceLayer,
    updateWorkspaceLayerMeta,
    appendWorkspaceBatch,
    removeWorkspaceLayer,
    flushSpatialIndexSave,
    WORKSPACE_CHUNK_SIZE
} from '../../workspace/workspace-store.js';
import { createSpatialChunkWriter } from '../../workspace/spatial-chunk-writer.js';
import { saveSourceFile, removeSourceFile } from '../../workspace/source-file-store.js';
import { STORED_FEATURE_LIMIT } from '../import-admission.js';
import { profileForGeometryClass } from '../dataset-profile.js';

const GEOM_CLASS = {
    Point: 'point',
    MultiPoint: 'point',
    LineString: 'line',
    MultiLineString: 'line',
    Polygon: 'polygon',
    MultiPolygon: 'polygon'
};

const CLASS_LABELS = { point: 'Points', line: 'Lines', polygon: 'Polygons' };

/** Null-geometry features buffered before the first geometry class appears. */
const MAX_PENDING_NULL_GEOMETRY = 5000;

function _generateId(prefix = 'ds') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _baseName(fileName) {
    return String(fileName || 'Import').replace(/\.(geojson|json|csv|tsv|txt|kml|kmz|xml|zip)$/i, '');
}

/**
 * Stream one large file into workspace-backed layers.
 *
 * @param {File} file
 * @param {{
 *   format: string,
 *   fenceBbox?: [number,number,number,number]|null,
 *   onProgress?: (percent: number, step: string) => void,
 *   preserveSource?: boolean,
 *   selectedFields?: string[]|null,
 *   featureFilter?: object|null,
 *   importMode?: 'gis'|'preserve',
 *   sourceCrs?: { code: string, def: string }|null
 * }} options
 * @returns {{ promise: Promise<{ datasets: object[], stats: object }>, cancel: () => void }}
 */
export function streamImportFile(file, options = {}) {
    const {
        format,
        fenceBbox = null,
        onProgress,
        preserveSource = true,
        selectedFields = null,
        featureFilter = null,
        importMode,
        sourceCrs = null
    } = options;
    const baseName = _baseName(file.name);

    /** @type {Map<string, { layerId: string, count: number, geomTypes: Set<string>, writer: ReturnType<typeof createSpatialChunkWriter> }>} */
    const classes = new Map();
    const pendingNullGeometry = [];
    let worker = null;
    let cancelled = false;
    let settled = false;
    let opfsKey = null;
    /** @type {AbortController|null} */
    let sourceAbort = null;

    const report = (percent, step) => {
        try {
            onProgress?.(Math.max(0, Math.min(100, percent)), step);
        } catch { /* progress must never break the import */ }
    };

    const cleanup = async () => {
        try {
            sourceAbort?.abort();
        } catch { /* ignore */ }
        try {
            worker?.terminate();
        } catch { /* ignore */ }
        worker = null;
        for (const cls of classes.values()) {
            try {
                await removeWorkspaceLayer(cls.layerId);
            } catch { /* best effort */ }
        }
        classes.clear();
        pendingNullGeometry.length = 0;
        if (opfsKey) {
            await removeSourceFile(opfsKey);
            opfsKey = null;
        }
    };

    const getClass = async (clsKey) => {
        if (cancelled) {
            throw Object.assign(new Error('Import cancelled'), { cancelled: true });
        }
        let cls = classes.get(clsKey);
        if (!cls) {
            const layerId = _generateId();
            cls = {
                layerId,
                count: 0,
                geomTypes: new Set(),
                writer: null
            };
            cls.writer = createSpatialChunkWriter({
                chunkSize: WORKSPACE_CHUNK_SIZE,
                onFlush: async (batch, startIndex) => {
                    if (cancelled) {
                        throw Object.assign(new Error('Import cancelled'), { cancelled: true });
                    }
                    await appendWorkspaceBatch(layerId, batch, startIndex);
                    cls.count = startIndex + batch.length;
                }
            });
            classes.set(clsKey, cls);
            await createWorkspaceLayer({
                id: layerId,
                name: baseName,
                source: { file: file.name, format }
            });
        }
        return cls;
    };

    const flushClass = async (cls) => {
        if (!cls?.writer) return;
        if (cancelled) {
            throw Object.assign(new Error('Import cancelled'), { cancelled: true });
        }
        await cls.writer.flush();
        cls.count = cls.writer.writtenCount;
    };

    const routeFeature = async (feature) => {
        if (cancelled) {
            throw Object.assign(new Error('Import cancelled'), { cancelled: true });
        }
        const geomType = feature.geometry?.type || null;
        let clsKey = geomType ? GEOM_CLASS[geomType] : null;

        if (!clsKey && !geomType) {
            // Hold null-geometry features until a real class exists (CSV rows
            // with missing coordinates belong with their siblings).
            if (classes.size === 0) {
                pendingNullGeometry.push(feature);
                if (pendingNullGeometry.length > MAX_PENDING_NULL_GEOMETRY) {
                    await drainPendingNullGeometry('point');
                }
                return;
            }
            clsKey = _dominantClass();
        } else if (!clsKey) {
            // Unknown geometry type — skip rather than mis-bucket.
            return;
        }

        if (pendingNullGeometry.length && classes.size === 0) {
            await drainPendingNullGeometry(clsKey);
        }

        const cls = await getClass(clsKey);
        if (geomType) cls.geomTypes.add(geomType);
        await cls.writer.add(feature);
        cls.count = cls.writer.featureCount;

        if (pendingNullGeometry.length) {
            await drainPendingNullGeometry(clsKey);
        }
    };

    const drainPendingNullGeometry = async (clsKey) => {
        if (!pendingNullGeometry.length) return;
        const cls = await getClass(clsKey);
        for (const f of pendingNullGeometry) {
            await cls.writer.add(f);
        }
        cls.count = cls.writer.featureCount;
        pendingNullGeometry.length = 0;
    };

    const _dominantClass = () => {
        let best = null;
        let bestCount = -1;
        for (const [key, cls] of classes) {
            const n = cls.writer?.featureCount ?? cls.count;
            if (n > bestCount) {
                best = key;
                bestCount = n;
            }
        }
        return best || 'point';
    };

    let failFn = null;

    const promise = new Promise((resolve, reject) => {
        const fail = async (error) => {
            if (settled) return;
            settled = true;
            await cleanup();
            reject(error);
        };
        failFn = fail;

        (async () => {
            if (preserveSource) {
                report(1, `Preserving original file…`);
                const key = _generateId('src');
                // Register key before the copy finishes so cancel can always clean up.
                opfsKey = key;
                sourceAbort = new AbortController();
                const saved = await saveSourceFile(key, file, { signal: sourceAbort.signal });
                if (cancelled) {
                    await removeSourceFile(key);
                    opfsKey = null;
                    throw Object.assign(new Error('Import cancelled'), { cancelled: true });
                }
                if (!saved.ok) {
                    opfsKey = null;
                    if (saved.reason === 'aborted') {
                        throw Object.assign(new Error('Import cancelled'), { cancelled: true });
                    }
                    logger.info('StreamImport', 'Source preservation skipped', { reason: saved.reason });
                }
            }
            if (cancelled) throw Object.assign(new Error('Import cancelled'), { cancelled: true });

            report(3, `Reading ${file.name}…`);

            worker = new Worker(
                new URL('../../workers/stream-import.worker.js', import.meta.url),
                { type: 'module' }
            );

            const jobId = _generateId('job');

            worker.onerror = (event) => {
                void fail(new Error(event?.message || 'Streaming import worker crashed'));
            };

            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.id !== jobId || settled) return;

                if (msg.type === 'progress' || msg.type === 'batch') {
                    const pct = msg.totalBytes
                        ? 3 + (msg.bytesProcessed / msg.totalBytes) * 90
                        : 10;
                    report(pct, `Importing ${file.name}…`);
                }

                if (msg.type === 'batch') {
                    (async () => {
                        for (const feature of msg.features || []) {
                            await routeFeature(feature);
                        }
                        if (!settled && worker) worker.postMessage({ type: 'ack', id: jobId });
                    })().catch((e) => void fail(e));
                    return;
                }

                if (msg.type === 'done') {
                    (async () => {
                        if (pendingNullGeometry.length) {
                            await drainPendingNullGeometry(_dominantClass());
                        }
                        for (const cls of classes.values()) {
                            await flushClass(cls);
                        }
                        await flushSpatialIndexSave();
                        report(96, 'Finalizing layers…');

                        const total = [...classes.values()].reduce((s, c) => s + c.count, 0);
                        if (!total) {
                            throw new Error(`No features found in "${file.name}".`);
                        }

                        const multiClass = classes.size > 1;
                        const datasets = [];
                        const fieldCount = Array.isArray(msg.schema?.fields)
                            ? msg.schema.fields.length
                            : null;
                        const globalStats = {
                            featureCount: msg.stats?.featureCount || total,
                            noGeometryCount: msg.stats?.noGeometryCount || 0,
                            coordCount: msg.stats?.coordCount || 0,
                            maxCoordsInFeature: msg.stats?.maxCoordsInFeature || 0,
                            bbox: msg.stats?.bbox || null,
                            geometryTypes: msg.stats?.geometryTypes || []
                        };
                        for (const [clsKey, cls] of classes) {
                            const name = multiClass
                                ? `${baseName} - ${CLASS_LABELS[clsKey]}`
                                : baseName;
                            const geometryType = cls.geomTypes.size === 1
                                ? [...cls.geomTypes][0]
                                : cls.geomTypes.size > 1 ? 'Mixed' : null;
                            const schema = {
                                ...(msg.schema || { fields: [], crs: 'EPSG:4326' }),
                                geometryType,
                                featureCount: cls.count
                            };
                            const datasetProfile = profileForGeometryClass(
                                globalStats,
                                clsKey,
                                cls.count,
                                {
                                    importMethod: 'stream',
                                    format,
                                    fileSize: file.size,
                                    bytesProcessed: msg.stats?.bytesProcessed,
                                    fieldCount,
                                    fenceFiltered: msg.stats?.fenceFiltered || 0,
                                    featureFiltered: msg.stats?.featureFiltered || 0
                                }
                            );
                            await updateWorkspaceLayerMeta(cls.layerId, {
                                name,
                                schema,
                                datasetProfile
                            });
                            const dataset = createChunkedSpatialDataset(name, {
                                id: cls.layerId,
                                schema,
                                datasetProfile
                            }, {
                                file: file.name,
                                format,
                                fileSize: file.size,
                                importMethod: 'stream',
                                ...(importMode ? { importMode } : {}),
                                ...(selectedFields?.length ? { importSelectedFields: selectedFields } : {}),
                                ...(opfsKey ? { opfsKey, sourcePreserved: true } : {}),
                                ...(msg.sourceMeta || {})
                            });
                            datasets.push(dataset);
                        }

                        worker?.terminate();
                        worker = null;
                        settled = true;
                        report(100, 'Done');
                        resolve({
                            datasets,
                            stats: {
                                featureCount: total,
                                noGeometryCount: msg.stats?.noGeometryCount || 0,
                                fenceFiltered: msg.stats?.fenceFiltered || 0,
                                featureFiltered: msg.stats?.featureFiltered || 0,
                                warnings: msg.warnings || []
                            }
                        });
                    })().catch((e) => void fail(e));
                    return;
                }

                if (msg.type === 'error') {
                    const err = new Error(msg.message || 'Streaming import failed');
                    err.code = msg.code || null;
                    void fail(err);
                }
            };

            worker.postMessage({
                type: 'start',
                id: jobId,
                file,
                format,
                options: {
                    fenceBbox,
                    maxFeatures: STORED_FEATURE_LIMIT,
                    ...(selectedFields?.length ? { selectedFields } : {}),
                    ...(featureFilter ? { featureFilter } : {}),
                    ...(importMode ? { importMode } : {}),
                    ...(sourceCrs ? { sourceCrs } : {})
                }
            });
        })().catch((e) => void fail(e));
    });

    const cancel = () => {
        if (settled || cancelled) return;
        cancelled = true;
        try {
            sourceAbort?.abort();
        } catch { /* ignore */ }
        try {
            worker?.postMessage({ type: 'cancel' });
        } catch { /* ignore */ }
        void failFn?.(Object.assign(new Error('Import cancelled'), { cancelled: true }));
    };

    return { promise, cancel };
}

export default { streamImportFile };
