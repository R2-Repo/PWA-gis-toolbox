/**
 * Default registry input/output ports for GIS widgets (Send-to interop).
 * @type {Record<string, { inputs?: import('../tools/tool-registry.js').ToolPortDef[], outputs?: import('../tools/tool-registry.js').ToolPortDef[] }>}
 */
export const WIDGET_REGISTRY_IO = {
    'spatial-analyzer': {
        inputs: [{ name: 'target', type: 'layer', required: true }],
        outputs: [{ name: 'results', type: 'layer' }]
    },
    'bulk-update': {
        inputs: [{ name: 'in', type: 'layer', required: true }],
        outputs: [{ name: 'out', type: 'layer' }]
    },
    'proximity-join': {
        inputs: [
            { name: 'source', type: 'layer', required: true },
            { name: 'target', type: 'layer', required: true }
        ],
        outputs: [{ name: 'out', type: 'layer' }]
    },
    'spatial-join': {
        inputs: [
            { name: 'points', type: 'layer', geometry: ['Point', 'MultiPoint'], required: true },
            { name: 'polygons', type: 'layer', geometry: ['Polygon', 'MultiPolygon'], required: true }
        ],
        outputs: [{ name: 'out', type: 'layer' }]
    },
    'route-milepost-segment': {
        outputs: [{ name: 'centerline', type: 'layer', geometry: ['LineString', 'MultiLineString'] }]
    },
    'route-milepost': { outputs: [{ name: 'mileposts', type: 'layer', geometry: ['Point', 'MultiPoint'] }] },
    'project-stationing': {
        inputs: [{ name: 'centerline', type: 'layer', geometry: ['LineString', 'MultiLineString'], required: true }],
        outputs: [{ name: 'stations', type: 'layer', geometry: ['LineString', 'MultiLineString'] }]
    },
    'layer-match-assistant': {
        inputs: [
            { name: 'source', type: 'layer', required: true },
            { name: 'target', type: 'layer', required: true }
        ],
        outputs: [
            { name: 'matched', type: 'layer' },
            { name: 'unmatched', type: 'layer' }
        ]
    },
    'sheet-cutting': {
        inputs: [{ name: 'route', type: 'layer', geometry: ['LineString', 'MultiLineString'], required: true }],
        outputs: [{ name: 'sheets', type: 'layer' }]
    },
    'georeference-raster': {
        outputs: [{ name: 'out', type: 'layer' }]
    },
    'plan-set-callouts': {
        inputs: [{ name: 'sheets', type: 'layer', required: true }]
    },
    'fiber-procurement-design': {
        outputs: [{ name: 'design', type: 'layer' }]
    },
    'layer-summary': {
        inputs: [{ name: 'in', type: 'layer', required: true }]
    },
    query: {
        inputs: [{ name: 'in', type: 'layer', required: true }],
        outputs: [{ name: 'results', type: 'layer' }]
    },
    'crs-manager': {
        inputs: [{ name: 'in', type: 'layer', required: true }],
        outputs: [{ name: 'out', type: 'layer' }]
    },
    'wireless-site-planning': {
        inputs: [{ name: 'clients', type: 'layer', required: true }],
        outputs: [{ name: 'plan', type: 'layer' }]
    },
    'fiber-slack-otdr-helper': {
        inputs: [{ name: 'route', type: 'layer', geometry: ['LineString', 'MultiLineString'], required: true }],
        outputs: [{ name: 'out', type: 'table' }]
    },
    'presentation-link-builder': {
        inputs: [{ name: 'in', type: 'layer', required: true }]
    },
    'plan-production-export': {
        inputs: [{ name: 'in', type: 'layer' }]
    },
    'terrain-profile': { outputs: [{ name: 'profile', type: 'layer', geometry: ['LineString', 'Point'] }] }
};
