import React from 'react';
import {
    getUpstreamFields,
    getUpstreamFieldsForPort,
    getUpstreamDataForPort,
    mergeConfigFields,
    DISTANCE_UNITS
} from './helpers.js';
import {
    InspectorLabel,
    InspectorInput,
    InspectorSelect,
    InfoText,
    HintText
} from './shared.jsx';
import { CrsPicker } from '../../widgets/shared/CrsPicker.jsx';

function BufferInspector({ config, onConfigChange }) {
    return (
        <>
            <InspectorLabel>Distance</InspectorLabel>
            <InspectorInput
                type="number"
                value={config.distance ?? 100}
                min={0}
                step={0.1}
                onChange={(v) => onConfigChange({ ...config, distance: parseFloat(v) || 1 })}
            />
            <InspectorLabel style={{ marginTop: 8 }}>Units</InspectorLabel>
            <InspectorSelect
                value={config.units ?? 'feet'}
                onChange={(units) => onConfigChange({ ...config, units })}
            >
                {DISTANCE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                ))}
            </InspectorSelect>
        </>
    );
}

function LineOffsetInspector({ config, onConfigChange }) {
    return (
        <>
            <InspectorLabel>Offset distance</InspectorLabel>
            <InspectorInput
                type="number"
                value={config.distance ?? 100}
                min={0}
                step={0.1}
                onChange={(v) => onConfigChange({ ...config, distance: parseFloat(v) || 1 })}
            />
            <InspectorLabel style={{ marginTop: 8 }}>Units</InspectorLabel>
            <InspectorSelect
                value={config.units ?? 'feet'}
                onChange={(units) => onConfigChange({ ...config, units })}
            >
                {DISTANCE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                ))}
            </InspectorSelect>
            <HintText>Only LineString and MultiLineString features are offset; others pass through unchanged.</HintText>
        </>
    );
}

function SimplifyInspector({ config, onConfigChange }) {
    return (
        <>
            <InspectorLabel>Tolerance</InspectorLabel>
            <InspectorInput
                type="number"
                value={config.tolerance ?? 0.001}
                min={0.0001}
                step={0.0001}
                onChange={(v) => onConfigChange({ ...config, tolerance: parseFloat(v) || 0.001 })}
            />
            <HintText>Smaller = more detail. Default 0.001</HintText>
        </>
    );
}

function DissolveInspector({ node, config, onConfigChange, engine, getLayers }) {
    const fields = mergeConfigFields(
        getUpstreamFields(engine, node.id, getLayers),
        [config.field]
    );

    return (
        <>
            <InspectorLabel>Dissolve Field</InspectorLabel>
            <InspectorSelect
                value={config.field ?? ''}
                onChange={(field) => onConfigChange({ ...config, field })}
            >
                <option value="">— All features —</option>
                {fields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                ))}
            </InspectorSelect>
            <HintText>Merge geometries by shared field values</HintText>
        </>
    );
}

function ClipInspector() {
    return (
        <InfoText>
            Connect <strong>Features</strong> (to clip) and <strong>Clip Area</strong> (polygon boundary).
            All features will be clipped to the clip area boundary.
        </InfoText>
    );
}

function UnionInspector() {
    return (
        <InfoText>Merges all polygon features into a single geometry.</InfoText>
    );
}

function CombineInspector() {
    return (
        <InfoText>
            Groups features by geometry type into Multi* features (e.g. Points → MultiPoint).
        </InfoText>
    );
}

