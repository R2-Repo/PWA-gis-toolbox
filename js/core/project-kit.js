/**
 * Toolbox Kit — branded portable project export/import (.gis-toolbox)
 */
import { serializeLayerForPersistence } from './session-store.js';
import { AppError, ErrorCategory } from './error-handler.js';
import {
    dataUrlToBytes,
    getCoverageRasters,
    isCoverageRasterLayer,
    stripCoverageRasterDataUrls
} from './coverage-raster-layer.js';

export const PROJECT_KIT_FORMAT = 'gis-toolbox-kit';
/** v2: streamed workspace packing + OPFS source sidecars (v1 kits still import). */
export const PROJECT_KIT_FORMAT_VERSION = 2;
export const PROJECT_KIT_EXTENSION = '.gis-toolbox';
export const PROJECT_KIT_LEGACY_EXTENSION = '.gtbx';
export const PROJECT_KIT_DISPLAY_NAME = 'Toolbox Kit';
export const PROJECT_KIT_SECTIONS = ['layers', 'map', 'workflow', 'preferences', 'widgets'];
export const WORKFLOW_NODE_CACHE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * @param {File|{ name?: string }} file
 */
export function isProjectKitFile(file) {
    const name = (file?.name || '').toLowerCase();
    return name.endsWith(PROJECT_KIT_EXTENSION) || name.endsWith(PROJECT_KIT_LEGACY_EXTENSION);
}

/**
 * @param {Date} [date]
 * @returns {string} e.g. 6-21-26
 */
export function formatProjectKitDate(date = new Date()) {
    return `${date.getMonth() + 1}-${date.getDate()}-${String(date.getFullYear()).slice(-2)}`;
}

/**
 * @param {string} name
 */
export function sanitizeProjectKitBaseName(name) {
    return String(name || 'toolbox-project')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'toolbox-project';
}

/**
 * @param {string} projectName
 * @param {Date} [date]
 * @returns {string} e.g. Highway-88(6-21-26).gis-toolbox
 */
export function buildProjectKitDownloadName(projectName, date = new Date()) {
    let base = sanitizeProjectKitBaseName(projectName);
    base = base.replace(/\.(gtbx|gis-toolbox)$/i, '');
    base = base.replace(/\(\d{1,2}-\d{1,2}-\d{2}\)$/i, '');
    return `${base}(${formatProjectKitDate(date)})${PROJECT_KIT_EXTENSION}`;
}

/** @deprecated use buildProjectKitDownloadName */
export function sanitizeProjectKitFilename(name) {
    return buildProjectKitDownloadName(name);
}

/**
 * @param {object} manifest
 * @returns {{ ok: true, manifest: object } | { ok: false, error: string }}
 */
export function validateProjectKitManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        return { ok: false, error: 'Missing manifest.json in Toolbox Kit file.' };
    }
    if (manifest.format !== PROJECT_KIT_FORMAT) {
        return { ok: false, error: `Unrecognised Toolbox Kit format: ${manifest.format || 'unknown'}` };
    }
    if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > PROJECT_KIT_FORMAT_VERSION) {
        return { ok: false, error: `Unsupported Toolbox Kit version (${manifest.formatVersion}). Update GIS Toolbox to import this file.` };
    }
    return { ok: true, manifest };
}

/**
 * @param {string} id
 * @param {Set<string>} existingIds
 */
export function resolveLayerIdConflict(id, existingIds) {
    if (!existingIds.has(id)) return id;
    let n = 2;
    while (existingIds.has(`${id}-${n}`)) n += 1;
    return `${id}-${n}`;
}

/**
 * @param {{
 *   sections: string[],
 *   layers?: object[],
 *   activeLayerId?: string|null,
 *   layerStyles?: object|null,
 *   layerGroups?: object[]|null,
 *   map?: object|null,
 *   workflow?: { pipeline: object, nodeCache?: object }|null,
 *   preferences?: object|null,
 *   widgets?: { activeWidgets?: object[] }|null,
 *   exportWorkspaceLayerBundle?: (layerId: string) => Promise<object|null>,
 *   deferLargeWorkspace?: boolean,
 *   maxBundleFeatures?: number,
 *   projectName?: string
 * }} options
 */
