import { applyTemplate } from '../../dataprep/template-builder.js';
import { typeConvert } from '../../dataprep/transforms.js';
import {
    cloneDatasetOutput,
    createLoopProgress,
    throwIfAborted,
    throwIfAbortedPeriodic
} from '../workflow-run-helpers.js';
import { evalFilterRule } from './filter-operators.js';

/** Conversion tables — factor to base unit per category. */
export const UNIT_CATEGORIES = {
    'Length / Distance': {
        _base: 'meters',
        millimeters: 0.001, centimeters: 0.01, meters: 1, kilometers: 1000,
        inches: 0.0254, feet: 0.3048, yards: 0.9144, miles: 1609.344,
        'nautical miles': 1852, micrometers: 1e-6, 'us survey feet': 0.3048006096
    },
    'Area': {
        _base: 'sq meters',
        'sq millimeters': 1e-6, 'sq centimeters': 1e-4, 'sq meters': 1, 'sq kilometers': 1e6,
        'sq inches': 6.4516e-4, 'sq feet': 0.09290304, 'sq yards': 0.83612736,
        'sq miles': 2589988.11, acres: 4046.8564224, hectares: 10000
    },
    'Volume': {
        _base: 'liters',
        milliliters: 0.001, liters: 1, 'cubic meters': 1000, 'cubic centimeters': 0.001,
        gallons: 3.785411784, quarts: 0.946352946, pints: 0.473176473,
        cups: 0.2365882365, 'fluid ounces': 0.0295735296, 'cubic feet': 28.316846592,
        'cubic inches': 0.016387064, 'imperial gallons': 4.54609, barrels: 158.987294928
    },
    'Weight / Mass': {
        _base: 'kilograms',
        milligrams: 1e-6, grams: 0.001, kilograms: 1, 'metric tons': 1000,
        ounces: 0.028349523, pounds: 0.45359237, 'short tons': 907.18474, 'long tons': 1016.0469088,
        stones: 6.35029318, grains: 6.479891e-5
    },
    'Temperature': {
        _base: null,
        celsius: 'C', fahrenheit: 'F', kelvin: 'K'
    },
    'Speed': {
        _base: 'm/s',
        'm/s': 1, 'km/h': 0.277778, 'mph': 0.44704, knots: 0.514444,
        'ft/s': 0.3048, 'mach': 343
    },
    'Pressure': {
        _base: 'pascals',
        pascals: 1, kilopascals: 1000, bar: 100000, atm: 101325,
        psi: 6894.757, mmHg: 133.322, 'inHg': 3386.389
    },
    'Time': {
        _base: 'seconds',
        milliseconds: 0.001, seconds: 1, minutes: 60, hours: 3600,
        days: 86400, weeks: 604800, years: 31557600
    },
    'Angle': {
        _base: 'degrees',
        degrees: 1, radians: 57.29577951, gradians: 0.9, arcminutes: 1 / 60,
        arcseconds: 1 / 3600
    },
    'Data / Storage': {
        _base: 'bytes',
        bytes: 1, kilobytes: 1024, megabytes: 1048576, gigabytes: 1073741824,
        terabytes: 1099511627776, bits: 0.125, kibibytes: 1024, mebibytes: 1048576
    },
    'Energy': {
        _base: 'joules',
        joules: 1, kilojoules: 1000, calories: 4.184, kilocalories: 4184,
        'watt-hours': 3600, 'kilowatt-hours': 3600000, btu: 1055.06, 'electron volts': 1.602e-19
    },
    'Flow Rate': {
        _base: 'liters/s',
        'liters/s': 1, 'liters/min': 1 / 60, 'cubic meters/s': 1000,
        'cubic meters/hr': 1000 / 3600, 'gallons/min': 3.785411784 / 60,
        'cubic feet/s': 28.316846592
    }
};

function convertUnit(value, fromUnit, toUnit, category) {
    if (value == null || isNaN(value)) return null;
    const cat = UNIT_CATEGORIES[category];
    if (!cat) return null;
    if (category === 'Temperature') {
        return _convertTemperature(value, fromUnit, toUnit);
    }
    const fromFactor = cat[fromUnit];
    const toFactor = cat[toUnit];
    if (fromFactor == null || toFactor == null) return null;
    return (value * fromFactor) / toFactor;
}