function SpatialJoinInspector({ node, config, onConfigChange, engine, getLayers }) {
    const fields = getUpstreamFieldsForPort(engine, node.id, 'polygons', getLayers);

    return (
        <>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                For each <strong>Point</strong>, finds the containing <strong>Polygon</strong>
                {' '}and copies its attributes to the point. Creates a new layer on the output port
                (does not modify source layers). Use <strong>Find Features in Area</strong> (GIS Widgets)
                to filter points inside polygons without joining attributes.
            </p>
            <InspectorLabel>Fields to Join</InspectorLabel>
            <InspectorInput
                value={config.joinFields ?? ''}
                placeholder="Leave blank for all fields"
                onChange={(joinFields) => onConfigChange({ ...config, joinFields })}
            />
            {fields.length > 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                    Available: {fields.join(', ')}
                </p>
            )}
            <InspectorLabel style={{ marginTop: 8 }}>Field Prefix</InspectorLabel>
            <InspectorInput
                value={config.prefix ?? ''}
                placeholder="e.g. poly_ (optional)"
                onChange={(prefix) => onConfigChange({ ...config, prefix })}
            />
        </>
    );
}

function NearestJoinInspector({ node, config, onConfigChange, engine, getLayers }) {
    const fields = getUpstreamFieldsForPort(engine, node.id, 'join', getLayers);

    return (
        <>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                For each <strong>Target</strong> feature, finds the nearest feature in
                {' '}<strong>Join From</strong> using shortest distance between geometries
                (points, lines, polygon boundaries — same rules as the Proximity Join widget),
                then copies its attributes plus distance.
            </p>
            <InspectorLabel>Fields to Join</InspectorLabel>
            <InspectorInput
                value={config.joinFields ?? ''}
                placeholder="Leave blank for all fields"
                onChange={(joinFields) => onConfigChange({ ...config, joinFields })}
            />
            {fields.length > 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                    Available: {fields.join(', ')}
                </p>
            )}
            <InspectorLabel style={{ marginTop: 8 }}>Distance Units</InspectorLabel>
            <InspectorSelect
                value={config.units ?? 'kilometers'}
                onChange={(units) => onConfigChange({ ...config, units })}
            >
                {DISTANCE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                ))}
            </InspectorSelect>
        </>
    );
}

function IntersectInspector() {
    return (
        <InfoText>
            Produces features where <strong>Layer A</strong> and <strong>Layer B</strong>
            {' '}polygons overlap. Attributes from both layers are merged
            (Layer B fields are prefixed with <code>B_</code>).
        </InfoText>
    );
}

function MergeLayersInspector() {
    return (
        <InfoText>
            Concatenates all features from <strong>Layer A</strong> and <strong>Layer B</strong>
            {' '}into a single feature collection.
        </InfoText>
    );
}

function DifferenceInspector() {
    return (
        <InfoText>
            Removes areas from <strong>Layer A</strong> polygons that overlap
            with <strong>Subtract</strong> polygons.
        </InfoText>
    );
}

function SummarizeWithinInspector({ node, config, onConfigChange, engine, getLayers }) {
    const ptData = getUpstreamDataForPort(engine, node.id, 'points', getLayers);
    const numFields = mergeConfigFields(
        (ptData?.schema?.fields || []).filter((f) => f.type === 'number').map((f) => f.name),
        [config.sumField, config.avgField]
    );

    return (
        <>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                Counts <strong>Point</strong> features within each <strong>Polygon</strong>.
                Optionally sums or averages a numeric point field.
            </p>
            <InspectorLabel>Sum Field (optional)</InspectorLabel>
            <InspectorSelect
                value={config.sumField ?? ''}
                onChange={(sumField) => onConfigChange({ ...config, sumField })}
            >
                <option value="">— None —</option>
                {numFields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                ))}
            </InspectorSelect>
            <InspectorLabel style={{ marginTop: 8 }}>Average Field (optional)</InspectorLabel>
            <InspectorSelect
                value={config.avgField ?? ''}
                onChange={(avgField) => onConfigChange({ ...config, avgField })}
            >
                <option value="">— None —</option>
                {numFields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                ))}
            </InspectorSelect>
            <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
                Adds <code>point_count</code> to each polygon. Sum/avg fields add
                {' '}<code>sum_&lt;field&gt;</code> and <code>avg_&lt;field&gt;</code>.
            </p>
        </>
    );
}