export async function buildProjectKitSnapshot(options) {
    const sections = normalizeSections(options.sections);
    const snapshot = {
        manifest: buildManifest({ sections, layers: options.layers, projectName: options.projectName }),
        layers: null,
        map: null,
        workflow: null,
        preferences: null,
        widgets: null
    };

    if (sections.includes('layers') && Array.isArray(options.layers)) {
        snapshot.layers = await gatherLayerSection(
            options.layers,
            options.activeLayerId,
            options.layerStyles,
            options.exportWorkspaceLayerBundle,
            options.layerGroups,
            {
                deferLargeWorkspace: options.deferLargeWorkspace !== false,
                maxBundleFeatures: options.maxBundleFeatures
            }
        );
        snapshot.manifest.hasDeferredWorkspace = Object.keys(snapshot.layers.workspaceDeferred || {}).length > 0;
        snapshot.manifest.sourceKeys = collectSourceKeys(options.layers);
    }

    if (sections.includes('map') && options.map) {
        snapshot.map = { ...options.map };
    }

    if (sections.includes('workflow') && options.workflow?.pipeline) {
        snapshot.workflow = {
            pipeline: buildWorkflowConfig(options.workflow.pipeline, options.workflow.nodeCache)
        };
    }

    if (sections.includes('preferences') && options.preferences) {
        snapshot.preferences = { ...options.preferences };
    }

    if (sections.includes('widgets') && options.widgets) {
        snapshot.widgets = {
            activeWidgets: Array.isArray(options.widgets.activeWidgets)
                ? options.widgets.activeWidgets
                : []
        };
    }

    return snapshot;
}

function buildManifest({ sections, layers, projectName }) {
    return {
        format: PROJECT_KIT_FORMAT,
        formatVersion: PROJECT_KIT_FORMAT_VERSION,
        displayName: PROJECT_KIT_DISPLAY_NAME,
        exportedAt: new Date().toISOString(),
        sections,
        layerCount: Array.isArray(layers) ? layers.length : 0,
        projectName: projectName || null,
        appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
    };
}

function buildWorkflowConfig(pipeline, nodeCache = {}) {
    const cache = {};
    for (const [nodeId, data] of Object.entries(nodeCache || {})) {
        const size = JSON.stringify(data).length;
        if (size <= WORKFLOW_NODE_CACHE_MAX_BYTES) cache[nodeId] = data;
    }
    return {
        _format: 'gis-toolbox-workflow',
        version: 1,
        pipeline,
        nodeCache: cache
    };
}

