/**
 * Spatial analysis nodes — GIS operations
 */
import { NodeBase } from './node-base.js';
import {
    bufferFeatures,
    lineOffsetFeatures,
    simplifyFeatures,
    dissolveFeatures,
    clipFeatures,
    unionFeatures,
    combineFeatures,
    spatialJoinPointsInPolygons,
    nearestJoin,
    intersectLayers,
    mergeLayers,
    differenceLayers,
    summarizeWithin,
    sampleFeatures,
    explodeFeatures,
    polygonToLineFeatures,
    fillHolesFeatures,
    splitPolygonsByLine,
    splitPolygonsByPolygon
} from '../../tools/gis-tools.js';
import { reprojectLayer } from '../../tools/reproject.js';

// ==============================
// Buffer
// ==============================
export class BufferNode extends NodeBase {
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
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return bufferFeatures(data, this.config.distance, this.config.units);
    }
}

// ==============================
// Line Offset
// ==============================
export class LineOffsetNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return lineOffsetFeatures(data, this.config.distance, this.config.units);
    }
}

// ==============================
// Simplify
// ==============================
export class SimplifyNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const result = await simplifyFeatures(data, this.config.tolerance);
        return result.dataset;
    }
}

// ==============================
// Dissolve
// ==============================
export class DissolveNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return dissolveFeatures(data, this.config.field || undefined);
    }
}

// ==============================
// Clip
// ==============================
export class ClipNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        const clipData = inputs[1];
        if (!data || data.type !== 'spatial') throw new Error('Spatial features input required');
        if (!clipData || clipData.type !== 'spatial') throw new Error('Clip area input required');

        // Clip uses a single polygon geometry; take first feature from clip layer
        const clipGeom = clipData.geojson.features[0]?.geometry;
        if (!clipGeom) throw new Error('Clip layer has no geometry');
        return clipFeatures(data, clipGeom);
    }
}

// ==============================
// Union
// ==============================
export class UnionNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return unionFeatures(data);
    }
}

// ==============================
// Combine
// ==============================
export class CombineNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return combineFeatures(data);
    }
}

// ==============================
// Spatial Join (Point in Polygon) — assign polygon attrs to points
// ==============================
export class SpatialJoinNode extends NodeBase {
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

    async execute(inputs) {
        const pointsData = inputs[0];
        const polygonsData = inputs[1];
        if (!pointsData || pointsData.type !== 'spatial') throw new Error('Points input required');
        if (!polygonsData || polygonsData.type !== 'spatial') throw new Error('Polygons input required');

        const joinFields = this.config.joinFields
            ? this.config.joinFields.split(',').map(f => f.trim()).filter(Boolean)
            : [];
        return spatialJoinPointsInPolygons(pointsData, polygonsData, joinFields, this.config.prefix);
    }
}

// ==============================
// Nearest Join — join attrs from nearest feature
// ==============================
export class NearestJoinNode extends NodeBase {
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

    async execute(inputs) {
        const target = inputs[0];
        const joinFrom = inputs[1];
        if (!target || target.type !== 'spatial') throw new Error('Target input required');
        if (!joinFrom || joinFrom.type !== 'spatial') throw new Error('Join From input required');

        const joinFields = this.config.joinFields
            ? this.config.joinFields.split(',').map(f => f.trim()).filter(Boolean)
            : [];
        return nearestJoin(target, joinFrom, joinFields, this.config.units);
    }
}

// ==============================
// Intersect — geometric intersection of two polygon layers
// ==============================
export class IntersectNode extends NodeBase {
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

    async execute(inputs) {
        const a = inputs[0];
        const b = inputs[1];
        if (!a || a.type !== 'spatial') throw new Error('Layer A input required');
        if (!b || b.type !== 'spatial') throw new Error('Layer B input required');

        return intersectLayers(a, b);
    }
}

// ==============================
// Merge Layers — combine two feature collections
// ==============================
export class MergeLayersNode extends NodeBase {
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

    async execute(inputs) {
        const a = inputs[0];
        const b = inputs[1];
        if (!a || a.type !== 'spatial') throw new Error('Layer A input required');
        if (!b || b.type !== 'spatial') throw new Error('Layer B input required');

        return mergeLayers(a, b);
    }
}