function _convertTemperature(value, from, to) {
    if (from === to) return value;
    let c;
    if (from === 'celsius') c = value;
    else if (from === 'fahrenheit') c = (value - 32) * 5 / 9;
    else if (from === 'kelvin') c = value - 273.15;
    else return null;
    if (to === 'celsius') return c;
    if (to === 'fahrenheit') return c * 9 / 5 + 32;
    if (to === 'kelvin') return c + 273.15;
    return null;
}

function addFieldToSchema(schema, fieldName, fieldType = 'string') {
    const s = JSON.parse(JSON.stringify(schema));
    if (!s.fields.find(f => f.name === fieldName)) {
        s.fields.push({
            name: fieldName,
            type: fieldType,
            nullCount: 0,
            uniqueCount: 0,
            sampleValues: [],
            selected: true,
            outputName: fieldName,
            order: s.fields.length
        });
    }
    return s;
}

function rebuildSchemaFromSplit(items, origSchema, isTable = false) {
    const s = JSON.parse(JSON.stringify(origSchema));
    const sample = isTable ? items[0] : items[0]?.properties;
    if (sample) {
        for (const key of Object.keys(sample)) {
            if (!s.fields.find(f => f.name === key)) {
                s.fields.push({
                    name: key,
                    type: 'string',
                    nullCount: 0,
                    uniqueCount: 0,
                    sampleValues: [],
                    selected: true,
                    outputName: key,
                    order: s.fields.length
                });
            }
        }
    }
    return s;
}

function addFieldsToSchema(schema, fieldNames) {
    const s = JSON.parse(JSON.stringify(schema));
    for (const fn of fieldNames) {
        if (!s.fields.find(f => f.name === fn)) {
            s.fields.push({
                name: fn,
                type: 'string',
                nullCount: 0,
                uniqueCount: 0,
                sampleValues: [],
                selected: true,
                outputName: fn,
                order: s.fields.length
            });
        }
    }
    return s;
}

function updateUnitSchema(origSchema, fieldName, values) {
    const s = JSON.parse(JSON.stringify(origSchema));
    const vals = values.filter(v => v != null);
    const existing = s.fields.find(f => f.name === fieldName);
    if (existing) {
        existing.type = 'number';
    } else {
        s.fields.push({
            name: fieldName,
            type: 'number',
            nullCount: values.length - vals.length,
            uniqueCount: new Set(vals).size,
            sampleValues: vals.slice(0, 5),
            min: vals.length ? Math.min(...vals) : null,
            max: vals.length ? Math.max(...vals) : null,
            selected: true,
            outputName: fieldName,
            order: s.fields.length
        });
    }
    return s;
}

export function computeRenameFields(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    const map = {};
    for (const m of config.mappings || []) {
        if (m.from && m.to) map[m.from] = m.to;
    }
    if (Object.keys(map).length === 0) return cloneDatasetOutput(data);

    const renameProps = (props) => {
        const out = {};
        for (const [k, v] of Object.entries(props)) {
            out[map[k] || k] = v;
        }
        return out;
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Renaming fields');
            const f = src[i];
            features.push({ ...f, properties: renameProps(f.properties || {}) });
        }
        const schema = {
            ...data.schema,
            fields: data.schema.fields.map(f => ({ ...f, name: map[f.name] || f.name }))
        };
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Renaming fields');
        rows.push(renameProps(srcRows[i]));
    }
    const schema = {
        ...data.schema,
        fields: data.schema.fields.map(f => ({ ...f, name: map[f.name] || f.name }))
    };
    return { ...data, rows, schema };
}

export function computeDeleteFields(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    const del = new Set(config.fieldsToDelete || []);

    const stripProps = (props) => {
        const out = {};
        for (const [k, v] of Object.entries(props)) {
            if (!del.has(k)) out[k] = v;
        }
        return out;
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Deleting fields');
            const f = src[i];
            features.push({ ...f, properties: stripProps(f.properties || {}) });
        }
        const schema = { ...data.schema, fields: data.schema.fields.filter(f => !del.has(f.name)) };
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Deleting fields');
        rows.push(stripProps(srcRows[i]));
    }
    const schema = { ...data.schema, fields: data.schema.fields.filter(f => !del.has(f.name)) };
    return { ...data, rows, schema };
}