function collectSourceKeys(layers = []) {
    const keys = [];
    const seen = new Set();
    for (const layer of layers || []) {
        const key = layer?.source?.opfsKey;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}

async function gatherLayerSection(
    layers,
    activeLayerId,
    layerStyles,
    exportWorkspaceLayerBundle,
    layerGroups = [],
    opts = {}
) {
    const index = [];
    const spatial = {};
    const tables = {};
    const workspace = {};
    const workspaceDeferred = {};
    const rasters = {};
    const maxBundle = Number.isFinite(opts.maxBundleFeatures)
        ? opts.maxBundleFeatures
        : 250_000;
    const deferLarge = opts.deferLargeWorkspace !== false;

    for (const layer of layers) {
        let saved = serializeLayerForPersistence(layer);
        if (isCoverageRasterLayer(layer)) {
            const coverageRasters = getCoverageRasters(layer);
            rasters[layer.id] = coverageRasters;
            saved = {
                ...saved,
                source: {
                    ...(saved.source || {}),
                    coverageType: 'raster',
                    coverageRasterSidecar: true,
                    coverageRasters: stripCoverageRasterDataUrls(coverageRasters)
                }
            };
        }
        index.push(saved);
        if (layer.type === 'spatial' && layer.geojson) {
            spatial[layer.id] = layer.geojson;
        } else if (layer.type === 'table' && layer.rows) {
            tables[layer.id] = layer.rows;
        } else if (layer.type === 'spatial-chunked' || layer.storage === 'workspace') {
            const wsId = layer.workspaceLayerId || layer.id;
            const featureCount = layer.schema?.featureCount
                ?? layer.source?.fullFeatureCount
                ?? 0;
            if (deferLarge && featureCount > maxBundle) {
                workspaceDeferred[layer.id] = { workspaceLayerId: wsId, featureCount };
            } else if (exportWorkspaceLayerBundle) {
                const bundle = await exportWorkspaceLayerBundle(wsId);
                if (bundle) {
                    workspace[layer.id] = bundle;
                } else if (deferLarge) {
                    // Bundle path refused (oversized / missing) — stream at pack time.
                    workspaceDeferred[layer.id] = { workspaceLayerId: wsId, featureCount };
                }
            } else if (deferLarge) {
                workspaceDeferred[layer.id] = { workspaceLayerId: wsId, featureCount };
            }
        }
    }

    return {
        index,
        activeLayerId: activeLayerId || null,
        styles: layerStyles && typeof layerStyles === 'object' ? layerStyles : {},
        layerGroups: Array.isArray(layerGroups) ? layerGroups : [],
        spatial,
        tables,
        workspace,
        workspaceDeferred,
        rasters
    };
}

function normalizeSections(sections) {
    const set = new Set(Array.isArray(sections) ? sections : PROJECT_KIT_SECTIONS);
    return PROJECT_KIT_SECTIONS.filter((key) => set.has(key));
}

/**
 * @param {object} snapshot
 * @param {object} JSZipLib
 * @param {{ updateProgress?: (n:number,s?:string)=>void }} [task]
 * @param {{
 *   writeWorkspaceLayer?: (zip: object, folderKey: string, workspaceLayerId: string, helpers: object) => Promise<any>,
 *   getSourceFile?: (key: string) => Promise<File|null>,
 * }} [packOptions]
 */
export async function packProjectKit(snapshot, JSZipLib, task, packOptions = {}) {
    if (!JSZipLib) throw new AppError('JSZip library not loaded', ErrorCategory.PARSE_FAILED);
    const zip = new JSZipLib();
    task?.updateProgress?.(5, 'Writing manifest…');
    zip.file('manifest.json', JSON.stringify(snapshot.manifest, null, 2));

    if (snapshot.layers) {
        task?.updateProgress?.(15, 'Packing layers…');
        zip.file('layers/index.json', JSON.stringify({
            index: snapshot.layers.index,
            activeLayerId: snapshot.layers.activeLayerId,
            layerGroups: snapshot.layers.layerGroups || []
        }, null, 2));
        zip.file('layers/styles.json', JSON.stringify(snapshot.layers.styles || {}, null, 2));

        for (const [id, geojson] of Object.entries(snapshot.layers.spatial || {})) {
            zip.file(`layers/spatial/${id}.geojson`, JSON.stringify(geojson));
        }
        for (const [id, rows] of Object.entries(snapshot.layers.tables || {})) {
            zip.file(`layers/tables/${id}.json`, JSON.stringify(rows));
        }
        for (const [id, bundle] of Object.entries(snapshot.layers.workspace || {})) {
            zip.file(`layers/workspace/${id}/meta.json`, JSON.stringify(bundle.meta, null, 2));
            for (const chunk of bundle.chunks || []) {
                zip.file(`layers/workspace/${id}/chunks/${chunk.id}.json`, JSON.stringify(chunk));
            }
            if (bundle.attributes?.length) {
                zip.file(`layers/workspace/${id}/attributes.json`, JSON.stringify(bundle.attributes));
            }
            if (bundle.cold?.length) {
                zip.file(`layers/workspace/${id}/cold.json`, JSON.stringify(bundle.cold));
            }
        }

        const deferred = Object.entries(snapshot.layers.workspaceDeferred || {});
        if (deferred.length && typeof packOptions.writeWorkspaceLayer === 'function') {
            let i = 0;
            for (const [folderKey, info] of deferred) {
                i++;
                task?.updateProgress?.(
                    20 + Math.round((i / deferred.length) * 35),
                    `Packing workspace layer ${i}/${deferred.length}…`
                );
                await packOptions.writeWorkspaceLayer(zip, folderKey, info.workspaceLayerId, {
                    onProgress: (done, total, label) => {
                        task?.updateProgress?.(
                            20 + Math.round((i / deferred.length) * 35),
                            `Workspace ${folderKey}: ${label || 'writing'} ${done}/${total}`
                        );
                    }
                });
            }
        }

        for (const [layerId, coverageRasters] of Object.entries(snapshot.layers.rasters || {})) {
            const manifest = stripCoverageRasterDataUrls(coverageRasters);
            zip.file(`layers/rasters/${layerId}/manifest.json`, JSON.stringify(manifest, null, 2));
            coverageRasters.forEach((raster, index) => {
                const bytes = dataUrlToBytes(raster.dataUrl);
                if (!bytes) return;
                const file = manifest[index]?.file || `${index}.png`;
                zip.file(`layers/rasters/${layerId}/${file}`, bytes);
            });
        }

        if (typeof packOptions.getSourceFile === 'function') {
            const keys = snapshot.manifest?.sourceKeys || collectSourceKeys(
                (snapshot.layers.index || []).map((entry) => ({ source: entry.source }))
            );
            let n = 0;
            for (const key of keys) {
                const file = await packOptions.getSourceFile(key);
                if (!file) continue;
                n++;
                task?.updateProgress?.(58 + Math.min(10, n), `Packing source ${n}…`);
                const safeName = String(file.name || 'source').replace(/[/\\:*?"<>|]/g, '_').slice(0, 150);
                const buf = await file.arrayBuffer();
                zip.file(`sources/${key}/${safeName}`, buf);
            }
            if (n > 0) {
                zip.file('sources/index.json', JSON.stringify({
                    count: n,
                    keys: keys.filter(Boolean)
                }, null, 2));
            }
        }
    }

    if (snapshot.map) {
        task?.updateProgress?.(70, 'Packing map settings…');
        zip.file('map.json', JSON.stringify(snapshot.map, null, 2));
    }

    if (snapshot.workflow) {
        task?.updateProgress?.(80, 'Packing pipeline…');
        zip.file('workflow/pipeline.json', JSON.stringify(snapshot.workflow.pipeline, null, 2));
    }

    if (snapshot.preferences) {
        task?.updateProgress?.(90, 'Packing preferences…');
        zip.file('preferences.json', JSON.stringify(snapshot.preferences, null, 2));
    }

    if (snapshot.widgets) {
        task?.updateProgress?.(92, 'Packing widget state…');
        zip.file('widgets.json', JSON.stringify(snapshot.widgets, null, 2));
    }

    task?.updateProgress?.(95, 'Compressing…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    task?.updateProgress?.(100, 'Done');
    return blob;
}

/**
 * @param {ArrayBuffer|Blob} input
 * @param {object} JSZipLib
 * @param {{ updateProgress?: (n:number,s?:string)=>void }} [task]
 */
export async function parseProjectKit(input, JSZipLib, task) {
    if (!JSZipLib?.loadAsync) {
        throw new AppError('JSZip library not loaded', ErrorCategory.PARSE_FAILED);
    }

    task?.updateProgress?.(5, 'Reading Toolbox Kit…');
    const buffer = input instanceof Blob ? await input.arrayBuffer() : input;
    const zip = await JSZipLib.loadAsync(buffer);

    const manifestRaw = await zip.file('manifest.json')?.async('string');
    if (!manifestRaw) {
        throw new AppError('Invalid Toolbox Kit — missing manifest.json', ErrorCategory.PARSE_FAILED);
    }

    const manifest = JSON.parse(manifestRaw);
    const validation = validateProjectKitManifest(manifest);
    if (!validation.ok) {
        throw new AppError(validation.error, ErrorCategory.UNSUPPORTED_FORMAT);
    }

    const sections = normalizeSections(manifest.sections);
    const snapshot = {
        manifest,
        layers: null,
        map: null,
        workflow: null,
        preferences: null,
        widgets: null,
        /** Retained for deferred workspace/source import (not serialized). */
        _zip: zip
    };

    if (sections.includes('layers') && zip.file('layers/index.json')) {
        task?.updateProgress?.(30, 'Loading layers…');
        snapshot.layers = await parseLayerSection(zip);
    }

    if (sections.includes('map') && zip.file('map.json')) {
        const mapRaw = await zip.file('map.json').async('string');
        snapshot.map = JSON.parse(mapRaw);
    }

    if (sections.includes('workflow') && zip.file('workflow/pipeline.json')) {
        task?.updateProgress?.(70, 'Loading pipeline…');
        const wfRaw = await zip.file('workflow/pipeline.json').async('string');
        snapshot.workflow = { pipeline: JSON.parse(wfRaw) };
    }

    if (sections.includes('preferences') && zip.file('preferences.json')) {
        const prefRaw = await zip.file('preferences.json').async('string');
        snapshot.preferences = JSON.parse(prefRaw);
    }

    if (sections.includes('widgets') && zip.file('widgets.json')) {
        const widgetsRaw = await zip.file('widgets.json').async('string');
        snapshot.widgets = JSON.parse(widgetsRaw);
    }

    task?.updateProgress?.(100, 'Done');
    return snapshot;
}

async function parseLayerSection(zip) {
    const indexRaw = await zip.file('layers/index.json').async('string');
    const indexDoc = JSON.parse(indexRaw);
    const stylesRaw = await zip.file('layers/styles.json')?.async('string');
    const styles = stylesRaw ? JSON.parse(stylesRaw) : {};

    const spatial = {};
    const tables = {};
    const workspace = {};
    const workspaceDeferred = {};
    const rasters = {};
    const sources = {};

    const paths = Object.keys(zip.files);
    for (const path of paths) {
        const spatialMatch = path.match(/^layers\/spatial\/(.+)\.geojson$/);
        if (spatialMatch) {
            spatial[spatialMatch[1]] = JSON.parse(await zip.file(path).async('string'));
            continue;
        }
        const tableMatch = path.match(/^layers\/tables\/(.+)\.json$/);
        if (tableMatch) {
            tables[tableMatch[1]] = JSON.parse(await zip.file(path).async('string'));
            continue;
        }
        const wsMetaMatch = path.match(/^layers\/workspace\/([^/]+)\/meta\.json$/);
        if (wsMetaMatch) {
            const layerKey = wsMetaMatch[1];
            const meta = JSON.parse(await zip.file(path).async('string'));
            const featureCount = meta.featureCount || 0;
            const hasAttrParts = paths.some((p) => p.startsWith(`layers/workspace/${layerKey}/attributes/part-`));
            const useDeferred = hasAttrParts || featureCount > 250_000;

            if (useDeferred) {
                workspaceDeferred[layerKey] = {
                    workspaceLayerId: meta.id || layerKey,
                    featureCount,
                    folderKey: layerKey
                };
                // Keep meta-only stub so index restore can find the folder.
                workspace[layerKey] = { meta, deferred: true };
            } else {
                const chunks = [];
                const chunkPrefix = `layers/workspace/${layerKey}/chunks/`;
                for (const chunkPath of paths) {
                    if (chunkPath.startsWith(chunkPrefix) && chunkPath.endsWith('.json')) {
                        chunks.push(JSON.parse(await zip.file(chunkPath).async('string')));
                    }
                }
                const attrPath = `layers/workspace/${layerKey}/attributes.json`;
                const attributes = zip.file(attrPath)
                    ? JSON.parse(await zip.file(attrPath).async('string'))
                    : [];
                const coldPath = `layers/workspace/${layerKey}/cold.json`;
                const cold = zip.file(coldPath)
                    ? JSON.parse(await zip.file(coldPath).async('string'))
                    : [];
                workspace[layerKey] = { meta, chunks, attributes, cold };
            }
            continue;
        }
        const rasterManifestMatch = path.match(/^layers\/rasters\/([^/]+)\/manifest\.json$/);
        if (rasterManifestMatch) {
            const layerKey = rasterManifestMatch[1];
            const manifest = JSON.parse(await zip.file(path).async('string'));
            const pngBlobsByFile = {};
            for (const entry of manifest) {
                const file = entry.file;
                if (!file) continue;
                const pngPath = `layers/rasters/${layerKey}/${file}`;
                const zipEntry = zip.file(pngPath);
                if (!zipEntry) continue;
                pngBlobsByFile[file] = await zipEntry.async('uint8array');
            }
            rasters[layerKey] = { manifest, pngBlobsByFile };
        }
        const sourceMatch = path.match(/^sources\/([^/]+)\/(.+)$/);
        if (sourceMatch && !path.endsWith('/')) {
            const key = sourceMatch[1];
            if (key === 'index.json' || path === 'sources/index.json') continue;
            const fileName = sourceMatch[2];
            if (!sources[key]) sources[key] = [];
            sources[key].push({ path, fileName });
        }
    }

    return {
        index: indexDoc.index || [],
        activeLayerId: indexDoc.activeLayerId || null,
        styles,
        layerGroups: indexDoc.layerGroups || [],
        spatial,
        tables,
        workspace,
        workspaceDeferred,
        rasters,
        sources
    };
}

/**
 * Load a deferred workspace folder from an open kit zip into IndexedDB.
 * @param {object} zip
 * @param {string} folderKey
 * @param {{ newLayerId?: string, importWorkspaceLayerFromParts: Function }} options
 */
export async function importDeferredWorkspaceFromZip(zip, folderKey, options) {
    const base = `layers/workspace/${folderKey}`;
    const metaRaw = await zip.file(`${base}/meta.json`)?.async('string');
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const paths = Object.keys(zip.files);

    const chunkPaths = paths
        .filter((p) => p.startsWith(`${base}/chunks/`) && p.endsWith('.json'))
        .sort();
    const attrPartPaths = paths
        .filter((p) => p.startsWith(`${base}/attributes/part-`) && p.endsWith('.json'))
        .sort();
    const coldPartPaths = paths
        .filter((p) => p.startsWith(`${base}/cold/part-`) && p.endsWith('.json'))
        .sort();
    const coldMono = zip.file(`${base}/cold.json`);

    return options.importWorkspaceLayerFromParts({
        meta,
        async *loadChunks() {
            for (const chunkPath of chunkPaths) {
                yield JSON.parse(await zip.file(chunkPath).async('string'));
            }
        },
        async *loadAttributeParts() {
            if (attrPartPaths.length) {
                for (const partPath of attrPartPaths) {
                    yield JSON.parse(await zip.file(partPath).async('string'));
                }
                return;
            }
            const mono = zip.file(`${base}/attributes.json`);
            if (mono) yield JSON.parse(await mono.async('string'));
        },
        async *loadColdParts() {
            if (coldPartPaths.length) {
                for (const partPath of coldPartPaths) {
                    yield JSON.parse(await zip.file(partPath).async('string'));
                }
                return;
            }
            if (coldMono) yield JSON.parse(await coldMono.async('string'));
        }
    }, { newLayerId: options.newLayerId });
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadProjectKit(blob, projectName) {
    const safeName = buildProjectKitDownloadName(projectName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(url);
}

export function summarizeProjectKit(snapshot) {
    const sections = snapshot?.manifest?.sections || [];
    const workflowConfig = snapshot?.workflow?.pipeline;
    const workflowInner = workflowConfig?.pipeline ?? workflowConfig;
    const workflowNodeCount = workflowInner?.nodes?.length ?? 0;
    return {
        projectName: snapshot?.manifest?.projectName || null,
        exportedAt: snapshot?.manifest?.exportedAt || null,
        layerCount: snapshot?.layers?.index?.length ?? snapshot?.manifest?.layerCount ?? 0,
        sections,
        hasMap: !!snapshot?.map,
        hasWorkflow: workflowNodeCount > 0,
        hasPreferences: !!snapshot?.preferences,
        hasWidgets: Array.isArray(snapshot?.widgets?.activeWidgets) && snapshot.widgets.activeWidgets.length > 0,
        widgetCount: snapshot?.widgets?.activeWidgets?.length ?? 0,
        workflowNodeCount
    };
}

export default {
    PROJECT_KIT_FORMAT,
    PROJECT_KIT_FORMAT_VERSION,
    PROJECT_KIT_EXTENSION,
    PROJECT_KIT_LEGACY_EXTENSION,
    PROJECT_KIT_DISPLAY_NAME,
    PROJECT_KIT_SECTIONS,
    isProjectKitFile,
    formatProjectKitDate,
    sanitizeProjectKitBaseName,
    buildProjectKitDownloadName,
    validateProjectKitManifest,
    resolveLayerIdConflict,
    sanitizeProjectKitFilename,
    buildProjectKitSnapshot,
    packProjectKit,
    parseProjectKit,
    importDeferredWorkspaceFromZip,
    downloadProjectKit,
    summarizeProjectKit
};
