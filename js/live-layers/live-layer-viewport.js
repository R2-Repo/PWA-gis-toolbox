import { RENDER_LIMITS } from '../map/render-limits.js';

/** Vector service kinds that stream GeoJSON features into the map. */
export const VECTOR_SERVICE_KINDS = new Set(['arcgis-featureserver', 'geojson-feed', 'wfs']);

/**
 * @param {string} [kind]
 */
export function isVectorServiceKind(kind) {
    return VECTOR_SERVICE_KINDS.has(kind);
}

/**
 * Cap features/vertices for map display (same budgets as workspace viewport).
 * @param {object[]} features
 * @returns {{ features: object[], truncated: boolean }}
 */
export function applyRenderLimits(features) {
    const out = [];
    let vertices = 0;
    let truncated = false;

    for (const f of features || []) {
        if (out.length >= RENDER_LIMITS.maxFeaturesPerSource) {
            truncated = true;
            break;
        }
        const v = countVertices(f?.geometry);
        if (vertices + v > RENDER_LIMITS.maxVerticesPerViewport) {
            truncated = true;
            break;
        }
        vertices += v;
        out.push(f);
    }

    return { features: out, truncated };
}

/**
 * Tag viewport features for map interaction.
 * Prefers a stable ArcGIS object id when present; falls back to positional index.
 * @param {string} datasetId
 * @param {object[]} features
 * @param {string} [objectIdField]
 * @returns {object[]}
 */
export function tagServiceFeatures(datasetId, features, objectIdField = 'OBJECTID') {
    const tagged = [];
    const used = new Set();

    for (let i = 0; i < (features || []).length; i++) {
        const f = features[i];
        if (!f?.geometry) continue;

        let index = resolveStableFeatureIndex(f, objectIdField, i);
        if (used.has(index)) {
            index = i;
        }
        used.add(index);

        tagged.push({
            ...f,
            properties: {
                ...(f.properties || {}),
                _featureIndex: index,
                _datasetId: datasetId
            }
        });
    }

    return tagged;
}

/**
 * @param {object} feature
 * @param {string} objectIdField
 * @param {number} fallback
 */
export function resolveStableFeatureIndex(feature, objectIdField, fallback) {
    const props = feature?.properties || {};
    const raw = props[objectIdField] ?? props.OBJECTID ?? props.objectid ?? props.FID ?? props.fid;
    if (raw != null && raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

/**
 * Keep only selection indices still present in the viewport.
 * @param {Iterable<number|string>} selectedIndices
 * @param {object[]} features
 * @returns {number[]}
 */
export function pruneSelectionToViewport(selectedIndices, features) {
    const present = new Set(
        (features || []).map((f) => Number(f.properties?._featureIndex)).filter(Number.isFinite)
    );
    return [...selectedIndices]
        .map((i) => Number(i))
        .filter((i) => Number.isFinite(i) && present.has(i));
}

function countVertices(geom) {
    if (!geom?.coordinates) return 0;
    let n = 0;
    const visit = (coords) => {
        if (typeof coords[0] === 'number') {
            n++;
            return;
        }
        for (const c of coords) visit(c);
    };
    visit(geom.coordinates);
    return n;
}