export function computeSort(inputs, config, context) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    throwIfAborted(context?.signal);
    context?.reportProgress?.({ progress: 0, message: 'Sorting rows' });

    const cmp = (a, b) => {
        const va = a[config.field];
        const vb = b[config.field];
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) {
            return config.direction === 'asc' ? na - nb : nb - na;
        }
        const sa = String(va ?? '');
        const sb = String(vb ?? '');
        return config.direction === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    };

    if (data.type === 'spatial') {
        const features = [...data.geojson.features].sort((a, b) =>
            cmp(a.properties || {}, b.properties || {})
        );
        throwIfAborted(context?.signal);
        context?.reportProgress?.({
            progress: 1,
            processed: features.length,
            total: features.length,
            message: 'Sort complete'
        });
        return { ...data, geojson: { type: 'FeatureCollection', features } };
    }
    const rows = [...data.rows].sort(cmp);
    throwIfAborted(context?.signal);
    context?.reportProgress?.({
        progress: 1,
        processed: rows.length,
        total: rows.length,
        message: 'Sort complete'
    });
    return { ...data, rows };
}

export function computeFindReplace(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    const apply = (props) => {
        const out = { ...props };
        let val = String(out[config.field] ?? '');
        if (config.find) val = val.split(config.find).join(config.replace);
        if (config.caseTransform === 'upper') val = val.toUpperCase();
        if (config.caseTransform === 'lower') val = val.toLowerCase();
        if (config.caseTransform === 'title') val = val.replace(/\b\w/g, c => c.toUpperCase());
        out[config.field] = val;
        return out;
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Find & replace');
            const f = src[i];
            features.push({ ...f, properties: apply(f.properties || {}) });
        }
        return { ...data, geojson: { type: 'FeatureCollection', features } };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Find & replace');
        rows.push(apply(srcRows[i]));
    }
    return { ...data, rows };
}

export function computeAddUniqueId(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    let counter = 1;
    const genId = () => (config.method === 'uuid' ? crypto.randomUUID() : counter++);

    const addId = props => ({ ...props, [config.fieldName]: genId() });

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Adding unique ID');
            const f = src[i];
            features.push({ ...f, properties: addId(f.properties || {}) });
        }
        const fields = [
            ...data.schema.fields,
            {
                name: config.fieldName,
                type: 'string',
                nullCount: 0,
                uniqueCount: features.length,
                sampleValues: [],
                selected: true,
                outputName: config.fieldName,
                order: data.schema.fields.length
            }
        ];
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema: { ...data.schema, fields } };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Adding unique ID');
        rows.push(addId(srcRows[i]));
    }
    const fields = [
        ...data.schema.fields,
        {
            name: config.fieldName,
            type: 'string',
            nullCount: 0,
            uniqueCount: rows.length,
            sampleValues: [],
            selected: true,
            outputName: config.fieldName,
            order: data.schema.fields.length
        }
    ];
    return { ...data, rows, schema: { ...data.schema, fields } };
}

export function computeCombineFields(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    const { fields, delimiter, outputField, skipBlanks } = config;

    const combine = (props) => {
        let vals = fields.map(f => props[f]);
        if (skipBlanks) vals = vals.filter(v => v != null && v !== '');
        return { ...props, [outputField]: vals.join(delimiter) };
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Combining fields');
            const f = src[i];
            features.push({ ...f, properties: combine(f.properties || {}) });
        }
        const schema = addFieldToSchema(data.schema, outputField);
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Combining fields');
        rows.push(combine(srcRows[i]));
    }
    return { ...data, rows, schema: addFieldToSchema(data.schema, outputField) };
}

export function computeSplitColumn(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    const { field, delimiter, maxParts } = config;
    const names = config.outputNames
        ? config.outputNames.split(',').map(s => s.trim()).filter(Boolean)
        : [];

    const split = (props) => {
        const val = String(props[field] ?? '');
        let parts = maxParts > 0 ? val.split(delimiter).slice(0, maxParts) : val.split(delimiter);
        parts = parts.map(p => p.trim());
        const out = { ...props };
        parts.forEach((p, i) => {
            out[names[i] || `${field}_${i + 1}`] = p;
        });
        return out;
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Splitting column');
            const f = src[i];
            features.push({ ...f, properties: split(f.properties || {}) });
        }
        return {
            ...data,
            geojson: { type: 'FeatureCollection', features },
            schema: rebuildSchemaFromSplit(features, data.schema)
        };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Splitting column');
        rows.push(split(srcRows[i]));
    }
    return { ...data, rows, schema: rebuildSchemaFromSplit(rows, data.schema, true) };
}

