/**
 * ArcGIS REST Feature Layer Importer (public only, no SDK)
 * Uses fetch() and standard REST query parameters
 */
import logger from '../core/logger.js';
import {
    createSpatialDataset,
    createTableDataset,
    createChunkedSpatialDataset
} from '../core/data-model.js';
import { TaskRunner, yieldToUI } from '../core/task-runner.js';
import { handleError, AppError, ErrorCategory } from '../core/error-handler.js';
import {
    filterFeatureProperties,
    applySelectedFieldsToSchema,
    shouldFilterFields
} from '../import/import-field-filter.js';
import {
    createWorkspaceLayer,
    appendWorkspaceBatch,
    flushSpatialIndexSave,
    WORKSPACE_CHUNK_SIZE
} from '../workspace/workspace-store.js';
import { createSpatialChunkWriter } from '../workspace/spatial-chunk-writer.js';
import { applyArcgisScaleRangeToLayer } from '../map/scale-range.js';
import { requiredStyleFieldsFromDrawingInfo, styleFromArcgisMetadata } from './drawing-info.js';

/** Maximum features to download without explicit user override. */
export const ARCGIS_MAX_FEATURES = 250_000;

/**
 * Convert one ESRI feature JSON object to GeoJSON Feature.
 * @param {object} f
 * @param {(g: object) => object|null} convertGeometry
 */
export function esriFeatureToGeoJSON(f, convertGeometry) {
    const convert = convertGeometry || ((g) => g);
    return {
        type: 'Feature',
        geometry: convert(f.geometry),
        properties: f.attributes || {}
    };
}

/** Whether UI should confirm before downloading a layer over the soft feature cap. */
export function arcgisNeedsLargeDownloadConfirm(metadata, queryOptions = {}) {
    if (queryOptions.allowLargeDownload || queryOptions.spatialFilter) return false;
    const total = metadata?.totalCount;
    return total != null && total > ARCGIS_MAX_FEATURES;
}

/** Build layer schema from ArcGIS layer metadata (no feature scan). */
export function schemaFromArcgisMetadata(metadata, selectedFields = null) {
    const fields = (metadata?.fields || []).filter((f) => {
        if (!shouldFilterFields(selectedFields)) return true;
        return selectedFields.includes(f.name);
    });
    return {
        fields: fields.map((f, order) => ({
            name: f.name,
            type: f.type || 'string',
            nullCount: 0,
            uniqueCount: 0,
            sampleValues: [],
            min: null,
            max: null,
            selected: true,
            outputName: f.alias || f.name,
            order
        })),
        geometryType: metadata?.geometryType || null,
        featureCount: 0,
        crs: 'EPSG:4326'
    };
}

/**
 * Append ESRI features to workspace in spatially bucketed chunks.
 */
export async function appendArcgisFeaturesToWorkspace(
    layerId,
    esriFeatures,
    convertGeometry,
    startIndex,
    selectedFields = null,
    displayFields = null
) {
    if (!esriFeatures?.length) return 0;

    const writer = createSpatialChunkWriter({
        chunkSize: WORKSPACE_CHUNK_SIZE,
        initialIndex: startIndex,
        onFlush: async (batch, index) => {
            await appendWorkspaceBatch(layerId, batch, index, selectedFields, { displayFields });
        }
    });

    for (let i = 0; i < esriFeatures.length; i++) {
        const feature = filterFeatureProperties(
            esriFeatureToGeoJSON(esriFeatures[i], convertGeometry),
            selectedFields
        );
        await writer.add(feature);
    }
    await writer.flush();
    return writer.writtenCount - startIndex;
}

function attachArcgisImportStyle(dataset, metadata) {
    const styled = applyArcgisScaleRangeToLayer(dataset, metadata);
    const style = styleFromArcgisMetadata(metadata);
    if (style) styled._arcgisStyle = style;
    return styled;
}

function _pushAll(target, items) {
    for (let i = 0; i < items.length; i++) {
        target.push(items[i]);
    }
}

export class ArcGISRestImporter {
    constructor() {
        this.metadata = null;
        this.abortController = null;
    }

