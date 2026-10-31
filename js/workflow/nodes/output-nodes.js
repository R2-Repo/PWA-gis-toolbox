/**
 * Output nodes — Preview, Add to Map, Export
 */
import { NodeBase } from './node-base.js';
import { exportDataset, getAvailableFormats } from '../../export/exporter.js';
import { runWithWorkflowContext } from '../workflow-task-bridge.js';
import { throwIfAborted } from '../workflow-run-helpers.js';
import {
    buildExportOptions,
    formatAvailableForDataset,
    formatMismatchMessage,
    getFormatLabel,
    isExportInputEmpty,
    pickDefaultExportFormatKey,
    resolveExportFilenameBase
} from '../export-node-utils.js';

export class PreviewNode extends NodeBase {
    constructor() {
        super('preview', {
            name: 'Preview',
            icon: '👁️',
            category: 'output',
            color: '#7c3aed'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [];
        this.config = { maxRows: 500 };
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        context.showPreview?.(data, this.config.maxRows);
        return data;
    }
}

export class AddToMapNode extends NodeBase {
    constructor() {
        super('add-to-map', {
            name: 'Add to Map',
            icon: '🗺️',
            category: 'output',
            color: '#7c3aed'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [];
        this.config = { layerName: '' };
        this._lastLayerId = null;
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const name = this.config.layerName || data.name || 'Workflow Result';
        const layerId = context.addToMap?.(data, name);
        if (layerId) this._lastLayerId = layerId;
        return data;
    }
}

export class ExportNode extends NodeBase {
    constructor() {
        super('export', {
            name: 'Export',
            icon: '💾',
            category: 'output',
            color: '#7c3aed'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Data', dataType: 'dataset' }];
        this.config = {
            format: 'geojson',
            filename: '',
            targetCrs: ''
        };
    }

    validate() {
        if (!this.config.format) {
            return { valid: false, message: 'Choose an export format' };
        }
        return { valid: true, message: '' };
    }

    getCanvasDetail(context = {}) {
        const upstream = context.getUpstreamOutput?.(this.id);
        const format = this.config.format || (upstream ? pickDefaultExportFormatKey(upstream) : 'geojson');
        const label = upstream ? getFormatLabel(format, upstream) : format;
        const base = upstream
            ? resolveExportFilenameBase(upstream, this.config)
            : (this.config.filename || 'export');
        return `${label} → ${base}`;
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data connected');
        if (isExportInputEmpty(data)) {
            throw new Error('Input dataset is empty — nothing to export');
        }

        throwIfAborted(context?.signal);

        const format = this.config.format || pickDefaultExportFormatKey(data);
        if (!formatAvailableForDataset(data, format)) {
            throw new Error(formatMismatchMessage(format, data));
        }

        const options = buildExportOptions(data, { ...this.config, format });
        const formatLabel = getFormatLabel(format, data);

        context.reportProgress?.({
            progress: 0,
            message: `Starting ${formatLabel} export…`
        });

        try {
            await runWithWorkflowContext(context, () => exportDataset(data, format, options));
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            const msg = err?.message || String(err);
            throw new Error(`Export failed: ${msg}`);
        }

        context.reportProgress?.({
            progress: 1,
            message: `${formatLabel} export complete`
        });

        return data;
    }
}

export const OUTPUT_NODES = [
    { type: 'preview', label: 'Preview', icon: '👁️', create: () => new PreviewNode() },
    { type: 'add-to-map', label: 'Add to Map', icon: '🗺️', create: () => new AddToMapNode() },
    { type: 'export', label: 'Export', icon: '💾', create: () => new ExportNode() }
];

/** @returns {ReturnType<typeof getAvailableFormats>} */
export function exportFormatsForDataset(dataset) {
    return getAvailableFormats(dataset);
}