export function computeTemplateBuilder(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    const opts = {
        trimWhitespace: true,
        collapseSpaces: true,
        skipEmptyFields: config.skipBlanks,
        removeEmptyWrappers: true,
        removeDanglingSeparators: true,
        collapseSeparators: true
    };

    if (data.type === 'spatial') {
        const features = applyTemplate(data.geojson.features, config.template, config.outputField, opts);
        const schema = addFieldToSchema(data.schema, config.outputField);
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const fakeFeatures = data.rows.map(r => ({ properties: r }));
    const applied = applyTemplate(fakeFeatures, config.template, config.outputField, opts);
    const rows = applied.map(f => f.properties);
    return { ...data, rows, schema: addFieldToSchema(data.schema, config.outputField) };
}

export function computeTypeConvert(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    if (data.type === 'spatial') {
        const { features } = typeConvert(data.geojson.features, config.field, config.targetType);
        const schema = JSON.parse(JSON.stringify(data.schema));
        const f = schema.fields.find(fld => fld.name === config.field);
        if (f) f.type = config.targetType;
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const fakeFeatures = data.rows.map(r => ({ properties: r }));
    const { features } = typeConvert(fakeFeatures, config.field, config.targetType);
    const rows = features.map(f => f.properties);
    const schema = JSON.parse(JSON.stringify(data.schema));
    const fld = schema.fields.find(f => f.name === config.field);
    if (fld) fld.type = config.targetType;
    return { ...data, rows, schema };
}

export function computeJoinLookup(inputs, config, context) {
    const main = inputs[0];
    const lookup = inputs[1];
    if (!main) throw new Error('No main data');
    if (!lookup) throw new Error('No lookup data connected');

    const { leftKey, rightKey, fieldsToJoin } = config;

    const lookupRows = lookup.type === 'spatial'
        ? lookup.geojson.features.map(f => f.properties || {})
        : lookup.rows || [];

    const lookupMap = new Map();
    for (let i = 0; i < lookupRows.length; i++) {
        throwIfAbortedPeriodic(context?.signal, i);
        const row = lookupRows[i];
        const key = String(row[rightKey] ?? '');
        if (!lookupMap.has(key)) lookupMap.set(key, row);
    }

    const joinProps = (props) => {
        const key = String(props[leftKey] ?? '');
        const match = lookupMap.get(key);
        const out = { ...props };
        for (const field of fieldsToJoin) {
            out[field] = match ? (match[field] ?? null) : null;
        }
        return out;
    };

    if (main.type === 'spatial') {
        const src = main.geojson.features;
        const features = [];
        const tick = createLoopProgress(context, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Joining attributes');
            const f = src[i];
            features.push({ ...f, properties: joinProps(f.properties || {}) });
        }
        const schema = addFieldsToSchema(main.schema, fieldsToJoin);
        return { ...main, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = main.rows;
    const rows = [];
    const tick = createLoopProgress(context, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Joining attributes');
        rows.push(joinProps(srcRows[i]));
    }
    return { ...main, rows, schema: addFieldsToSchema(main.schema, fieldsToJoin) };
}

export function computeCalculateField(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    const expr = config.expression;
    const outputField = config.outputField;

    const fieldRefs = [];
    const re = /\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(expr)) !== null) fieldRefs.push(m[1]);

    const calc = (props) => {
        let evalStr = expr;
        for (const f of fieldRefs) {
            const val = parseFloat(props[f]);
            const num = isNaN(val) ? 0 : val;
            evalStr = evalStr.split(`[${f}]`).join(String(num));
        }
        if (/[^0-9+\-*/%.() \t]/.test(evalStr)) return null;
        try {
            const fn = new Function(`"use strict"; return (${evalStr});`);
            const result = fn();
            return typeof result === 'number' && isFinite(result) ? Math.round(result * 1e10) / 1e10 : null;
        } catch {
            return null;
        }
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Calculating field');
            const f = src[i];
            features.push({
                ...f,
                properties: { ...f.properties, [outputField]: calc(f.properties || {}) }
            });
        }
        const schema = addFieldToSchema(data.schema, outputField, 'number');
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Calculating field');
        const r = srcRows[i];
        rows.push({ ...r, [outputField]: calc(r) });
    }
    return { ...data, rows, schema: addFieldToSchema(data.schema, outputField, 'number') };
}

export function computeConditionalValue(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');
    const { outputField, rules, defaultValue } = config;
    const activeRules = (rules || []).filter(r => r.field);

    const evaluate = (props) => {
        for (const rule of activeRules) {
            if (evalFilterRule(props, rule)) return rule.result;
        }
        return defaultValue;
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Conditional value');
            const f = src[i];
            features.push({
                ...f,
                properties: { ...f.properties, [outputField]: evaluate(f.properties || {}) }
            });
        }
        const schema = addFieldToSchema(data.schema, outputField);
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Conditional value');
        const r = srcRows[i];
        rows.push({ ...r, [outputField]: evaluate(r) });
    }
    return { ...data, rows, schema: addFieldToSchema(data.schema, outputField) };
}

