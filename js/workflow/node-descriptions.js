/**
 * Palette tooltip text for pipeline nodes.
 * When adding a new node, register its type here (or set `description` on the node def).
 */

/** @type {Record<string, string>} */
export const NODE_DESCRIPTIONS = {
    // Inputs
    'layer-input': 'Start a pipeline from a layer already loaded on the map.',
    'file-import': 'Import a file directly into the pipeline without adding it to the map first.',

    // Transforms
    'filter-rows': 'Keep or remove rows or features that match one or more field conditions.',
    'rename-fields': 'Rename attribute fields using a list of old-to-new name mappings.',
    'delete-fields': 'Remove selected attribute fields from every row or feature.',
    'find-replace': 'Find and replace text in a field, with optional upper, lower, or title case.',
    'sort': 'Sort rows or features by a field value in ascending or descending order.',
    'deduplicate': 'Remove duplicate rows or features based on one or more key fields.',
    'add-unique-id': 'Add a new field with a sequential number or UUID for every row or feature.',
    'combine-fields': 'Merge two or more fields into one new field with a chosen delimiter.',
    'split-column': 'Split one field into multiple new fields using a delimiter.',
    'template-builder': 'Build a new field from a text template that references other fields.',
    'type-convert': 'Change a field\'s data type, such as text to number or number to text.',
    'join-lookup': 'Look up values from a second table and add matching fields (VLOOKUP-style join).',
    'calculate-field': 'Compute a numeric result from a math expression using field values.',
    'conditional-value': 'Set a field value based on IF/CASE rules, with an optional default.',
    'coord-convert': 'Convert coordinates between formats (DD, DMS, UTM) from geometry or lat/lon fields.',
    'unit-convert': 'Convert numeric values between units such as feet, meters, acres, or temperature.',
    'add-field': 'Add a new attribute field and fill every row or feature with a default value.',

    // Spatial
    'buffer': 'Create a buffer zone around features at a specified distance and unit.',
    'reproject': 'Reproject feature geometries from one CRS to another.',
    'line-offset': 'Create a parallel copy of line features shifted left or right by a set distance.',
    'simplify': 'Reduce vertex count in lines or polygons while preserving overall shape.',
    'dissolve': 'Merge adjacent or overlapping features, optionally grouping by a field value.',
    'clip': 'Cut features to only the area covered by a clip polygon layer.',
    'union': 'Merge overlapping polygon features into unified geometries.',
    'combine': 'Merge all features in a layer into a single multipart geometry.',
    'spatial-join': 'Assign polygon attributes to points that fall inside each polygon.',
    'nearest-join': 'Copy attributes from the nearest feature in a second layer.',
    'intersect': 'Return only the overlapping area where two polygon layers intersect.',
    'merge-layers': 'Combine two feature layers into one layer with all features from both.',
    'difference': 'Subtract one polygon layer from another, keeping only the remaining area.',
    'summarize-within': 'Count points inside each polygon and optionally sum or average a numeric field.',
    'split-by-geometry': 'Split a mixed layer into separate point, line, and polygon outputs.',
    'sample': 'Randomly pick a specified number of features from the input layer.',
    'explode': 'Extract every coordinate vertex as a point feature, preserving parent attributes.',
    'polygon-to-line': 'Convert polygon boundaries to line features (outer rings and holes).',
    'fill-holes': 'Remove interior rings so donut polygons become solid.',
    'split-by-line': 'Cut polygons into pieces wherever a line layer crosses them.',
    'split-by-polygon': 'Cut polygons into overlap and remainder pieces using another polygon layer.',

    // Enrichment
    'add-elevation': 'Look up ground elevation for each feature and store it in a new field.',

    // Outputs
    'preview': 'Open a data table preview of the pipeline result without adding it to the map.',
    'add-to-map': 'Add the pipeline result as a new layer on the map.'
};

/**
 * @param {{ type: string, description?: string }} def
 * @returns {string}
 */
export function getNodeDescription(def) {
    if (!def) return '';
    return (def.description || NODE_DESCRIPTIONS[def.type] || '').trim();
}
