/**
 * MapLibre rendering for draw-layer text and callout annotations.
 */

export const ANNOTATION_TYPES = {
    TEXT: 'text',
    CALLOUT: 'callout'
};

export const DEFAULT_ANNOTATION_STYLE = {
    text: '',
    fontSize: 14,
    color: '#111111',
    haloColor: '#ffffff',
    haloWidth: 1.5,
    anchor: 'center',
    rotation: 0,
    leaderColor: '#333333',
    leaderWidth: 1.5
};

const TEXT_ANCHORS = [
    'center', 'top', 'bottom', 'left', 'right',
    'top-left', 'top-right', 'bottom-left', 'bottom-right'
];

export function annotationLabelSourceId(datasetId) {
    return `src-${datasetId}-ann-labels`;
}

export function annotationAnchorSourceId(datasetId) {
    return `src-${datasetId}-ann-anchors`;
}

/**
 * @param {object|null|undefined} feature
 * @returns {boolean}
 */
export function isAnnotationFeature(feature) {
    const t = feature?.properties?._annotationType;
    return t === ANNOTATION_TYPES.TEXT || t === ANNOTATION_TYPES.CALLOUT;
}

/**
 * @param {object[]} features
 * @returns {boolean}
 */
export function hasAnnotationFeatures(features) {
    return (features || []).some(isAnnotationFeature);
}

/**
 * @param {object} props
 * @param {'text'|'callout'} annotationType
 * @returns {object}
 */
export function normalizeAnnotationProperties(props = {}, annotationType) {
    const anchor = TEXT_ANCHORS.includes(props.anchor) ? props.anchor : DEFAULT_ANNOTATION_STYLE.anchor;
    return {
        ...DEFAULT_ANNOTATION_STYLE,
        ...props,
        _annotationType: annotationType,
        anchor,
        fontSize: Number.isFinite(Number(props.fontSize)) ? Number(props.fontSize) : DEFAULT_ANNOTATION_STYLE.fontSize,
        haloWidth: Number.isFinite(Number(props.haloWidth)) ? Number(props.haloWidth) : DEFAULT_ANNOTATION_STYLE.haloWidth,
        rotation: Number.isFinite(Number(props.rotation)) ? Number(props.rotation) : DEFAULT_ANNOTATION_STYLE.rotation,
        leaderWidth: Number.isFinite(Number(props.leaderWidth)) ? Number(props.leaderWidth) : DEFAULT_ANNOTATION_STYLE.leaderWidth
    };
}

/**
 * Exclude annotation features from standard geometry layers.
 * @param {object} baseFilter MapLibre filter expression
 * @returns {object}
 */
export function excludeAnnotationsFilter(baseFilter) {
    return ['all', baseFilter, ['!', ['has', '_annotationType']]];
}

/**
 * @param {object[]} features
 * @returns {object[]}
 */
export function buildAnnotationLabelFeatures(features) {
    const out = [];
    for (const f of features || []) {
        if (!isAnnotationFeature(f)) continue;
        const type = f.properties._annotationType;
        const props = { ...(f.properties || {}) };

        if (type === ANNOTATION_TYPES.TEXT && f.geometry?.type === 'Point') {
            out.push({ type: 'Feature', geometry: f.geometry, properties: props });
            continue;
        }

        if (type === ANNOTATION_TYPES.CALLOUT && f.geometry?.type === 'LineString') {
            const coords = f.geometry.coordinates;
            if (!coords?.length) continue;
            const labelCoord = coords[coords.length - 1];
            out.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: labelCoord },
                properties: props
            });
        }
    }
    return out;
}

/**
 * @param {object[]} features
 * @returns {object[]}
 */
export function buildAnnotationAnchorFeatures(features) {
    const out = [];
    for (const f of features || []) {
        if (f.properties?._annotationType !== ANNOTATION_TYPES.CALLOUT) continue;
        if (f.geometry?.type !== 'LineString') continue;
        const coords = f.geometry.coordinates;
        if (!coords?.length) continue;
        out.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords[0] },
            properties: {
                _featureIndex: f.properties._featureIndex,
                _datasetId: f.properties._datasetId,
                leaderColor: f.properties.leaderColor || DEFAULT_ANNOTATION_STYLE.leaderColor
            }
        });
    }
    return out;
}

const ANNOTATION_SYMBOL_LAYOUT = {
    'text-field': ['get', 'text'],
    'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
    'text-size': ['coalesce', ['get', 'fontSize'], DEFAULT_ANNOTATION_STYLE.fontSize],
    'text-anchor': ['coalesce', ['get', 'anchor'], DEFAULT_ANNOTATION_STYLE.anchor],
    'text-rotate': ['coalesce', ['get', 'rotation'], 0],
    'text-pitch-alignment': 'viewport',
    'text-rotation-alignment': 'viewport',
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-optional': false
};