export function computeUnitConvert(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    const { sourceField, category, fromUnit, toUnit, outputField, precision } = config;
    const outName = outputField || sourceField;
    const p = Math.pow(10, precision);
    const convert = v => {
        const num = parseFloat(v);
        if (isNaN(num)) return null;
        const result = convertUnit(num, fromUnit, toUnit, category);
        return result != null ? Math.round(result * p) / p : null;
    };

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Converting units');
            const f = src[i];
            features.push({
                ...f,
                properties: { ...f.properties, [outName]: convert(f.properties?.[sourceField]) }
            });
        }
        const schema = updateUnitSchema(
            data.schema,
            outName,
            features.map(f => f.properties[outName])
        );
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Converting units');
        const r = srcRows[i];
        rows.push({ ...r, [outName]: convert(r[sourceField]) });
    }
    const schema = updateUnitSchema(data.schema, outName, rows.map(r => r[outName]));
    return { ...data, rows, schema };
}

export function computeAddField(inputs, config) {
    const data = inputs[0];
    if (!data) throw new Error('No input data');

    const { fieldName, fieldType, defaultValue: rawDefault } = config;

    if (data.schema?.fields?.find(f => f.name === fieldName)) {
        throw new Error(`Field "${fieldName}" already exists`);
    }

    let defaultValue = rawDefault === '' ? null : rawDefault;
    if (fieldType === 'attachment') {
        defaultValue = null;
    } else if (defaultValue !== null) {
        if (fieldType === 'number') {
            defaultValue = Number(rawDefault);
            if (isNaN(defaultValue)) throw new Error('Default value is not a valid number');
        } else if (fieldType === 'boolean') {
            defaultValue = ['true', '1', 'yes'].includes(String(rawDefault).toLowerCase());
        }
    }

    const maxOrder = (data.schema?.fields || []).reduce((m, f) => Math.max(m, f.order || 0), -1);
    const newSchemaField = {
        name: fieldName,
        type: fieldType,
        nullCount: defaultValue === null ? (data.schema?.featureCount || 0) : 0,
        uniqueCount: defaultValue === null ? 0 : 1,
        sampleValues: defaultValue !== null ? [defaultValue] : [],
        min: fieldType === 'number' && defaultValue !== null ? defaultValue : null,
        max: fieldType === 'number' && defaultValue !== null ? defaultValue : null,
        selected: true,
        outputName: fieldName,
        order: maxOrder + 1
    };

    const schema = JSON.parse(JSON.stringify(data.schema || { fields: [] }));
    schema.fields.push(newSchemaField);

    if (data.type === 'spatial') {
        const src = data.geojson.features;
        const features = [];
        const tick = createLoopProgress(null, src.length);
        for (let i = 0; i < src.length; i++) {
            tick(i, 'Adding field');
            const f = src[i];
            features.push({
                ...f,
                properties: { ...(f.properties || {}), [fieldName]: defaultValue }
            });
        }
        return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
    }
    const srcRows = data.rows;
    const rows = [];
    const tick = createLoopProgress(null, srcRows.length);
    for (let i = 0; i < srcRows.length; i++) {
        tick(i, 'Adding field');
        rows.push({ ...srcRows[i], [fieldName]: defaultValue });
    }
    return { ...data, rows, schema };
}
