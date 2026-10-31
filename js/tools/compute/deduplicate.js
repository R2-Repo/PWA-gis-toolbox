import { createLoopProgress } from './ctx.js';

export function computeDeduplicate(inputs, config, context) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    const items = data.type === 'spatial' ? data.geojson.features : data.rows;
    const seen = new Map();
    const result = [];
    const tick = createLoopProgress(context, items.length);

    for (let i = 0; i < items.length; i++) {
        tick(i, 'Deduplicating');
        const item = items[i];
        const props = data.type === 'spatial' ? item.properties : item;
        const key = (config.keyFields || []).map(f => String(props[f] ?? '')).join('|');
        if (config.keep === 'first') {
            if (!seen.has(key)) { seen.set(key, true); result.push(item); }
        } else {
            seen.set(key, item);
        }
    }
    const final = config.keep === 'last' ? [...seen.values()] : result;

    if (data.type === 'spatial') {
        return {
            ...data,
            geojson: { type: 'FeatureCollection', features: final },
            schema: { ...data.schema, featureCount: final.length }
        };
    }
    return { ...data, rows: final, schema: { ...data.schema, featureCount: final.length } };
}