const ANNOTATION_SYMBOL_PAINT = {
    'text-color': ['coalesce', ['get', 'color'], DEFAULT_ANNOTATION_STYLE.color],
    'text-halo-color': ['coalesce', ['get', 'haloColor'], DEFAULT_ANNOTATION_STYLE.haloColor],
    'text-halo-width': ['coalesce', ['get', 'haloWidth'], DEFAULT_ANNOTATION_STYLE.haloWidth]
};

/**
 * @param {string} datasetId
 * @param {string} mainSourceId
 * @param {object[]} features tagged features from the layer
 * @returns {{ sourceIds: string[], layerIds: string[], labelSourceId: string|null, anchorSourceId: string|null }}
 */
export function buildAnnotationLayerSpecs(datasetId, mainSourceId, features) {
    if (!hasAnnotationFeatures(features)) {
        return { sourceIds: [], layerIds: [], labelSourceId: null, anchorSourceId: null };
    }

    const labelSourceId = annotationLabelSourceId(datasetId);
    const anchorSourceId = annotationAnchorSourceId(datasetId);
    const labelFeatures = buildAnnotationLabelFeatures(features);
    const anchorFeatures = buildAnnotationAnchorFeatures(features);

    const layerIds = [];

    const calloutLineId = `${datasetId}-ann-callout-line`;
    layerIds.push(calloutLineId);

    const anchorId = `${datasetId}-ann-anchor`;
    layerIds.push(anchorId);

    const symbolId = `${datasetId}-ann-labels`;
    layerIds.push(symbolId);

    return {
        labelSourceId,
        anchorSourceId,
        labelSourceData: { type: 'FeatureCollection', features: labelFeatures },
        anchorSourceData: { type: 'FeatureCollection', features: anchorFeatures },
        layerIds,
        layers: [
            {
                id: calloutLineId,
                type: 'line',
                source: mainSourceId,
                filter: ['all',
                    ['==', ['geometry-type'], 'LineString'],
                    ['==', ['get', '_annotationType'], ANNOTATION_TYPES.CALLOUT]
                ],
                paint: {
                    'line-color': ['coalesce', ['get', 'leaderColor'], DEFAULT_ANNOTATION_STYLE.leaderColor],
                    'line-width': ['coalesce', ['get', 'leaderWidth'], DEFAULT_ANNOTATION_STYLE.leaderWidth],
                    'line-opacity': 1
                }
            },
            {
                id: anchorId,
                type: 'circle',
                source: anchorSourceId,
                paint: {
                    'circle-radius': 4,
                    'circle-color': ['coalesce', ['get', 'leaderColor'], DEFAULT_ANNOTATION_STYLE.leaderColor],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1,
                    'circle-pitch-alignment': 'viewport'
                }
            },
            {
                id: symbolId,
                type: 'symbol',
                source: labelSourceId,
                layout: ANNOTATION_SYMBOL_LAYOUT,
                paint: ANNOTATION_SYMBOL_PAINT
            }
        ]
    };
}

/**
 * Refresh derived annotation GeoJSON sources after in-place edits.
 * @param {import('maplibre-gl').Map} map
 * @param {string} datasetId
 * @param {object} geojson FeatureCollection
 */
export function syncAnnotationSources(map, datasetId, geojson) {
    if (!map || !datasetId) return;

    const labelSourceId = annotationLabelSourceId(datasetId);
    const anchorSourceId = annotationAnchorSourceId(datasetId);
    const features = geojson?.features || [];

    const labelSrc = map.getSource(labelSourceId);
    if (labelSrc) {
        labelSrc.setData({
            type: 'FeatureCollection',
            features: buildAnnotationLabelFeatures(features)
        });
    }

    const anchorSrc = map.getSource(anchorSourceId);
    if (anchorSrc) {
        anchorSrc.setData({
            type: 'FeatureCollection',
            features: buildAnnotationAnchorFeatures(features)
        });
    }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} datasetId
 */
export function removeAnnotationSources(map, datasetId) {
    if (!map || !datasetId) return;
    const labelSourceId = annotationLabelSourceId(datasetId);
    const anchorSourceId = annotationAnchorSourceId(datasetId);
    for (const sid of [labelSourceId, anchorSourceId]) {
        if (map.getSource(sid)) map.removeSource(sid);
    }
}