// ==============================
// Difference — subtract polygon B from polygon A
// ==============================
export class DifferenceNode extends NodeBase {
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

    async execute(inputs) {
        const a = inputs[0];
        const b = inputs[1];
        if (!a || a.type !== 'spatial') throw new Error('Layer A input required');
        if (!b || b.type !== 'spatial') throw new Error('Subtract input required');

        return differenceLayers(a, b);
    }
}

// ==============================
// Summarize Within — count/aggregate points inside polygons
// ==============================
export class SummarizeWithinNode extends NodeBase {
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

    async execute(inputs) {
        const polygons = inputs[0];
        const points = inputs[1];
        if (!polygons || polygons.type !== 'spatial') throw new Error('Polygons input required');
        if (!points || points.type !== 'spatial') throw new Error('Points input required');

        return summarizeWithin(polygons, points, this.config.sumField || undefined, this.config.avgField || undefined);
    }
}

// ==============================
// Split By Geometry — separate mixed layers by geometry type
// ==============================
export class SplitByGeometryNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

        const features = data.geojson.features || [];
        const pointTypes = new Set(['Point', 'MultiPoint']);
        const lineTypes = new Set(['LineString', 'MultiLineString']);
        const polyTypes = new Set(['Polygon', 'MultiPolygon']);

        const pointFeats = features.filter(f => f.geometry && pointTypes.has(f.geometry.type));
        const lineFeats = features.filter(f => f.geometry && lineTypes.has(f.geometry.type));
        const polyFeats = features.filter(f => f.geometry && polyTypes.has(f.geometry.type));

        const buildOutput = (feats, geomType, suffix) => {
            const fc = { type: 'FeatureCollection', features: feats };
            const schema = JSON.parse(JSON.stringify(data.schema));
            schema.geometryType = feats.length > 0 ? geomType : null;
            schema.featureCount = feats.length;
            return {
                type: 'spatial',
                geojson: fc,
                schema,
                name: `${data.name}_${suffix}`
            };
        };

        return {
            _multiOutput: true,
            ports: {
                points: buildOutput(pointFeats, 'Point', 'points'),
                lines: buildOutput(lineFeats, 'LineString', 'lines'),
                polygons: buildOutput(polyFeats, 'Polygon', 'polygons')
            }
        };
    }
}

// ==============================
// Sample
// ==============================
export class SampleNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return sampleFeatures(data, this.config.num);
    }
}

// ==============================
// Explode
// ==============================
export class ExplodeNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return explodeFeatures(data);
    }
}

// ==============================
// Polygon to Line
// ==============================
export class PolygonToLineNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return polygonToLineFeatures(data);
    }
}

// ==============================
// Fill Holes
// ==============================
export class FillHolesNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        return fillHolesFeatures(data);
    }
}

// ==============================
// Split by Line
// ==============================
export class SplitByLineNode extends NodeBase {
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

    async execute(inputs) {
        const polygons = inputs[0];
        const lines = inputs[1];
        if (!polygons || polygons.type !== 'spatial') throw new Error('Polygons input required');
        if (!lines || lines.type !== 'spatial') throw new Error('Lines input required');
        return splitPolygonsByLine(polygons, lines);
    }
}

// ==============================
// Split by Polygon
// ==============================
export class SplitByPolygonNode extends NodeBase {
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

    async execute(inputs) {
        const polygons = inputs[0];
        const splitters = inputs[1];
        if (!polygons || polygons.type !== 'spatial') throw new Error('Polygons input required');
        if (!splitters || splitters.type !== 'spatial') throw new Error('Splitters input required');
        return splitPolygonsByPolygon(polygons, splitters);
    }
}

// ==============================
// Reproject
// ==============================
export class ReprojectNode extends NodeBase {
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

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const fromCrs = this.config.fromCrs || data.schema?.crs || 'EPSG:4326';
        return reprojectLayer(data, {
            fromCrs,
            toCrs: this.config.toCrs,
            name: `${data.name}_reproject`
        });
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
