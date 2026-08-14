/**
 * GIS tool catalog — visibility and labels for map panel and pipeline palette.
 * Set GIS_TOOL_V1_MODE to false to restore the full tool catalog.
 */

/** When true, only V1 tools appear in the map GIS Tools panel and pipeline palette. */
export const GIS_TOOL_V1_MODE = true;

/** @typedef {{ id: string, action: string, category: string, label: string, tip: string }} MapGisToolDef */

/** @type {MapGisToolDef[]} */
export const MAP_GIS_TOOLS = [
    { id: 'coord-convert', action: 'openCoordConverter', category: 'coordinates', label: '🌐 Coord Convert', tip: 'Convert coordinates between formats: Decimal Degrees, DMS, Degrees Decimal Minutes, and UTM.' },

    { id: 'distance', action: 'openDistanceTool', category: 'measurement', label: '📏 Distance', tip: 'Straight-line distance between two clicks (great-circle). For path length along several clicks, use the map ruler control (Measure).' },
    { id: 'bearing', action: 'openBearingTool', category: 'measurement', label: '🧭 Bearing', tip: 'Find the compass direction (in degrees) from one point to another on the map.' },
    { id: 'destination', action: 'openDestinationTool', category: 'measurement', label: '📌 Destination', tip: "Given a start point, distance, and compass direction, find where you'd end up." },
    { id: 'along', action: 'openAlongTool', category: 'measurement', label: '📍 Along', tip: 'Find a point at a specific distance along a line — like finding the 5-mile mark on a road.' },
    { id: 'point-to-line-distance', action: 'openPointToLineDistanceTool', category: 'measurement', label: '↔ Pt→Line', tip: 'Measure how far a point is from the nearest spot on a line (shortest perpendicular distance).' },

    { id: 'buffer', action: 'openBuffer', category: 'transformation', label: '⭕ Buffer', tip: 'Draw a zone around features at a set distance — creates a new layer; source layer is unchanged.' },
    { id: 'bbox-clip', action: 'openBboxClip', category: 'transformation', label: '✂️ BBox Clip', tip: 'Draw a rectangle on the map and cut away everything outside it — creates a new layer.' },
    { id: 'clip-extent', action: 'openClip', category: 'transformation', label: '🔲 Clip Extent', tip: 'Cut features to the current visible map area — creates a new layer.' },
    { id: 'simplify', action: 'openSimplify', category: 'transformation', label: '〰️ Simplify', tip: 'Reduce detail in shapes by removing extra points — creates a new layer.' },
    { id: 'bezier-spline', action: 'openBezierSpline', category: 'transformation', label: '🌊 Spline', tip: 'Smooth jagged lines into gentle, flowing curves (bezier splines).' },
    { id: 'polygon-smooth', action: 'openPolygonSmooth', category: 'transformation', label: '🔵 Smooth', tip: 'Round off rough polygon edges by averaging corner positions.' },
    { id: 'polygon-to-line', action: 'openPolygonToLine', category: 'transformation', label: '▭ Polygon→Line', tip: 'Turn polygon boundaries into lines (outer rings and holes).' },
    { id: 'fill-holes', action: 'openFillHoles', category: 'transformation', label: '⬤ Fill Holes', tip: 'Remove interior rings so donut polygons become solid.' },
    { id: 'split-by-line', action: 'openSplitPolygonByLine', category: 'transformation', label: '✂ Split by Line', tip: 'Cut polygons into pieces using a line layer.' },
    { id: 'split-by-polygon', action: 'openSplitPolygonByPolygon', category: 'transformation', label: '✂ Split by Polygon', tip: 'Cut polygons into overlap and remainder pieces using another polygon layer.' },
    { id: 'vertex-reshape', action: 'openVertexReshape', category: 'transformation', label: '✥ Reshape', tip: 'Click a feature and drag vertices to reshape it on the map.' },
    { id: 'line-offset', action: 'openLineOffset', category: 'transformation', label: '↔ Offset', tip: 'Create a parallel copy of a line shifted left or right by a set distance.' },
    { id: 'reproject', action: 'openReproject', category: 'transformation', label: '🗺 Reproject', tip: 'Fix layers that don\'t display on the map — converts coordinates to WGS 84 and creates a new layer.' },
    { id: 'sector', action: 'openSector', category: 'transformation', label: '🥧 Sector', tip: 'Create a pie-slice shaped area from a center point.' },

    { id: 'line-slice-along', action: 'openLineSliceAlong', category: 'line-ops', label: '✂ Slice Along', tip: 'Cut out a section of a line using start and end distances.' },
    { id: 'line-slice', action: 'openLineSlice', category: 'line-ops', label: '✂ Slice Pts', tip: 'Click two points on the map to cut out the section of line between them.' },
    { id: 'line-intersect', action: 'openLineIntersect', category: 'line-ops', label: '✖ Intersect', tip: 'Find all points where two sets of lines cross each other.' },
    { id: 'kinks', action: 'openKinks', category: 'line-ops', label: '⚠ Kinks', tip: 'Find self-intersections in line or polygon geometries.' },
    { id: 'explode', action: 'openExplode', category: 'line-ops', label: '💥 Explode', tip: 'Extract every vertex as a point feature — creates a new point layer.' },

    { id: 'combine', action: 'openCombine', category: 'combine-analyze', label: '🔗 Combine', tip: 'Merge all features of the same type into one multi-feature.' },
    { id: 'union', action: 'openUnion', category: 'combine-analyze', label: '🔶 Union', tip: 'Merge all polygons into a single shape.' },
    { id: 'dissolve', action: 'openDissolve', category: 'combine-analyze', label: '🫧 Dissolve', tip: 'Merge polygons by a shared attribute, or merge all when no field is chosen — creates a new layer.' },
    { id: 'nearest-point', action: 'openNearestPoint', category: 'combine-analyze', label: '🎯 Nearest Pt', tip: 'Click the map to find the closest feature in a point layer.' },
    { id: 'nearest-on-line', action: 'openNearestPointOnLine', category: 'combine-analyze', label: '📍→ Snap', tip: 'Click near a line to find the closest point on that line.' },
    { id: 'nearest-point-to-line', action: 'openNearestPointToLine', category: 'combine-analyze', label: '📍↔ Pt to Ln', tip: 'Find which point feature is closest to a given line.' },
    { id: 'nn-analysis', action: 'openNearestNeighborAnalysis', category: 'combine-analyze', label: '📊 NN Analysis', tip: 'Statistically test whether points are clustered, spread apart, or random.' },
    { id: 'sample', action: 'openSample', category: 'combine-analyze', label: '🎲 Sample', tip: 'Randomly pick N features from the layer — creates a new layer.' }
];