    /**
     * Step 1: Validate URL and fetch layer metadata
     */
    async fetchMetadata(url) {
        logger.info('ArcGIS', 'Fetching metadata', { url });
        const cleanUrl = this.normalizeUrl(url);

        try {
            const response = await fetch(`${cleanUrl}?f=json`, {
                signal: AbortSignal.timeout(15000)
            });

            if (response.status === 401 || response.status === 403) {
                throw new AppError(
                    'This layer requires authentication. Only public layers are supported.',
                    ErrorCategory.AUTH_REQUIRED,
                    { url, status: response.status }
                );
            }
            if (!response.ok) {
                throw new AppError(
                    `Server returned HTTP ${response.status}`,
                    ErrorCategory.HTTP_4XX,
                    { url, status: response.status }
                );
            }

            const data = await response.json();

            if (data.error) {
                throw new AppError(
                    data.error.message || 'Service returned an error',
                    ErrorCategory.HTTP_4XX,
                    { url, error: data.error }
                );
            }

            if (!data.fields && !data.type) {
                throw new AppError(
                    'This URL does not appear to be a valid ArcGIS Feature Layer endpoint',
                    ErrorCategory.PARSE_FAILED,
                    { url }
                );
            }

            this.metadata = {
                name: data.name || 'ArcGIS Layer',
                minScale: data.minScale || null,
                maxScale: data.maxScale || null,
                displayField: data.displayField || data.displayFieldName || null,
                drawingInfo: data.drawingInfo || null,
                geometryType: this.mapGeometryType(data.geometryType),
                fields: (data.fields || []).map(f => ({
                    name: f.name,
                    alias: f.alias || f.name,
                    type: this.mapFieldType(f.type),
                    esriType: f.type
                })),
                maxRecordCount: data.maxRecordCount || 1000,
                objectIdField: data.objectIdField || data.objectIdFieldName || 'OBJECTID',
                url: cleanUrl,
                supportsResultOffset: data.advancedQueryCapabilities?.supportsPagination !== false,
                totalCount: null
            };

            // Try to get total count
            try {
                const countResp = await fetch(`${cleanUrl}/query?where=1=1&returnCountOnly=true&f=json`);
                const countData = await countResp.json();
                if (countData.count != null) {
                    this.metadata.totalCount = countData.count;
                }
            } catch (_) { /* ignore count errors */ }

            logger.info('ArcGIS', 'Metadata fetched', {
                name: this.metadata.name,
                fields: this.metadata.fields.length,
                geometryType: this.metadata.geometryType,
                maxRecordCount: this.metadata.maxRecordCount,
                totalCount: this.metadata.totalCount
            });

            return this.metadata;

        } catch (e) {
            if (e instanceof AppError) throw e;
            if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
                throw new AppError(
                    'Cannot reach this server. It may be blocking cross-origin requests (CORS).',
                    ErrorCategory.CORS_BLOCKED,
                    { url }
                );
            }
            if (e.name === 'TimeoutError' || e.name === 'AbortError') {
                throw new AppError('Request timed out', ErrorCategory.TIMEOUT, { url });
            }
            throw new AppError(
                'Failed to fetch layer metadata: ' + e.message,
                ErrorCategory.NETWORK_ERROR,
                { url }
            );
        }
    }

    /**
     * Step 2: Download features with pagination
     */
    async downloadFeatures(queryOptions = {}, task) {
        if (!this.metadata) throw new Error('Fetch metadata first');

        const t = task || new TaskRunner('ArcGIS Download', 'ArcGIS');
        this.abortController = new AbortController();

        const {
            outFields = '*',
            where = '1=1',
            returnGeometry = true,
            spatialFilter = null,
            allowLargeDownload = false,
            selectedFields = null,
            displayFields = null
        } = queryOptions;

        const mapDisplayFields = displayFields?.length
            ? displayFields
            : requiredStyleFieldsFromDrawingInfo(this.metadata.drawingInfo);

        const url = this.metadata.url;
        const maxRec = this.metadata.maxRecordCount || 1000;
        let offset = 0;
        let page = 0;
        let done = false;
        const totalExpected = this.metadata.totalCount;
        const streamToWorkspace = returnGeometry && queryOptions.useWorkspace !== false;
        const convertGeom = (g) => this.convertGeometry(g);

        /** @type {object[]} raw ESRI features — only when not streaming spatial to workspace */
        const allFeatures = [];
        let workspaceLayerId = null;
        let datasetShell = null;
        let featureOffset = 0;

        if (
            totalExpected != null
            && totalExpected > ARCGIS_MAX_FEATURES
            && !allowLargeDownload
            && !spatialFilter
        ) {
            throw new AppError(
                `This layer has ${totalExpected.toLocaleString()} features — exceeds the ${ARCGIS_MAX_FEATURES.toLocaleString()} feature limit. Apply a filter or use a smaller layer.`,
                ErrorCategory.OUT_OF_MEMORY,
                { totalCount: totalExpected, max: ARCGIS_MAX_FEATURES }
            );
        }

        logger.info('ArcGIS', 'Starting download', { where, outFields, maxRec, totalExpected });

        const run = async (runner) => {
            while (!done) {
                runner.throwIfCancelled();
                page++;

                const params = new URLSearchParams({
                    where,
                    outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
                    returnGeometry: String(returnGeometry),
                    f: 'json',
                    resultOffset: String(offset),
                    resultRecordCount: String(maxRec),
                    outSR: '4326'
                });

                if (spatialFilter) {
                    params.set('geometry', JSON.stringify(spatialFilter));
                    params.set('geometryType', 'esriGeometryEnvelope');
                    params.set('spatialRel', 'esriSpatialRelIntersects');
                    params.set('inSR', '4326');
                }

                let data;
                let retries = 0;
                const maxRetries = 3;

                while (retries <= maxRetries) {
                    try {
                        const resp = await fetch(`${url}/query?${params}`, {
                            signal: this.abortController.signal
                        });

                        if (resp.status === 429) {
                            retries++;
                            if (retries > maxRetries) throw new AppError('Rate limited', ErrorCategory.RATE_LIMIT);
                            logger.warn('ArcGIS', `Rate limited, retry ${retries}/${maxRetries}`);
                            await new Promise(r => setTimeout(r, 2000 * retries));
                            continue;
                        }

                        if (!resp.ok) {
                            throw new AppError(`HTTP ${resp.status}`, resp.status >= 500 ? ErrorCategory.HTTP_5XX : ErrorCategory.HTTP_4XX);
                        }

                        data = await resp.json();
                        break;
                    } catch (e) {
                        if (e.name === 'AbortError') throw e;
                        if (e instanceof AppError) throw e;
                        retries++;
                        if (retries > maxRetries) throw e;
                        logger.warn('ArcGIS', `Request failed, retry ${retries}/${maxRetries}`, { error: e.message });
                        await new Promise(r => setTimeout(r, 1000 * retries));
                    }
                }

                if (data.error) {
                    throw new AppError(data.error.message || 'Query error', ErrorCategory.HTTP_4XX, { error: data.error });
                }

                const features = data.features || [];
                if (features.length === 0) {
                    done = true;
                    break;
                }

                if (streamToWorkspace) {
                    if (!workspaceLayerId) {
                        datasetShell = createChunkedSpatialDataset(
                            this.metadata.name,
                            { schema: schemaFromArcgisMetadata(this.metadata, selectedFields) },
                            { format: 'arcgis-rest', url, importSelectedFields: selectedFields || undefined }
                        );
                        workspaceLayerId = datasetShell.workspaceLayerId || datasetShell.id;
                        await createWorkspaceLayer({
                            id: workspaceLayerId,
                            name: this.metadata.name,
                            source: datasetShell.source,
                            schema: datasetShell.schema
                        });
                    }
                    const added = await appendArcgisFeaturesToWorkspace(
                        workspaceLayerId,
                        features,
                        convertGeom,
                        featureOffset,
                        selectedFields,
                        mapDisplayFields
                    );
                    featureOffset += added;
                } else {
                    _pushAll(allFeatures, features);
                }

                const fetchedTotal = streamToWorkspace ? featureOffset : allFeatures.length;
                logger.debug('ArcGIS', `Page ${page}`, { fetched: features.length, total: fetchedTotal });

                if (
                    !streamToWorkspace
                    && fetchedTotal > ARCGIS_MAX_FEATURES
                    && !allowLargeDownload
                ) {
                    throw new AppError(
                        `Download exceeded ${ARCGIS_MAX_FEATURES.toLocaleString()} features. Narrow your query or filter.`,
                        ErrorCategory.OUT_OF_MEMORY,
                        { fetched: fetchedTotal }
                    );
                }

                if (features.length < maxRec || !data.exceededTransferLimit) {
                    done = true;
                }

                const pct = totalExpected
                    ? Math.round((fetchedTotal / totalExpected) * 90)
                    : Math.min(page * 10, 90);
                runner.updateProgress(pct, `Page ${page}: ${fetchedTotal.toLocaleString()} features...`);

                offset += features.length;
                await yieldToUI();
            }

            if (streamToWorkspace) {
                await flushSpatialIndexSave();
            }

            runner.updateProgress(95, streamToWorkspace ? 'Finalizing workspace layer...' : 'Normalizing features...');

            if (streamToWorkspace && workspaceLayerId && datasetShell) {
                const workspaceResult = {
                    ...datasetShell,
                    type: 'spatial-chunked',
                    storage: 'workspace',
                    workspaceLayerId,
                    geojson: { type: 'FeatureCollection', features: [] },
                    schema: applySelectedFieldsToSchema(
                        { ...datasetShell.schema, featureCount: featureOffset },
                        selectedFields
                    ),
                    source: {
                        ...datasetShell.source,
                        importSelectedFields: selectedFields || undefined,
                        mapDisplayFields: mapDisplayFields.length ? mapDisplayFields : undefined
                    },
                    _viewportCache: true
                };
                return attachArcgisImportStyle(workspaceResult, this.metadata);
            }

            const geojsonFeatures = allFeatures.map((f) => esriFeatureToGeoJSON(f, (g) => this.convertGeometry(g)));

            const fc = { type: 'FeatureCollection', features: geojsonFeatures };
            const hasGeometry = geojsonFeatures.some(f => f.geometry != null);

            if (hasGeometry) {
                const dataset = createSpatialDataset(
                    this.metadata.name,
                    fc,
                    {
                        format: 'arcgis-rest',
                        url,
                        features: geojsonFeatures.length,
                        mapDisplayFields: mapDisplayFields.length ? mapDisplayFields : undefined
                    }
                );
                return attachArcgisImportStyle(dataset, this.metadata);
            } else {
                const rows = geojsonFeatures.map(f => f.properties);
                return createTableDataset(
                    this.metadata.name,
                    rows,
                    null,
                    { format: 'arcgis-rest', url }
                );
            }
        };

        if (t.run) {
            return t.run(run);
        }
        return run(t);
    }

    cancel() {
        if (this.abortController) this.abortController.abort();
    }

    normalizeUrl(url) {
        let u = url.trim();
        // Remove trailing slashes
        u = u.replace(/\/+$/, '');
        // Remove query string
        u = u.split('?')[0];
        return u;
    }

    mapGeometryType(esriType) {
        const map = {
            esriGeometryPoint: 'Point',
            esriGeometryMultipoint: 'MultiPoint',
            esriGeometryPolyline: 'LineString',
            esriGeometryPolygon: 'Polygon'
        };
        return map[esriType] || esriType || null;
    }

    mapFieldType(esriType) {
        if (!esriType) return 'string';
        if (esriType.includes('Integer') || esriType.includes('Double') || esriType.includes('Single')) return 'number';
        if (esriType.includes('Date')) return 'date';
        return 'string';
    }

    convertGeometry(geom) {
        if (!geom) return null;
        if (geom.x != null && geom.y != null) {
            return { type: 'Point', coordinates: [geom.x, geom.y] };
        }
        if (geom.points) {
            return { type: 'MultiPoint', coordinates: geom.points.map(p => [p[0], p[1]]) };
        }
        if (geom.paths) {
            if (geom.paths.length === 1) {
                return { type: 'LineString', coordinates: geom.paths[0] };
            }
            return { type: 'MultiLineString', coordinates: geom.paths };
        }
        if (geom.rings) {
            // Determine outer/inner rings (simplified)
            if (geom.rings.length === 1) {
                return { type: 'Polygon', coordinates: geom.rings };
            }
            // For multiple rings, simple approach: treat as MultiPolygon with one poly
            return { type: 'Polygon', coordinates: geom.rings };
        }
        return null;
    }

    getMetadata() { return this.metadata; }

    /**
     * Browse a REST services directory and return all Feature/Map Server layers
     * Accepts URLs like:
     *   https://services.arcgis.com/orgId/arcgis/rest/services/
     *   https://server.example.com/server/rest/services/
     *   https://server.example.com/arcgis/rest/services/FolderName
     */
    async browseServices(baseUrl, onProgress) {
        let url = baseUrl.trim().replace(/\/+$/, '').split('?')[0];

        // Ensure it ends with /rest/services or contains it
        if (!url.toLowerCase().includes('/rest/services') && !url.toLowerCase().includes('/rest')) {
            url += '/rest/services';
        }

        logger.info('ArcGIS', 'Browsing services directory', { url });
        if (onProgress) onProgress('Fetching services directory...');

        const catalog = await this._fetchJson(url);
        if (!catalog || catalog.error) {
            throw new AppError(
                catalog?.error?.message || 'Could not read services directory',
                ErrorCategory.PARSE_FAILED,
                { url }
            );
        }

        const results = [];

        // Process services at this level
        const services = catalog.services || [];
        const folders = catalog.folders || [];
        const total = services.length + folders.length;
        let done = 0;

        for (const svc of services) {
            done++;
            if (onProgress) onProgress(`Scanning service ${done}/${total}: ${svc.name}...`);
            const svcType = svc.type || '';
            if (svcType === 'FeatureServer' || svcType === 'MapServer') {
                const svcUrl = `${url}/${svc.name}/${svcType}`;
                try {
                    const layers = await this._fetchServiceLayers(svcUrl, svc.name, svcType);
                    for (const layer of layers) results.push(layer);
                } catch (_) {
                    // Skip inaccessible services
                    logger.warn('ArcGIS', `Skipped inaccessible service: ${svc.name}`);
                }
            }
        }

        // Recurse into folders
        for (const folder of folders) {
            done++;
            if (onProgress) onProgress(`Scanning folder ${done}/${total}: ${folder}...`);
            try {
                const folderUrl = `${url}/${folder}`;
                const folderData = await this._fetchJson(folderUrl);
                if (folderData?.services) {
                    for (const svc of folderData.services) {
                        const svcType = svc.type || '';
                        if (svcType === 'FeatureServer' || svcType === 'MapServer') {
                            const svcUrl = `${url}/${svc.name}/${svcType}`;
                            try {
                                const layers = await this._fetchServiceLayers(svcUrl, svc.name, svcType);
                                for (const layer of layers) results.push(layer);
                            } catch (_) {
                                logger.warn('ArcGIS', `Skipped inaccessible service: ${svc.name}`);
                            }
                        }
                    }
                }
            } catch (_) {
                logger.warn('ArcGIS', `Skipped inaccessible folder: ${folder}`);
            }
        }

        logger.info('ArcGIS', `Found ${results.length} layers`, { url });
        return results;
    }

    async _fetchServiceLayers(svcUrl, svcName, svcType) {
        const data = await this._fetchJson(svcUrl);
        if (!data || data.error) return [];

        const layers = data.layers || [];
        const shortName = svcName.includes('/') ? svcName.split('/').pop() : svcName;

        // Extract service-level metadata
        const svcDescription = data.serviceDescription || data.description || '';
        const svcCopyright = data.copyrightText || '';
        const svcAuthor = data.documentInfo?.Author || '';
        const svcVersion = data.currentVersion || null;
        const svcCapabilities = data.capabilities || '';

        // Last edit date from editingInfo
        let svcLastEdit = null;
        if (data.editingInfo?.lastEditDate) {
            svcLastEdit = data.editingInfo.lastEditDate;
        } else if (data.editingInfo?.dataLastEditDate) {
            svcLastEdit = data.editingInfo.dataLastEditDate;
        }

        return layers.map(l => ({
            name: l.name,
            serviceName: shortName,
            serviceType: svcType,
            layerId: l.id,
            geometryType: l.geometryType ? this.mapGeometryType(l.geometryType) : (l.type === 'Feature Layer' ? 'Unknown' : 'Table'),
            url: `${svcUrl}/${l.id}`,
            minScale: l.minScale || null,
            maxScale: l.maxScale || null,
            // Service-level metadata
            description: svcDescription,
            copyright: svcCopyright,
            author: svcAuthor,
            serverVersion: svcVersion,
            capabilities: svcCapabilities,
            lastEditDate: svcLastEdit
        }));
    }

    async _fetchJson(url) {
        const sep = url.includes('?') ? '&' : '?';
        const resp = await fetch(`${url}${sep}f=json`, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }
}

export const arcgisImporter = new ArcGISRestImporter();
export default arcgisImporter;