function SplitByGeometryInspector() {
    return (
        <>
            <InfoText>
                Splits a mixed-geometry layer into three separate outputs by geometry type.
            </InfoText>
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.8 }}>
                <div><strong style={{ color: '#ef4444' }}>● Points</strong> — Point, MultiPoint</div>
                <div><strong style={{ color: '#3b82f6' }}>● Lines</strong> — LineString, MultiLineString</div>
                <div><strong style={{ color: '#22c55e' }}>● Polygons</strong> — Polygon, MultiPolygon</div>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
                Wire each output port to the appropriate downstream node.
                Empty outputs (no features of that type) will pass through as empty datasets.
            </p>
        </>
    );
}

function ReprojectInspector({ config, onConfigChange }) {
    return (
        <>
            <InfoText>
                Reprojects geometries to WGS 84 for map display by default. Expand Advanced to choose
                a different source or target.
            </InfoText>
            <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    Advanced options
                </summary>
                <div style={{ marginTop: 8 }}>
                    <InspectorLabel>Source CRS</InspectorLabel>
                    <CrsPicker
                        label=""
                        value={config.fromCrs || 'EPSG:4326'}
                        onChange={(fromCrs) => onConfigChange({ ...config, fromCrs })}
                        variant="compact"
                    />
                    <InspectorLabel style={{ marginTop: 8 }}>Target CRS</InspectorLabel>
                    <CrsPicker
                        label=""
                        value={config.toCrs || 'EPSG:4326'}
                        onChange={(toCrs) => onConfigChange({ ...config, toCrs })}
                        variant="compact"
                    />
                    <HintText>Source defaults to the input layer CRS if unchanged.</HintText>
                </div>
            </details>
        </>
    );
}

function SampleInspector({ config, onConfigChange }) {
    return (
        <>
            <InfoText>Randomly selects features from the input layer without replacement.</InfoText>
            <InspectorLabel style={{ marginTop: 8 }}>Number of features</InspectorLabel>
            <InspectorInput
                type="number"
                value={config.num ?? 10}
                min={1}
                step={1}
                onChange={(v) => onConfigChange({ ...config, num: parseInt(v, 10) || 1 })}
            />
            <HintText>If the layer has fewer features, all features are returned.</HintText>
        </>
    );
}

function ExplodeInspector() {
    return (
        <InfoText>
            Extracts every coordinate vertex as a point feature. Parent feature attributes are copied to each point.
        </InfoText>
    );
}

function PolygonToLineInspector() {
    return (
        <InfoText>
            Converts polygon boundaries to line features. Outer rings and holes become separate lines.
        </InfoText>
    );
}

function FillHolesInspector() {
    return (
        <InfoText>
            Removes interior rings so donut polygons become solid. Polygons without holes pass through unchanged.
        </InfoText>
    );
}

function SplitByLineInspector() {
    return (
        <InfoText>
            Connect <strong>Polygons</strong> and <strong>Lines</strong>. Each polygon is cut into pieces
            wherever a line crosses it. The line must intersect the polygon.
        </InfoText>
    );
}

function SplitByPolygonInspector() {
    return (
        <InfoText>
            Connect <strong>Polygons</strong> and <strong>Splitters</strong>. Each target polygon is cut
            into overlap and remainder pieces using the splitter polygons.
        </InfoText>
    );
}

export const SPATIAL_INSPECTORS = {
    buffer: BufferInspector,
    reproject: ReprojectInspector,
    'line-offset': LineOffsetInspector,
    simplify: SimplifyInspector,
    dissolve: DissolveInspector,
    clip: ClipInspector,
    union: UnionInspector,
    combine: CombineInspector,
    'spatial-join': SpatialJoinInspector,
    'nearest-join': NearestJoinInspector,
    intersect: IntersectInspector,
    'merge-layers': MergeLayersInspector,
    difference: DifferenceInspector,
    'summarize-within': SummarizeWithinInspector,
    'split-by-geometry': SplitByGeometryInspector,
    sample: SampleInspector,
    explode: ExplodeInspector,
    'polygon-to-line': PolygonToLineInspector,
    'fill-holes': FillHolesInspector,
    'split-by-line': SplitByLineInspector,
    'split-by-polygon': SplitByPolygonInspector
};