const MAP_CATEGORY_LABELS = {
    coordinates: 'Coordinates',
    measurement: 'Measurement',
    transformation: 'Transformation',
    'line-ops': 'Line Operations',
    'combine-analyze': 'Combine & Analyze'
};

const MAP_CATEGORY_ORDER = ['transformation', 'combine-analyze', 'coordinates', 'measurement', 'line-ops'];

/** Map tool ids enabled in V1 testing mode. */
export const V1_MAP_TOOL_IDS = new Set([
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

/** Pipeline nodes matching the map Layer Data Tools panel (see LayerDataToolsPanel.jsx). */
export const LAYER_DATA_NODE_ORDER = [
    'split-column',
    'combine-fields',
    'template-builder',
    'find-replace',
    'type-convert',
    'filter-rows',
    'deduplicate',
    'join-lookup',
    'add-unique-id'
];

export const LAYER_DATA_NODE_TYPES = new Set(LAYER_DATA_NODE_ORDER);

/** Pipeline node types enabled in V1 testing mode. */
export const V1_PIPELINE_NODE_TYPES = new Set([
    'layer-input',
    'file-import',
    ...LAYER_DATA_NODE_ORDER,
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
    'preview'
]);

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isMapToolEnabled(id) {
    if (!GIS_TOOL_V1_MODE) return true;
    return V1_MAP_TOOL_IDS.has(id);
}

/**
 * @param {string} type
 * @returns {boolean}
 */
export function isLayerDataNodeType(type) {
    return LAYER_DATA_NODE_TYPES.has(type);
}

/**
 * @param {string} type
 * @returns {boolean}
 */
export function isPipelineNodeEnabled(type) {
    if (!GIS_TOOL_V1_MODE) return true;
    return V1_PIPELINE_NODE_TYPES.has(type);
}

/**
 * @returns {MapGisToolDef[]}
 */
export function getEnabledMapGisTools() {
    return MAP_GIS_TOOLS.filter((t) => isMapToolEnabled(t.id));
}

/**
 * Render GIS Tools panel body HTML (selection UI + tool buttons). Does not include GIS Widgets.
 * @returns {string}
 */
export function renderMapGisToolsPanelHtml() {
    const enabled = getEnabledMapGisTools();
    const byCategory = new Map();
    for (const tool of enabled) {
        if (!byCategory.has(tool.category)) byCategory.set(tool.category, []);
        byCategory.get(tool.category).push(tool);
    }

    const categoryBlocks = MAP_CATEGORY_ORDER
        .filter((cat) => byCategory.has(cat))
        .map((cat) => {
            const tools = byCategory.get(cat);
            const buttons = tools.map((t) => (
                `<span class="geo-tool-btn"><button class="btn btn-sm btn-secondary" data-app-action="${t.action}">${t.label}</button><span class="geo-tip">${t.tip}</span></span>`
            )).join('');
            return `
                <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">${MAP_CATEGORY_LABELS[cat]}</div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">${buttons}</div>`;
        })
        .join('');

    return categoryBlocks;
}
