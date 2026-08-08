/** Tool guide content for ToolGuideDialog / showToolInfo. */
export const TOOL_GUIDE_SECTIONS = [
    {
        title: 'How To',
        tools: [
            ['1️⃣ Import', 'Add most Geospatial files types'],
            ['2️⃣ Interact', 'View, edit, or manipulate'],
            ['3️⃣ Export', 'Same file type or convert']
        ]
    },
    {
        title: 'About',
        tools: [
            ['GIS Toolbox', 'A modern web app for working with geospatial data.'],
            ['How it Works', 'Client-side, no backend server processing. All work is done in the browser, no need to download/ install any software.'],
            ['Tools', 'Most tools use Turf.js, a modular geospatial engine written in JavaScript'],
            ['Limitations', 'Large datasets may cause browser performance issues. Try using the "Import Fence" tool to load a smaller area.']
        ]
    },
    {
        title: 'Import & Sources',
        tools: [
            ['📂 Import', 'Drag-and-drop or browse to load GeoJSON, CSV, Excel, KML, KMZ, Shapefile (ZIP), or JSON files.'],
            ['📷 Photos', 'Import geotagged photos. Extracts GPS coordinates and EXIF data, maps them as points.'],
            ['🌐 ArcGIS REST', 'Import features directly from an ArcGIS REST service URL (Feature/Map Server).']
        ]
    },
    {
        title: 'Layers & Fields',
        tools: [
            ['Layers Panel', 'View, select, toggle visibility, zoom to, rename, or remove imported layers.'],
            ['Fields Panel', 'View, search, select/deselect, rename, or add new fields on the active layer.'],
            ['Field Types', 'Text, Number, Boolean, Date, and Attach Photo. Photo fields let you attach images to individual features with inline previews. Photos are embedded when exported as KML/KMZ only.'],
            ['Feature Selection', 'Pick a layer, then click features to select (cyan highlight). Shift+click to add/remove. Shift+drag on empty map to box-select, or Shift+click two corners (pan/zoom between clicks) for a precise box. After a box select, an actions menu opens (invert, delete, new layer, clip lines, bulk edit, copy attribute to clipboard, export, copy/move, clear). Esc clears selection.'],
            ['Merge Layers', 'Select which layers to combine into a single layer. A source_file field is added so you can tell which features came from which original layer. Useful for exporting multiple layers into one KML or KMZ with folders.'],
            ['Data Table', 'View the raw attribute table for the active layer.']
        ]
    },
    {
        title: 'Data Pipeline Editor',
        tools: [
            ['Overview', 'A visual node-based editor for building multi-step data processing pipelines. Drag nodes onto a canvas, connect them with wires, and run the whole chain in one click.'],
            ['Input Nodes', 'Layer Input (use an already-imported layer) or File Import (load a file directly into the pipeline).'],
            ['Transform Nodes', 'Filter Rows, Rename Fields, Delete Fields, Sort, Find & Replace, Deduplicate, and Add Unique ID.'],
            ['Spatial Nodes', 'Buffer, Reproject, Simplify, Dissolve, Clip, Union, Combine, Spatial Join, Nearest Join, Intersect, Merge Layers, Difference, Summarize Within, and Split by Geometry.'],
            ['Output Nodes', 'Preview (inspect results in a data table) or Add to Map (push the result back as a new map layer).'],
            ['Examples', 'Pre-built pipelines available from the Examples dropdown to get started quickly.']
        ]
    },
    {
        title: 'Layer Data Tools',
        tools: [
            ['Split Column', 'Split a field into multiple new fields by a delimiter (comma, space, etc.).'],
            ['Combine', 'Merge two or more fields into a single field with a separator.'],
            ['Template', 'Build a new field from a text template using values from existing fields.'],
            ['Replace/Clean', 'Find and replace text, trim whitespace, or clean values in a field.'],
            ['Type Convert', 'Change a field\'s data type (text → number, number → text, etc.).'],
            ['Filter', 'Keep or remove rows based on conditions (equals, contains, greater than, etc.).'],
            ['Dedup', 'Remove duplicate rows based on one or more key fields.'],
            ['Join', 'Join two layers together on a matching key field.'],
            ['Validate', 'Run validation rules on fields (required, min/max, regex pattern, etc.).'],
            ['Add UID', 'Add a unique sequential ID field to every row.']
        ]
    },
    {
        title: 'GIS Widgets',
        tools: [
            ['Overview', 'Pre-built workflows that combine multiple steps into a simple, guided interface for common GIS tasks.'],
            ['Import Fence', 'Draw a rectangle on the map to set a spatial filter. All subsequent imports (file or ArcGIS REST) only load features inside the fence. ArcGIS REST queries are filtered server-side so only matching features are downloaded, preventing large dataset browser issues.']
        ]
    },
    {
        title: 'GIS Tools — Measurement',
        tools: [
            ['Distance', 'Measure the straight-line distance between two points you click on the map.'],
            ['Bearing', 'Find the compass direction (in degrees) from one point to another.'],
            ['Destination', 'Given a start point, distance, and compass direction, find where you would end up.'],
            ['Along', 'Find a point at a specific distance along a line feature.'],
            ['Pt→Line Distance', 'Measure the shortest perpendicular distance from a point to a line.']
        ]
    },
    {
        title: 'GIS Tools — Transformation',
        tools: [
            ['Buffer', 'Draw a zone around features at a set distance.'],
            ['Reproject', 'Convert a layer\'s coordinates so it displays correctly on the map. Creates a new layer in WGS 84.'],
            ['BBox Clip', 'Draw a rectangle on the map and clip all features to that area.'],
            ['Clip to Extent', 'Clip features to the current visible map area.'],
            ['Simplify', 'Reduce vertex count on geometries to shrink file size.'],
            ['Bezier Spline', 'Smooth jagged lines into gentle flowing curves.'],
            ['Polygon Smooth', 'Round off rough polygon edges.'],
            ['Line Offset', 'Create a parallel copy of a line shifted left or right.'],
            ['Sector', 'Create a pie-slice shaped area from a center point, radius, and compass bearings.']
        ]
    },
    {
        title: 'GIS Tools — Lines & Analysis',
        tools: [
            ['Line Slice Along', 'Extract a section of a line between two distances.'],
            ['Line Slice (Points)', 'Click two points on the map to cut out the section of line between them.'],
            ['Line Intersect', 'Find all points where two sets of lines cross each other.'],
            ['Kinks', 'Find self-intersections where a line or polygon edge crosses itself.'],
            ['Combine', 'Merge all features of the same type into one multi-feature.'],
            ['Union', 'Merge all polygons into a single unified shape.'],
            ['Dissolve', 'Merge polygons that share the same attribute value.'],
            ['Nearest Point', 'Click the map to find the closest feature in a point layer.'],
            ['Nearest Pt on Line', 'Click near a line to snap to the closest point on it.'],
            ['Nearest Pt to Line', 'Find which point in a layer is closest to a line.'],
            ['NN Analysis', 'Statistically test whether points are clustered, dispersed, or random.']
        ]
    },
    {
        title: 'Export',
        tools: [
            ['GeoJSON', 'Export spatial data as a .geojson file.'],
            ['CSV', 'Export attributes as a comma-separated .csv file.'],
            ['Excel', 'Export attributes as an .xlsx spreadsheet.'],
            ['KML', 'Export spatial data as a .kml file (Google Earth). Layer styles are preserved. With two or more layers, you can export a single multi-folder .kml.'],
            ['KMZ', 'Export as .kmz (compressed KML) with styles. With two or more layers, you can export a single multi-folder .kmz (same folder-per-layer behavior as KML). Can include embedded photos.'],
            ['JSON', 'Export raw data as a .json file.'],
            ['Shapefile', 'Export spatial data as a zipped Shapefile (.shp).']
        ]
    },
    {
        title: 'ArcGIS REST Import',
        tools: [
            ['Overview', 'Import features directly from public ArcGIS REST endpoints — no download or login required. All processing is done in the browser.'],
            ['Preset Layers', 'Choose from a curated list of UDOT and Utah layers including Routes ALRS, Reference Posts, Mile Points, Region Boundaries, Bridge Locations, Lanes, County Boundaries, and Municipal Boundaries.'],
            ['Custom URL', 'Enter any public ArcGIS REST FeatureServer or MapServer layer URL to import features directly.'],
            ['Supported', 'Works with Feature Servers, Map Servers, and individual layer endpoints. Handles paginated services that return features in batches automatically.']
        ]
    },
    {
        title: 'Workflows',
        tools: [
            ['Multi-Layer KMZ', 'Import your layers, style each one independently, then Export → KMZ. A picker lets you select which layers to include — each becomes its own folder in the KMZ with its own styling. No merge needed.'],
            ['Merge → Export', 'Use Merge Layers to combine selected layers into one. The merged layer gets a source_file field tracking each feature\'s origin. When exported as KML or KMZ, features are auto-grouped into folders by source layer name.'],
            ['Mixed Geometry', 'When you import a file with mixed geometry types (points + lines + polygons), they are automatically split into separate layers so you can style each type independently.']
        ]
    },
    {
        title: 'Other',
        tools: [
            ['AGOL Compatibility', 'Check and auto-fix field names/types for ArcGIS Online compatibility.']
        ]
    }
];
