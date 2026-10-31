/**
 * Registers all map tools, widgets, and workflow nodes into the shared tool registry.
 */
import { registerTool } from './tool-registry.js';
import { WORKER_RUNS } from './registry/compute-run-bridge.js';

const V1_GA_NODES = new Set([
    'layer-input',
    'file-import',
    'split-column',
    'combine-fields',
    'template-builder',
    'find-replace',
    'type-convert',
    'filter-rows',
    'deduplicate',
    'join-lookup',
    'add-unique-id',
    'buffer',
    'simplify',
    'clip',
    'dissolve',
    'line-offset',
    'reproject',
    'spatial-join',
    'union',
    'sample',
    'explode',
    'polygon-to-line',
    'fill-holes',
    'split-by-line',
    'split-by-polygon',
    'add-to-map',
    'preview',
    'export'
]);

const V1_GA_MAP_TOOL_IDS = new Set([
    'buffer',
    'simplify',
    'clip-extent',
    'bbox-clip',
    'dissolve',
    'line-offset',
    'reproject',
    'union',
    'kinks',
    'sample',
    'explode',
    'polygon-to-line',
    'fill-holes',
    'split-by-line',
    'split-by-polygon',
    'vertex-reshape'
]);

const MAP_TOOL_STATUS = (mapId) => (V1_GA_MAP_TOOL_IDS.has(mapId) ? 'ga' : 'hidden');

function nodeStatus(type) {
    return V1_GA_NODES.has(type) ? 'ga' : 'hidden';
}

function registerNodeEntry(def) {
    registerTool({
        version: def.version ?? 1,
        id: def.id,
        aliases: def.aliases,
        kind: ['node'],
        label: def.label,
        icon: def.icon,
        category: def.category ?? 'workflow',
        status: def.status ?? nodeStatus(def.id),
        inputs: def.inputs,
        outputs: def.outputs,
        params: def.params ?? [],
        workerSafe: def.workerSafe ?? false,
        run: def.run
    });
}

function registerWorkerNode(def) {
    const run = WORKER_RUNS[def.id];
    registerNodeEntry({
        ...def,
        workerSafe: Boolean(run),
        run
    });
}

function registerCanvasNode(def) {
    registerNodeEntry({
        ...def,
        workerSafe: false
    });
}

function registerMapToolEntry(def) {
    registerTool({
        version: def.version ?? 1,
        id: def.id,
        aliases: def.aliases,
        kind: def.kind ?? ['tool'],
        label: def.label,
        icon: def.icon,
        tip: def.tip,
        category: def.category,
        status: def.status,
        mapAction: def.mapAction,
        inputs: def.inputs,
        outputs: def.outputs,
        params: def.params ?? [],
        workerSafe: def.workerSafe ?? false,
        run: def.run
    });
}

/**
 * @param {{ mapTools: { id: string, action: string, category: string, label: string, tip: string }[] }} opts
 */
