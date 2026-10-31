/**
 * Spatial analysis nodes — GIS operations
 */
import { NodeBase } from './node-base.js';
import { computeSimplify } from '../../tools/compute/simplify.js';
import {
    computeBuffer,
    computeLineOffset,
    computeDissolve,
    computeClip,
    computeUnion,
    computeCombine,
    computeSpatialJoin,
    computeNearestJoin,
    computeIntersect,
    computeMergeLayers,
    computeDifference,
    computeSummarizeWithin,
    computeSplitByGeometry,
    computeSample,
    computeExplode,
    computePolygonToLine,
    computeFillHoles,
    computeSplitByLine,
    computeSplitByPolygon,
    computeReproject
} from '../../tools/compute/spatial-operations.js';
import { adaptComputeContext } from '../compute-run-context.js';

// ==============================
// Buffer
// ==============================
export class BufferNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('buffer', {
            name: 'Buffer',
            icon: '⭕',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Buffered', dataType: 'dataset' }];
        this.config = { distance: 100, units: 'feet' };
    }

    validate() {
        if (this.config.distance <= 0) return { valid: false, message: 'Distance must be > 0' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeBuffer(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Line Offset
// ==============================
export class LineOffsetNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('line-offset', {
            name: 'Line Offset',
            icon: '↔️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Lines', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Offset', dataType: 'dataset' }];
        this.config = { distance: 100, units: 'feet' };
    }

    validate() {
        if (this.config.distance <= 0) return { valid: false, message: 'Distance must be > 0' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeLineOffset(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Simplify
// ==============================
export class SimplifyNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('simplify', {
            name: 'Simplify',
            icon: '〰️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Simplified', dataType: 'dataset' }];
        this.config = { tolerance: 0.001 };
    }

    validate() {
        if (this.config.tolerance <= 0) return { valid: false, message: 'Tolerance must be > 0' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeSimplify(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Dissolve
// ==============================
export class DissolveNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('dissolve', {
            name: 'Dissolve',
            icon: '🫧',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Dissolved', dataType: 'dataset' }];
        this.config = { field: '' };
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeDissolve(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Clip
// ==============================
export class ClipNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('clip', {
            name: 'Clip',
            icon: '✂️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'in', label: 'Features', dataType: 'dataset' },
            { id: 'clip', label: 'Clip Area', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Clipped', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeClip(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Union
// ==============================
export class UnionNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('union', {
            name: 'Union',
            icon: '🔗',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Polygons', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Merged', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeUnion(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Combine
// ==============================
export class CombineNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('combine', {
            name: 'Combine',
            icon: '📦',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Combined', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeCombine(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Spatial Join (Point in Polygon) — assign polygon attrs to points
// ==============================
export class SpatialJoinNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('spatial-join', {
            name: 'Spatial Join',
            icon: '📌',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'points', label: 'Points', dataType: 'dataset' },
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Joined', dataType: 'dataset' }];
        this.config = { joinFields: '', prefix: '' };
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeSpatialJoin(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Nearest Join — join attrs from nearest feature
// ==============================
export class NearestJoinNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('nearest-join', {
            name: 'Nearest Join',
            icon: '🎯',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'target', label: 'Target', dataType: 'dataset' },
            { id: 'join', label: 'Join From', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Joined', dataType: 'dataset' }];
        this.config = { joinFields: '', units: 'kilometers' };
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeNearestJoin(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Intersect — geometric intersection of two polygon layers
// ==============================
export class IntersectNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('intersect', {
            name: 'Intersect',
            icon: '✖️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'layerA', label: 'Layer A', dataType: 'dataset' },
            { id: 'layerB', label: 'Layer B', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Intersection', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeIntersect(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Merge Layers — combine two feature collections
// ==============================
export class MergeLayersNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('merge-layers', {
            name: 'Merge Layers',
            icon: '🔀',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'layerA', label: 'Layer A', dataType: 'dataset' },
            { id: 'layerB', label: 'Layer B', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Merged', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeMergeLayers(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Difference — subtract polygon B from polygon A
// ==============================
export class DifferenceNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('difference', {
            name: 'Difference',
            icon: '➖',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'layerA', label: 'Layer A', dataType: 'dataset' },
            { id: 'subtract', label: 'Subtract', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Result', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeDifference(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Summarize Within — count/aggregate points inside polygons
// ==============================
export class SummarizeWithinNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('summarize-within', {
            name: 'Summarize Within',
            icon: '📊',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' },
            { id: 'points', label: 'Points', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Summary', dataType: 'dataset' }];
        this.config = { sumField: '', avgField: '' };
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeSummarizeWithin(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Split By Geometry — separate mixed layers by geometry type
// ==============================
export class SplitByGeometryNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('split-by-geometry', {
            name: 'Split By Geometry',
            icon: '🔱',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [
            { id: 'points', label: 'Points', dataType: 'dataset' },
            { id: 'lines', label: 'Lines', dataType: 'dataset' },
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' }
        ];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeSplitByGeometry(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Sample
// ==============================
export class SampleNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('sample', {
            name: 'Sample',
            icon: '🎲',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Sampled', dataType: 'dataset' }];
        this.config = { num: 10 };
    }

    validate() {
        const num = Math.floor(Number(this.config.num));
        if (!Number.isFinite(num) || num <= 0) {
            return { valid: false, message: 'Sample count must be > 0' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeSample(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Explode
// ==============================
export class ExplodeNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('explode', {
            name: 'Explode',
            icon: '💥',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Points', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeExplode(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Polygon to Line
// ==============================
export class PolygonToLineNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('polygon-to-line', {
            name: 'Polygon to Line',
            icon: '▭',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Polygons', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Lines', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computePolygonToLine(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Fill Holes
// ==============================
export class FillHolesNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('fill-holes', {
            name: 'Fill Holes',
            icon: '⬤',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Polygons', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Filled', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeFillHoles(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Split by Line
// ==============================
export class SplitByLineNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('split-by-line', {
            name: 'Split by Line',
            icon: '✂️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' },
            { id: 'lines', label: 'Lines', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Split', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeSplitByLine(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Split by Polygon
// ==============================
export class SplitByPolygonNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('split-by-polygon', {
            name: 'Split by Polygon',
            icon: '✂️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' },
            { id: 'splitters', label: 'Splitters', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Split', dataType: 'dataset' }];
        this.config = {};
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        return computeSplitByPolygon(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Reproject
// ==============================
export class ReprojectNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('reproject', {
            name: 'Reproject',
            icon: '🗺️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Reprojected', dataType: 'dataset' }];
        this.config = { fromCrs: null, toCrs: 'EPSG:4326' };
    }

    validate() {
        if (!this.config.toCrs) return { valid: false, message: 'Target CRS is required' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeReproject(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Registry
// ==============================
export const SPATIAL_NODES = [
    { type: 'buffer', label: 'Buffer', icon: '⭕', create: () => new BufferNode() },
    { type: 'reproject', label: 'Reproject', icon: '🗺️', create: () => new ReprojectNode() },
    { type: 'line-offset', label: 'Line Offset', icon: '↔️', create: () => new LineOffsetNode() },
    { type: 'simplify', label: 'Simplify', icon: '〰️', create: () => new SimplifyNode() },
    { type: 'dissolve', label: 'Dissolve', icon: '🫧', create: () => new DissolveNode() },
    { type: 'clip', label: 'Clip', icon: '✂️', create: () => new ClipNode() },
    { type: 'union', label: 'Union', icon: '🔗', create: () => new UnionNode() },
    { type: 'combine', label: 'Combine', icon: '📦', create: () => new CombineNode() },
    { type: 'spatial-join', label: 'Spatial Join', icon: '📌', create: () => new SpatialJoinNode() },
    { type: 'nearest-join', label: 'Nearest Join', icon: '🎯', create: () => new NearestJoinNode() },
    { type: 'intersect', label: 'Intersect', icon: '✖️', create: () => new IntersectNode() },
    { type: 'merge-layers', label: 'Merge Layers', icon: '🔀', create: () => new MergeLayersNode() },
    { type: 'difference', label: 'Difference', icon: '➖', create: () => new DifferenceNode() },
    { type: 'summarize-within', label: 'Summarize Within', icon: '📊', create: () => new SummarizeWithinNode() },
    { type: 'split-by-geometry', label: 'Split By Geometry', icon: '🔱', create: () => new SplitByGeometryNode() },
    { type: 'sample', label: 'Sample', icon: '🎲', create: () => new SampleNode() },
    { type: 'explode', label: 'Explode', icon: '💥', create: () => new ExplodeNode() },
    { type: 'polygon-to-line', label: 'Polygon to Line', icon: '▭', create: () => new PolygonToLineNode() },
    { type: 'fill-holes', label: 'Fill Holes', icon: '⬤', create: () => new FillHolesNode() },
    { type: 'split-by-line', label: 'Split by Line', icon: '✂️', create: () => new SplitByLineNode() },
    { type: 'split-by-polygon', label: 'Split by Polygon', icon: '✂️', create: () => new SplitByPolygonNode() }
];
