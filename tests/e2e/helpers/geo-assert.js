import * as turf from '@turf/turf';

const BBOX_TOLERANCE = 0.5;

/**
 * @param {import('geojson').FeatureCollection} fc
 * @param {object} expected manifest fields
 */
export function assertFeatureCollection(fc, expected) {
    if (!fc || fc.type !== 'FeatureCollection') {
        throw new Error('Expected FeatureCollection export');
    }

    const features = fc.features || [];
    if (features.length !== expected.featureCount) {
        throw new Error(`count ${features.length} != ${expected.featureCount}`);
    }

    const types = new Set(features.map((f) => f.geometry?.type).filter(Boolean));
    for (const t of expected.geometryTypes || []) {
        if (!types.has(t)) {
            throw new Error(`missing geometry type ${t}, got ${[...types].join(',')}`);
        }
    }

    for (const f of features) {
        if (!f.geometry) continue;
        if (!turf.booleanValid(f)) {
            throw new Error('invalid geometry (turf.booleanValid)');
        }
        const coords = JSON.stringify(f.geometry.coordinates);
        if (coords.includes('NaN') || coords.includes('Infinity')) {
            throw new Error('geometry contains NaN or Infinity');
        }
    }

    if (expected.bbox?.length === 4 && !expected.skipBbox) {
        const bbox = turf.bbox(fc);
        for (let i = 0; i < 4; i++) {
            if (Math.abs(bbox[i] - expected.bbox[i]) > BBOX_TOLERANCE) {
                throw new Error(
                    `bbox[${i}] ${bbox[i]} != ${expected.bbox[i]} (±${BBOX_TOLERANCE})`
                );
            }
        }
    }

        if (expected.fields && features.length > 0) {
        const sample = features.slice(0, Math.min(5, features.length));
        for (const [name, typeHint] of Object.entries(expected.fields)) {
            for (const f of sample) {
                const v = f.properties?.[name];
                if (v === undefined && expected.allowMissingFields) continue;
                if (v === undefined && name === 'unicode') continue;
                assertFieldType(name, v, typeHint);
            }
        }
        if (expected.fields.unicode != null) {
            const withUnicode = features.find((f) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(String(f.properties?.unicode || '')));
            if (!withUnicode) throw new Error('unicode field sample missing');
        }
    }
}

function assertFieldType(name, value, typeHint) {
    if (value == null) return;
    if (typeHint === 'number') {
        if (typeof value === 'number') return;
        if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) return;
        throw new Error(`field ${name} expected number, got ${typeof value}`);
    }
    if (typeHint === 'string' && typeof value !== 'string') {
        throw new Error(`field ${name} expected string, got ${typeof value}`);
    }
}

/**
 * Compare round-trip export to original manifest expectations (T1 geojson).
 * @param {import('geojson').FeatureCollection} exported
 * @param {import('geojson').FeatureCollection} original
 */
export function assertRoundTrip(exported, original) {
    assertFeatureCollection(exported, {
        featureCount: original.features.length,
        geometryTypes: [...new Set(original.features.map((f) => f.geometry?.type).filter(Boolean))],
        bbox: turf.bbox(original),
        fields: inferFieldTypes(original.features[0]?.properties || {})
    });
}

function inferFieldTypes(props) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(props)) {
        out[k] = typeof v === 'number' ? 'number' : 'string';
    }
    return out;
}

export { turf };