export function registerAllRegistryEntries(opts) {
    registerCanvasNode({
        id: 'layer-input',
        label: 'Layer Input',
        icon: '📂',
        category: 'input',
        outputs: [{ name: 'out', type: 'layer' }]
    });
    registerCanvasNode({
        id: 'file-import',
        label: 'File Import',
        icon: '📎',
        category: 'input',
        outputs: [{ name: 'out', type: 'layer' }]
    });
    registerCanvasNode({
        id: 'preview',
        label: 'Preview',
        icon: '👁️',
        category: 'output',
        inputs: [{ name: 'in', type: 'layer', required: true }]
    });
    registerCanvasNode({
        id: 'add-to-map',
        label: 'Add to Map',
        icon: '🗺️',
        category: 'output',
        inputs: [{ name: 'in', type: 'layer', required: true }]
    });
    registerCanvasNode({
        id: 'export',
        label: 'Export',
        icon: '💾',
        category: 'output',
        inputs: [{ name: 'in', type: 'layer', required: true }],
        outputs: [{ name: 'out', type: 'layer' }]
    });

    const transformNodes = [
        { id: 'filter-rows', label: 'Filter Rows', icon: '🔍', category: 'layer-data' },
        { id: 'rename-fields', label: 'Rename Fields', icon: '✏️', category: 'layer-data' },
        { id: 'delete-fields', label: 'Delete Fields', icon: '🗑️', category: 'layer-data' },
        { id: 'find-replace', label: 'Find & Replace', icon: '🔎', category: 'layer-data' },
        { id: 'sort', label: 'Sort', icon: '↕️', category: 'transform' },
        { id: 'deduplicate', label: 'Deduplicate', icon: '🧹', category: 'layer-data' },
        { id: 'add-unique-id', label: 'Add Unique ID', icon: '🆔', category: 'layer-data' },
        { id: 'combine-fields', label: 'Combine Fields', icon: '🔗', category: 'layer-data' },
        { id: 'split-column', label: 'Split Column', icon: '✂️', category: 'layer-data' },
        { id: 'template-builder', label: 'Template Builder', icon: '📝', category: 'layer-data' },
        { id: 'type-convert', label: 'Type Convert', icon: '🔄', category: 'layer-data' },
        {
            id: 'join-lookup',
            label: 'Join / Lookup',
            icon: '🔗',
            category: 'layer-data',
            inputs: [
                { name: 'in', type: 'layer', required: true },
                { name: 'lookup', type: 'layer', required: true }
            ]
        },
        { id: 'calculate-field', label: 'Calculate Field', icon: '🧮', category: 'transform' },
        { id: 'conditional-value', label: 'Conditional Value', icon: '❓', category: 'transform' },
        { id: 'unit-convert', label: 'Unit Converter', icon: '📏', category: 'transform' },
        { id: 'add-field', label: 'Add Field', icon: '➕', category: 'transform' }
    ];

    for (const def of transformNodes) {
        registerWorkerNode({
            ...def,
            inputs: def.inputs ?? [{ name: 'in', type: 'layer', required: true }],
            outputs: [{ name: 'out', type: 'layer' }]
        });
    }

    registerWorkerNode({
        id: 'add-elevation',
        label: 'Add Elevation',
        icon: '⛰️',
        category: 'enrichment',
        inputs: [{ name: 'in', type: 'layer', required: true }],
        outputs: [{ name: 'out', type: 'layer' }]
    });

    const nodeOnlySpatial = [
        {
            id: 'nearest-join',
            label: 'Nearest Join',
            icon: '🎯',
            inputs: [
                { name: 'target', type: 'layer', required: true },
                { name: 'join', type: 'layer', required: true }
            ]
        },
        {
            id: 'intersect',
            label: 'Intersect',
            icon: '✖️',
            inputs: [
                { name: 'layerA', type: 'layer', required: true },
                { name: 'layerB', type: 'layer', required: true }
            ]
        },
        {
            id: 'merge-layers',
            label: 'Merge Layers',
            icon: '🔀',
            inputs: [
                { name: 'layerA', type: 'layer', required: true },
                { name: 'layerB', type: 'layer', required: true }
            ]
        },
        {
            id: 'difference',
            label: 'Difference',
            icon: '➖',
            inputs: [
                { name: 'layerA', type: 'layer', required: true },
                { name: 'subtract', type: 'layer', required: true }
            ]
        },
        {
            id: 'summarize-within',
            label: 'Summarize Within',
            icon: '📊',
            inputs: [
                { name: 'polygons', type: 'layer', required: true },
                { name: 'points', type: 'layer', required: true }
            ]
        },
        {
            id: 'split-by-geometry',
            label: 'Split By Geometry',
            icon: '🔱',
            outputs: [
                { name: 'points', type: 'layer' },
                { name: 'lines', type: 'layer' },
                { name: 'polygons', type: 'layer' }
            ]
        }
    ];

    for (const def of nodeOnlySpatial) {
        registerWorkerNode({
            ...def,
            category: 'spatial',
            inputs: def.inputs ?? [{ name: 'in', type: 'layer', required: true }],
            outputs: def.outputs ?? [{ name: 'out', type: 'layer' }]
        });
    }

    registerWorkerNode({
        id: 'spatial-join',
        label: 'Spatial Join',
        icon: '📌',
        category: 'spatial',
        inputs: [
            { name: 'points', type: 'layer', required: true },
            { name: 'polygons', type: 'layer', required: true }
        ],
        outputs: [{ name: 'out', type: 'layer' }],
        params: [
            { name: 'joinFields', type: 'fields', of: 'polygons' },
            { name: 'prefix', type: 'string', default: '' }
        ]
    });

    const dualKindSpatial = new Set([
        'buffer',
        'simplify',
        'dissolve',
        'line-offset',
        'reproject',
        'union',
        'combine',
        'sample',
        'explode',
        'polygon-to-line',
        'fill-holes',
        'split-by-line',
        'split-by-polygon'
    ]);

    const mapSpatialParams = {
        buffer: [
            { name: 'distance', type: 'number', unit: 'm', default: 30.48, min: 0 },
            { name: 'units', type: 'string', default: 'feet' }
        ],
        'line-offset': [
            { name: 'distance', type: 'number', unit: 'm', default: 30.48, min: 0 },
            { name: 'units', type: 'string', default: 'feet' }
        ],
        simplify: [
            { name: 'tolerance', type: 'number', unit: 'm', default: 10, min: 0.001 },
            { name: 'toleranceUnit', type: 'string', default: 'm' }
        ],
        dissolve: [{ name: 'field', type: 'field', of: 'in' }],
        sample: [{ name: 'num', type: 'number', default: 10, min: 1 }],
        reproject: [
            { name: 'fromCrs', type: 'string' },
            { name: 'toCrs', type: 'string', default: 'EPSG:4326' }
        ]
    };

    registerMapToolEntry({
        id: 'clip',
        aliases: ['clip-extent', 'bbox-clip'],
        kind: ['tool', 'node'],
        label: 'Clip',
        status: 'ga',
        inputs: [
            { name: 'in', type: 'layer', required: true },
            { name: 'clip', type: 'layer', required: true }
        ],
        outputs: [{ name: 'out', type: 'layer' }],
        workerSafe: true,
        run: WORKER_RUNS.clip
    });

    for (const t of opts.mapTools) {
        if (t.id === 'clip-extent' || t.id === 'bbox-clip') continue;
        const nodeRun = WORKER_RUNS[t.id];
        const dualInputs =
            t.id === 'split-by-line'
                ? [
                      { name: 'polygons', type: 'layer', required: true },
                      { name: 'lines', type: 'layer', required: true }
                  ]
                : t.id === 'split-by-polygon'
                  ? [
                        { name: 'polygons', type: 'layer', required: true },
                        { name: 'splitters', type: 'layer', required: true }
                    ]
                  : [{ name: 'in', type: 'layer', required: true }];
        registerMapToolEntry({
            id: t.id,
            kind:
                t.id === 'coord-convert'
                    ? ['tool', 'node']
                    : dualKindSpatial.has(t.id)
                      ? ['tool', 'node']
                      : ['tool'],
            label: t.label,
            tip: t.tip,
            category: t.category,
            status: MAP_TOOL_STATUS(t.id),
            mapAction: t.action,
            inputs: dualInputs,
            outputs: [{ name: 'out', type: 'layer' }],
            params: mapSpatialParams[t.id] ?? [],
            workerSafe: Boolean(nodeRun),
            run: nodeRun
        });
    }
}
