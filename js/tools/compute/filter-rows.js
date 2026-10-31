import { cloneDatasetOutput, createLoopProgress } from './ctx.js';
import { evalFilterRule } from './filter-operators.js';

export function computeFilterRows(inputs, config, context) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    const activeRules = (config.rules || []).filter(r => r.field);
    if (activeRules.length === 0) return cloneDatasetOutput(data);

    const features = data.type === 'spatial' ? data.geojson.features : null;
    const rows = data.type === 'table' ? data.rows : null;
    const items = features || rows;

    const filtered = [];
    const tick = createLoopProgress(context, items.length);
    for (let i = 0; i < items.length; i++) {
        tick(i, 'Filtering rows');
        const item = items[i];
        const props = features ? item.properties : item;
        const results = activeRules.map(rule => evalFilterRule(props, rule));
        const keep = config.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
        if (keep) filtered.push(item);
    }

    if (data.type === 'spatial') {
        const geojson = { type: 'FeatureCollection', features: filtered };
        return { ...data, geojson, schema: { ...data.schema, featureCount: filtered.length } };
    }
    return { ...data, rows: filtered, schema: { ...data.schema, featureCount: filtered.length } };
}
