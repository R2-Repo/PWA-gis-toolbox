/**
 * Input nodes — data sources that start a pipeline
 */
import { NodeBase } from './node-base.js';
import { normalizeImporterResult, serializeImportedDataset, finalizeImportedDatasets } from '../../import/post-import.js';
import {
    isWorkspaceLayer,
    isLiveVectorLayer,
    isPmTilesLayer,
    isCogLayer,
    isServiceLayer,
    getLayerFeatureCount
} from '../../core/data-model.js';
import { getAdaptiveMaterializeLimit } from '../../import/import-capacity-context.js';
import { loadAllWorkspaceFeatures } from '../../workspace/workspace-store.js';

function cloneValue(value) {
    if (value == null) return value;
    return structuredClone(value);
}

function layerInputError(layer, message) {
    const label = layer?.name ? `"${layer.name}"` : 'The selected layer';
    throw new Error(`${label} — ${message}`);
}

// ==============================
// Layer Input — pick an existing layer
// ==============================
export class LayerInputNode extends NodeBase {
    constructor() {
        super('layer-input', {
            name: 'Layer Input',
            icon: '📂',
            category: 'input',
            color: '#d97706'
        });
        this.outputPorts = [{ id: 'out', label: 'Data', dataType: 'dataset' }];
        this.config = { layerId: null };
    }

    validate() {
        if (!this.config.layerId) return { valid: false, message: 'No layer selected' };
        return { valid: true, message: '' };
    }

    getOutputPreview(context) {
        if (this._outputData) return this._outputData;
        if (!this.config.layerId || !context?.getLayers) return null;
        const layer = context.getLayers().find(l => l.id === this.config.layerId);
        if (!layer) return null;
        return { type: layer.type, schema: layer.schema, name: layer.name };
    }

    getCanvasDetail(context = {}) {
        if (!this.config.layerId || !context.getLayers) return null;
        const layer = context.getLayers().find((l) => l.id === this.config.layerId);
        return layer?.name || null;
    }

    async execute(inputs, context) {
        const layer = context.getLayers().find(l => l.id === this.config.layerId);
        if (!layer) throw new Error('Source layer not found');

        if (layer.type === 'table') {
            if (!Array.isArray(layer.rows)) {
                layerInputError(layer, 'is a table layer but has no row data loaded.');
            }
            return {
                type: 'table',
                rows: cloneValue(layer.rows),
                schema: cloneValue(layer.schema),
                name: layer.name
            };
        }

        if (isPmTilesLayer(layer)) {
            layerInputError(
                layer,
                'is a PMTiles layer and has no feature geometry in memory for workflow pipelines. Use a feature layer instead.'
            );
        }

        if (isCogLayer(layer)) {
            layerInputError(
                layer,
                'is a COG raster layer. Raster layers cannot be used as workflow feature datasets.'
            );
        }

        if (isServiceLayer(layer) && !isLiveVectorLayer(layer)) {
            layerInputError(
                layer,
                'is a live map service layer that does not expose features for offline workflow use.'
            );
        }

        if (isWorkspaceLayer(layer)) {
            const wsId = layer.workspaceLayerId || layer.id;
            const featureCount = getLayerFeatureCount(layer);
            const materializeLimit = getAdaptiveMaterializeLimit([layer]);
            if (featureCount > materializeLimit) {
                layerInputError(
                    layer,
                    `has ${featureCount.toLocaleString()} features — too many to load for this workflow step (limit ${materializeLimit.toLocaleString()}).`
                );
            }
            const features = await loadAllWorkspaceFeatures(wsId);
            return {
                type: 'spatial',
                geojson: { type: 'FeatureCollection', features },
                schema: cloneValue(layer.schema),
                name: layer.name
            };
        }

        if (isLiveVectorLayer(layer)) {
            const features = layer.geojson?.features;
            if (!Array.isArray(features) || features.length === 0) {
                layerInputError(
                    layer,
                    'is a live service layer with no features in the current map view. Pan or zoom the map to load features, or choose a different layer.'
                );
            }
            return {
                type: 'spatial',
                geojson: {
                    type: 'FeatureCollection',
                    features: features.map((f) => cloneValue(f))
                },
                schema: cloneValue(layer.schema),
                name: `${layer.name} (current map view only)`
            };
        }

        if (layer.type === 'spatial') {
            return {
                type: 'spatial',
                geojson: cloneValue(layer.geojson),
                schema: cloneValue(layer.schema),
                name: layer.name
            };
        }

        layerInputError(
            layer,
            `has type "${layer.type || 'unknown'}" and cannot be used as a workflow input.`
        );
    }
}

// ==============================
// File Import — upload a file inline
// ==============================
export class FileImportNode extends NodeBase {
    constructor() {
        super('file-import', {
            name: 'File Import',
            icon: '📎',
            category: 'input',
            color: '#d97706'
        });
        this.outputPorts = [{ id: 'out', label: 'Data', dataType: 'dataset' }];
        this.config = { fileName: null };
        this._pendingFile = null;
        this._cachedResult = null;
    }

    validate() {
        if (!this._cachedResult && !this._pendingFile) return { valid: false, message: 'No file imported' };
        return { valid: true, message: '' };
    }

    getOutputPreview() {
        if (this._outputData) return this._outputData;
        if (this._cachedResult) return { type: this._cachedResult.type, schema: this._cachedResult.schema, name: this._cachedResult.name };
        return null;
    }

    getCanvasDetail() {
        return this.config.fileName || null;
    }

    async execute(inputs, context) {
        if (this._cachedResult) {
            return JSON.parse(JSON.stringify(this._cachedResult));
        }
        if (!this._pendingFile) throw new Error('No file imported — select a file first');
        const result = await context.importFile(this._pendingFile);
        if (!result) throw new Error('Import failed');
        const { expanded } = await finalizeImportedDatasets(normalizeImporterResult(result));
        if (expanded.length === 0) throw new Error('Import returned no layers');
        this._multiLayerCount = expanded.length;
        const out = serializeImportedDataset(expanded[0]);
        this._cachedResult = out;
        this._pendingFile = null;
        return JSON.parse(JSON.stringify(out));
    }
}

// ==============================
// Registry
// ==============================
export const INPUT_NODES = [
    { type: 'layer-input', label: 'Layer Input', icon: '📂', create: () => new LayerInputNode() },
    { type: 'file-import', label: 'File Import', icon: '📎', create: () => new FileImportNode() }
];
