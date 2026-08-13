/** Splash / info guide — illustration-first cards (ToolGuideDialog, MobileGate). */

export const SPLASH_FLOW = {
    image: '/icons/splash-flow.png',
    steps: [
        { label: 'Import', hint: 'Bring data in' },
        { label: 'Interact', hint: 'View, edit, analyze' },
        { label: 'Export', hint: 'Save or convert' }
    ]
};

/** Compact How To rows for MobileGate (and any text-only fallback). */
export const SPLASH_HOW_TO = SPLASH_FLOW.steps.map((step, i) => [
    `${i + 1}️⃣ ${step.label}`,
    step.hint
]);

export const SPLASH_SOURCE_ICONS = [
    { src: '/icons/import-source-local.png', label: 'Files' },
    { src: '/icons/import-source-arcgis.png', label: 'ArcGIS' },
    { src: '/icons/import-source-live.png', label: 'Live' },
    { src: '/icons/import-source-photo.png', label: 'Photos' },
    { src: '/icons/import-source-toolbox.png', label: 'Kit' },
    { src: '/icons/import-source-draw.png', label: 'Draw' },
    { src: '/icons/import-source-fence.png', label: 'Fence' }
];

export const SPLASH_MODE_ICONS = [
    { src: '/icons/import-mode-memory.png', label: 'Memory' },
    { src: '/icons/import-mode-viewport.png', label: 'Viewport' },
    { src: '/icons/import-mode-tiled.png', label: 'Tiled' }
];

export const SPLASH_CARDS = [
    {
        id: 'browser',
        title: 'Runs in your browser',
        caption: 'No install. Work stays on this device.',
        image: '/icons/splash-browser.png'
    },
    {
        id: 'ui',
        title: 'Layers · Map · Fields',
        caption: 'Left: layers. Center: map. Right: attributes.',
        image: '/icons/splash-ui-layout.png'
    },
    {
        id: 'import',
        title: 'Bring data in',
        caption: 'Files, services, photos, draw, or fence.',
        type: 'sourceGrid'
    },
    {
        id: 'modes',
        title: 'Big files stay usable',
        caption: 'Memory, Viewport, or Tiled display.',
        type: 'modeRow'
    },
    {
        id: 'select',
        title: 'Select features',
        caption: 'Click, Shift+click, or drag a box.',
        image: '/icons/splash-select.png'
    },
    {
        id: 'fence',
        title: 'Import Fence',
        caption: 'Only load what’s inside the box.',
        image: '/icons/import-source-fence.png'
    },
    {
        id: 'pipeline',
        title: 'Pipelines',
        caption: 'Chain steps, then send results to the map.',
        image: '/icons/splash-pipeline.png'
    },
    {
        id: 'export',
        title: 'Export',
        caption: 'GeoJSON, KML/KMZ, Shapefile, CSV, Excel…',
        image: '/icons/splash-export.png'
    }
];

/** @deprecated kept for any leftover imports — prefer SPLASH_* exports */
export const TOOL_GUIDE_SECTIONS = [
    {
        title: 'How To',
        tools: SPLASH_HOW_TO
    }
];
