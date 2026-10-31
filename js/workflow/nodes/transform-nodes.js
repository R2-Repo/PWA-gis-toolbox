/**
 * Transform nodes — data manipulation operations
 */
import { NodeBase } from './node-base.js';
import { applyTemplate } from '../../dataprep/template-builder.js';
import { typeConvert } from '../../dataprep/transforms.js';
import { convertFeatureCoords } from '../../tools/coordinates.js';
import { createLoopProgress, cloneDatasetOutput, throwIfAborted, throwIfAbortedPeriodic } from '../workflow-run-helpers.js';
import { computeFilterRows } from '../compute/filter-rows.js';
import { computeDeduplicate } from '../compute/deduplicate.js';
import {
    FILTER_OPERATOR_ALIASES,
    normalizeFilterOperator,
    evalFilterRule
} from '../compute/filter-operators.js';

export { FILTER_OPERATOR_ALIASES, normalizeFilterOperator };

// ==============================
// Filter Rows
// ==============================
export class FilterRowsNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('filter-rows', {
            name: 'Filter Rows',
            icon: '🔍',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Filtered', dataType: 'dataset' }];
        this.config = { rules: [{ field: '', operator: 'equals', value: '' }], logic: 'AND' };
    }

    validate() {
        const activeRules = this.config.rules.filter(r => r.field);
        if (activeRules.length === 0) return { valid: false, message: 'No filter rules defined' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeFilterRows(inputs, this.config, context);
    }

    _evalRule(props, rule) {
        return evalFilterRule(props, rule);
    }
}

// ==============================
// Rename Fields
// ==============================
export class RenameFieldsNode extends NodeBase {
    constructor() {
        super('rename-fields', {
            name: 'Rename Fields',
            icon: '✏️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Renamed', dataType: 'dataset' }];
        this.config = { mappings: [] }; // [{ from, to }]
    }

    validate() {
        const active = this.config.mappings.filter(m => m.from && m.to);
        if (active.length === 0) return { valid: false, message: 'No renames defined' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const map = {};
        for (const m of this.config.mappings) { if (m.from && m.to) map[m.from] = m.to; }
        if (Object.keys(map).length === 0) return cloneDatasetOutput(data);

        const renameProps = (props) => {
            const out = {};
            for (const [k, v] of Object.entries(props)) {
                out[map[k] || k] = v;
            }
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: renameProps(f.properties || {}) }));
            const schema = { ...data.schema, fields: data.schema.fields.map(f => ({ ...f, name: map[f.name] || f.name })) };
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => renameProps(r));
        const schema = { ...data.schema, fields: data.schema.fields.map(f => ({ ...f, name: map[f.name] || f.name })) };
        return { ...data, rows, schema };
    }
}

// ==============================
// Delete Fields
// ==============================
export class DeleteFieldsNode extends NodeBase {
    constructor() {
        super('delete-fields', {
            name: 'Delete Fields',
            icon: '🗑️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Trimmed', dataType: 'dataset' }];
        this.config = { fieldsToDelete: [] };
    }

    validate() {
        if (this.config.fieldsToDelete.length === 0) return { valid: false, message: 'No fields selected to delete' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const del = new Set(this.config.fieldsToDelete);

        const stripProps = (props) => {
            const out = {};
            for (const [k, v] of Object.entries(props)) {
                if (!del.has(k)) out[k] = v;
            }
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: stripProps(f.properties || {}) }));
            const schema = { ...data.schema, fields: data.schema.fields.filter(f => !del.has(f.name)) };
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => stripProps(r));
        const schema = { ...data.schema, fields: data.schema.fields.filter(f => !del.has(f.name)) };
        return { ...data, rows, schema };
    }
}

// ==============================
// Sort
// ==============================
export class SortNode extends NodeBase {
    constructor() {
        super('sort', {
            name: 'Sort',
            icon: '↕️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Sorted', dataType: 'dataset' }];
        this.config = { field: '', direction: 'asc' };
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No sort field selected' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        throwIfAborted(context?.signal);
        context?.reportProgress?.({ progress: 0, message: 'Sorting rows' });

        const cmp = (a, b) => {
            const va = a[this.config.field];
            const vb = b[this.config.field];
            const na = parseFloat(va), nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) return this.config.direction === 'asc' ? na - nb : nb - na;
            const sa = String(va ?? ''), sb = String(vb ?? '');
            return this.config.direction === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
        };

        if (data.type === 'spatial') {
            const features = [...data.geojson.features].sort((a, b) => cmp(a.properties || {}, b.properties || {}));
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
}

// ==============================
// Find & Replace
// ==============================
export class FindReplaceNode extends NodeBase {
    constructor() {
        super('find-replace', {
            name: 'Find & Replace',
            icon: '🔎',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Replaced', dataType: 'dataset' }];
        this.config = { field: '', find: '', replace: '', caseTransform: '' };
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No field selected' };
        if (!this.config.find && !this.config.caseTransform) return { valid: false, message: 'Nothing to find or transform' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const apply = (props) => {
            const out = { ...props };
            let val = String(out[this.config.field] ?? '');
            if (this.config.find) val = val.split(this.config.find).join(this.config.replace);
            if (this.config.caseTransform === 'upper') val = val.toUpperCase();
            if (this.config.caseTransform === 'lower') val = val.toLowerCase();
            if (this.config.caseTransform === 'title') val = val.replace(/\b\w/g, c => c.toUpperCase());
            out[this.config.field] = val;
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: apply(f.properties || {}) }));
            return { ...data, geojson: { type: 'FeatureCollection', features } };
        }
        return { ...data, rows: data.rows.map(apply) };
    }
}

// ==============================
// Deduplicate
// ==============================
export class DeduplicateNode extends NodeBase {
    static runsInWorker = true;

    constructor() {
        super('deduplicate', {
            name: 'Deduplicate',
            icon: '🧹',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Unique', dataType: 'dataset' }];
        this.config = { keyFields: [], keep: 'first' };
    }

    validate() {
        if (this.config.keyFields.length === 0) return { valid: false, message: 'No key fields selected' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        return computeDeduplicate(inputs, this.config, context);
    }
}

// ==============================
// Add Unique ID
// ==============================
export class AddUniqueIdNode extends NodeBase {
    constructor() {
        super('add-unique-id', {
            name: 'Add Unique ID',
            icon: '🆔',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'With ID', dataType: 'dataset' }];
        this.config = { fieldName: 'uid', method: 'sequential' };
    }

    validate() {
        if (!this.config.fieldName) return { valid: false, message: 'Field name required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        let counter = 1;
        const genId = () => this.config.method === 'uuid'
            ? crypto.randomUUID()
            : counter++;

        const addId = props => ({ ...props, [this.config.fieldName]: genId() });

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: addId(f.properties || {}) }));
            const fields = [...data.schema.fields, { name: this.config.fieldName, type: 'string', nullCount: 0, uniqueCount: features.length, sampleValues: [], selected: true, outputName: this.config.fieldName, order: data.schema.fields.length }];
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema: { ...data.schema, fields } };
        }
        const rows = data.rows.map(r => addId(r));
        const fields = [...data.schema.fields, { name: this.config.fieldName, type: 'string', nullCount: 0, uniqueCount: rows.length, sampleValues: [], selected: true, outputName: this.config.fieldName, order: data.schema.fields.length }];
        return { ...data, rows, schema: { ...data.schema, fields } };
    }
}

// ==============================
// Registry
// ==============================
export const TRANSFORM_NODES = [
    { type: 'filter-rows', label: 'Filter Rows', icon: '🔍', create: () => new FilterRowsNode() },
    { type: 'rename-fields', label: 'Rename Fields', icon: '✏️', create: () => new RenameFieldsNode() },
    { type: 'delete-fields', label: 'Delete Fields', icon: '🗑️', create: () => new DeleteFieldsNode() },
    { type: 'find-replace', label: 'Find & Replace', icon: '🔎', create: () => new FindReplaceNode() },
    { type: 'sort', label: 'Sort', icon: '↕️', create: () => new SortNode() },
    { type: 'deduplicate', label: 'Deduplicate', icon: '🧹', create: () => new DeduplicateNode() },
    { type: 'add-unique-id', label: 'Add Unique ID', icon: '🆔', create: () => new AddUniqueIdNode() },
    { type: 'combine-fields', label: 'Combine Fields', icon: '🔗', create: () => new CombineFieldsNode() },
    { type: 'split-column', label: 'Split Column', icon: '✂️', create: () => new SplitColumnNode() },
    { type: 'template-builder', label: 'Template Builder', icon: '📝', create: () => new TemplateBuilderNode() },
    { type: 'type-convert', label: 'Type Convert', icon: '🔄', create: () => new TypeConvertNode() },
    { type: 'join-lookup', label: 'Join / Lookup', icon: '🔗', create: () => new JoinLookupNode() },
    { type: 'calculate-field', label: 'Calculate Field', icon: '🧮', create: () => new CalculateFieldNode() },
    { type: 'conditional-value', label: 'Conditional Value', icon: '❓', create: () => new ConditionalValueNode() },
    { type: 'coord-convert', label: 'Coordinate Converter', icon: '🌐', create: () => new CoordConvertNode() },
    { type: 'unit-convert', label: 'Unit Converter', icon: '📏', create: () => new UnitConvertNode() },
    { type: 'add-field', label: 'Add Field', icon: '➕', create: () => new AddFieldNode() }
];

// ==============================
// Combine Fields (Concatenate)
// ==============================
export class CombineFieldsNode extends NodeBase {
    constructor() {
        super('combine-fields', {
            name: 'Combine Fields',
            icon: '🔗',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Combined', dataType: 'dataset' }];
        this.config = { fields: [], delimiter: ' ', outputField: 'combined', skipBlanks: true };
    }

    validate() {
        if (this.config.fields.length < 2) return { valid: false, message: 'Select at least 2 fields' };
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { fields, delimiter, outputField, skipBlanks } = this.config;

        const combine = (props) => {
            let vals = fields.map(f => props[f]);
            if (skipBlanks) vals = vals.filter(v => v != null && v !== '');
            return { ...props, [outputField]: vals.join(delimiter) };
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: combine(f.properties || {}) }));
            const schema = this._addFieldToSchema(data.schema, outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(combine);
        return { ...data, rows, schema: this._addFieldToSchema(data.schema, outputField) };
    }

    _addFieldToSchema(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Split Column
// ==============================
export class SplitColumnNode extends NodeBase {
    constructor() {
        super('split-column', {
            name: 'Split Column',
            icon: '✂️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Split', dataType: 'dataset' }];
        this.config = { field: '', delimiter: ',', maxParts: 0, outputNames: '' };
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No field selected' };
        if (!this.config.delimiter) return { valid: false, message: 'Delimiter required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { field, delimiter, maxParts } = this.config;
        const names = this.config.outputNames
            ? this.config.outputNames.split(',').map(s => s.trim()).filter(Boolean)
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
            const features = data.geojson.features.map(f => ({ ...f, properties: split(f.properties || {}) }));
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema: this._rebuildSchema(features, data.schema) };
        }
        const rows = data.rows.map(split);
        return { ...data, rows, schema: this._rebuildSchema(rows, data.schema, true) };
    }

    _rebuildSchema(items, origSchema, isTable = false) {
        const s = JSON.parse(JSON.stringify(origSchema));
        const sample = isTable ? items[0] : items[0]?.properties;
        if (sample) {
            for (const key of Object.keys(sample)) {
                if (!s.fields.find(f => f.name === key)) {
                    s.fields.push({ name: key, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: key, order: s.fields.length });
                }
            }
        }
        return s;
    }
}

// ==============================
// Template Builder
// ==============================
export class TemplateBuilderNode extends NodeBase {
    constructor() {
        super('template-builder', {
            name: 'Template Builder',
            icon: '📝',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Templated', dataType: 'dataset' }];
        this.config = { template: '', outputField: 'formatted', skipBlanks: true };
    }

    validate() {
        if (!this.config.template) return { valid: false, message: 'Template is empty' };
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const opts = {
            trimWhitespace: true,
            collapseSpaces: true,
            skipEmptyFields: this.config.skipBlanks,
            removeEmptyWrappers: true,
            removeDanglingSeparators: true,
            collapseSeparators: true
        };

        if (data.type === 'spatial') {
            const features = applyTemplate(data.geojson.features, this.config.template, this.config.outputField, opts);
            const schema = this._addField(data.schema, this.config.outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        // Table: wrap rows as fake features, apply, unwrap
        const fakeFeatures = data.rows.map(r => ({ properties: r }));
        const applied = applyTemplate(fakeFeatures, this.config.template, this.config.outputField, opts);
        const rows = applied.map(f => f.properties);
        return { ...data, rows, schema: this._addField(data.schema, this.config.outputField) };
    }

    _addField(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Type Convert
// ==============================
export class TypeConvertNode extends NodeBase {
    constructor() {
        super('type-convert', {
            name: 'Type Convert',
            icon: '🔄',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Converted', dataType: 'dataset' }];
        this.config = { field: '', targetType: 'number' };
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No field selected' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        if (data.type === 'spatial') {
            const { features } = typeConvert(data.geojson.features, this.config.field, this.config.targetType);
            const schema = JSON.parse(JSON.stringify(data.schema));
            const f = schema.fields.find(f => f.name === this.config.field);
            if (f) f.type = this.config.targetType;
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const fakeFeatures = data.rows.map(r => ({ properties: r }));
        const { features } = typeConvert(fakeFeatures, this.config.field, this.config.targetType);
        const rows = features.map(f => f.properties);
        const schema = JSON.parse(JSON.stringify(data.schema));
        const fld = schema.fields.find(f => f.name === this.config.field);
        if (fld) fld.type = this.config.targetType;
        return { ...data, rows, schema };
    }
}

// ==============================
// Join / Lookup (VLOOKUP)
// ==============================
export class JoinLookupNode extends NodeBase {
    constructor() {
        super('join-lookup', {
            name: 'Join / Lookup',
            icon: '🔗',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [
            { id: 'in', label: 'Main Data', dataType: 'dataset' },
            { id: 'lookup', label: 'Lookup Table', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Joined', dataType: 'dataset' }];
        this.config = { leftKey: '', rightKey: '', fieldsToJoin: [] };
    }

    validate() {
        if (!this.config.leftKey) return { valid: false, message: 'Main key field required' };
        if (!this.config.rightKey) return { valid: false, message: 'Lookup key field required' };
        if (this.config.fieldsToJoin.length === 0) return { valid: false, message: 'Select fields to add' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const main = inputs[0];
        const lookup = inputs[1];
        if (!main) throw new Error('No main data');
        if (!lookup) throw new Error('No lookup data connected');

        const { leftKey, rightKey, fieldsToJoin } = this.config;

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
            const schema = this._addFields(main.schema, fieldsToJoin);
            return { ...main, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const srcRows = main.rows;
        const rows = [];
        const tick = createLoopProgress(context, srcRows.length);
        for (let i = 0; i < srcRows.length; i++) {
            tick(i, 'Joining attributes');
            rows.push(joinProps(srcRows[i]));
        }
        return { ...main, rows, schema: this._addFields(main.schema, fieldsToJoin) };
    }

    _addFields(schema, fieldNames) {
        const s = JSON.parse(JSON.stringify(schema));
        for (const fn of fieldNames) {
            if (!s.fields.find(f => f.name === fn)) {
                s.fields.push({ name: fn, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fn, order: s.fields.length });
            }
        }
        return s;
    }
}

// ==============================
// Calculate Field (math expressions)
// ==============================
export class CalculateFieldNode extends NodeBase {
    constructor() {
        super('calculate-field', {
            name: 'Calculate Field',
            icon: '🧮',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Calculated', dataType: 'dataset' }];
        this.config = { expression: '', outputField: 'result' };
    }

    validate() {
        if (!this.config.expression) return { valid: false, message: 'Expression is empty' };
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        // Quick syntax check: only allow safe characters
        const stripped = this.config.expression.replace(/\[[^\]]+\]/g, '0');
        if (/[^0-9+\-*/%.() \t]/.test(stripped)) {
            return { valid: false, message: 'Expression contains invalid characters' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const expr = this.config.expression;
        const outputField = this.config.outputField;

        // Extract field references
        const fieldRefs = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(expr)) !== null) fieldRefs.push(m[1]);

        const calc = (props) => {
            let evalStr = expr;
            for (const f of fieldRefs) {
                const val = parseFloat(props[f]);
                const num = isNaN(val) ? 0 : val;
                // Use split/join to replace all occurrences
                evalStr = evalStr.split(`[${f}]`).join(String(num));
            }
            // Validate: only digits, operators, parens, dots, spaces
            if (/[^0-9+\-*/%.() \t]/.test(evalStr)) return null;
            try {
                // Safe evaluation using Function constructor with no scope access
                const fn = new Function(`"use strict"; return (${evalStr});`);
                const result = fn();
                return typeof result === 'number' && isFinite(result) ? Math.round(result * 1e10) / 1e10 : null;
            } catch {
                return null;
            }
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...f.properties, [outputField]: calc(f.properties || {}) }
            }));
            const schema = this._addField(data.schema, outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => ({ ...r, [outputField]: calc(r) }));
        return { ...data, rows, schema: this._addField(data.schema, outputField) };
    }

    _addField(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'number', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Conditional Value (IF / CASE)
// ==============================
export class ConditionalValueNode extends NodeBase {
    constructor() {
        super('conditional-value', {
            name: 'Conditional Value',
            icon: '❓',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Result', dataType: 'dataset' }];
        this.config = {
            outputField: 'category',
            rules: [{ field: '', operator: 'equals', value: '', result: '' }],
            defaultValue: ''
        };
    }

    validate() {
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        const active = this.config.rules.filter(r => r.field);
        if (active.length === 0) return { valid: false, message: 'At least one rule required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { outputField, rules, defaultValue } = this.config;
        const activeRules = rules.filter(r => r.field);

        const evaluate = (props) => {
            for (const rule of activeRules) {
                if (this._evalRule(props, rule)) return rule.result;
            }
            return defaultValue;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...f.properties, [outputField]: evaluate(f.properties || {}) }
            }));
            const schema = this._addField(data.schema, outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => ({ ...r, [outputField]: evaluate(r) }));
        return { ...data, rows, schema: this._addField(data.schema, outputField) };
    }

    _evalRule(props, rule) {
        const raw = props[rule.field];
        const val = raw == null ? '' : String(raw);
        const cmp = String(rule.value ?? '');
        switch (normalizeFilterOperator(rule.operator)) {
            case 'equals': return val === cmp;
            case 'not_equals': return val !== cmp;
            case 'contains': return val.toLowerCase().includes(cmp.toLowerCase());
            case 'greater_than': return parseFloat(raw) > parseFloat(cmp);
            case 'less_than': return parseFloat(raw) < parseFloat(cmp);
            case 'gte': return parseFloat(raw) >= parseFloat(cmp);
            case 'lte': return parseFloat(raw) <= parseFloat(cmp);
            case 'is_null': return raw == null || val === '';
            case 'is_not_null': return raw != null && val !== '';
            default: return false;
        }
    }

    _addField(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Coordinate Converter
// ==============================
export class CoordConvertNode extends NodeBase {
    constructor() {
        super('coord-convert', {
            name: 'Coordinate Converter',
            icon: '🌐',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Converted', dataType: 'dataset' }];
        this.config = {
            source: 'geometry',  // 'geometry' or 'fields'
            fromFormat: 'dd',
            toFormat: 'dms',
            latField: '',
            lonField: '',
            outputPrefix: ''
        };
    }

    validate() {
        if (!this.config.toFormat) return { valid: false, message: 'Select a target format' };
        if (this.config.source === 'fields') {
            if (!this.config.latField || !this.config.lonField)
                return { valid: false, message: 'Select latitude and longitude fields' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { source, fromFormat, toFormat, latField, lonField, outputPrefix } = this.config;

        const opts = {
            toFormat,
            useGeometry: source === 'geometry',
            fromFormat: source === 'geometry' ? 'dd' : fromFormat,
            latField: source === 'fields' ? latField : null,
            lonField: source === 'fields' ? lonField : null,
            outputPrefix: outputPrefix || undefined
        };

        if (data.type === 'spatial') {
            const { features } = convertFeatureCoords(data.geojson.features, opts);
            const schema = this._buildOutputSchema(data.schema, toFormat, outputPrefix);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }

        // Table data: wrap as fake features
        const fakeFeatures = data.rows.map(r => ({ properties: r }));
        opts.useGeometry = false;
        const { features: converted } = convertFeatureCoords(fakeFeatures, opts);
        const rows = converted.map(f => f.properties);
        const schema = this._buildOutputSchema(data.schema, toFormat, outputPrefix);
        return { ...data, rows, schema };
    }

    _buildOutputSchema(schema, toFormat, prefix) {
        const s = JSON.parse(JSON.stringify(schema));
        const p = prefix || toFormat.toUpperCase();
        const newFields = toFormat === 'utm'
            ? [`${p}_zone`, `${p}_easting`, `${p}_northing`, `${p}_full`]
            : [`${p}_lat`, `${p}_lon`];
        for (const name of newFields) {
            if (!s.fields.find(f => f.name === name)) {
                const type = (name.includes('easting') || name.includes('northing')) ? 'number' : 'string';
                s.fields.push({ name, type, nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: name, order: s.fields.length });
            }
        }
        return s;
    }
}

// ==============================
// Unit Converter — all-in-one unit conversion
// ==============================

/** Conversion tables: every value is the factor to convert TO the base unit of that category.
 *  To convert A → B: value_in_B = value_in_A * (FACTOR_A / FACTOR_B)  */
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
        _base: null, // special handling
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

    // Temperature is special
    if (category === 'Temperature') {
        return _convertTemperature(value, fromUnit, toUnit);
    }

    const fromFactor = cat[fromUnit];
    const toFactor = cat[toUnit];
    if (fromFactor == null || toFactor == null) return null;
    // value_in_base = value * fromFactor   →   result = value_in_base / toFactor
    return (value * fromFactor) / toFactor;
}

function _convertTemperature(value, from, to) {
    if (from === to) return value;
    // Convert to Celsius first
    let c;
    if (from === 'celsius') c = value;
    else if (from === 'fahrenheit') c = (value - 32) * 5 / 9;
    else if (from === 'kelvin') c = value - 273.15;
    else return null;
    // Convert from Celsius to target
    if (to === 'celsius') return c;
    if (to === 'fahrenheit') return c * 9 / 5 + 32;
    if (to === 'kelvin') return c + 273.15;
    return null;
}

export class UnitConvertNode extends NodeBase {
    constructor() {
        super('unit-convert', {
            name: 'Unit Converter',
            icon: '📏',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Converted', dataType: 'dataset' }];
        this.config = {
            sourceField: '',
            category: 'Length / Distance',
            fromUnit: 'feet',
            toUnit: 'meters',
            outputField: '',
            precision: 4
        };
    }

    validate() {
        if (!this.config.sourceField) return { valid: false, message: 'Select a source field' };
        if (!this.config.fromUnit || !this.config.toUnit) return { valid: false, message: 'Select from and to units' };
        if (this.config.fromUnit === this.config.toUnit) return { valid: false, message: 'From and To units are the same' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const { sourceField, category, fromUnit, toUnit, outputField, precision } = this.config;
        const outName = outputField || sourceField;
        const p = Math.pow(10, precision);
        const convert = v => {
            const num = parseFloat(v);
            if (isNaN(num)) return null;
            const result = convertUnit(num, fromUnit, toUnit, category);
            return result != null ? Math.round(result * p) / p : null;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...f.properties, [outName]: convert(f.properties?.[sourceField]) }
            }));
            const schema = this._updateSchema(data.schema, outName, features.map(f => f.properties[outName]));
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }

        // Table
        const rows = data.rows.map(r => ({ ...r, [outName]: convert(r[sourceField]) }));
        const schema = this._updateSchema(data.schema, outName, rows.map(r => r[outName]));
        return { ...data, rows, schema };
    }

    _updateSchema(origSchema, fieldName, values) {
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
}

// ==============================
// Add Field — add a new attribute field with a default value
// ==============================
export class AddFieldNode extends NodeBase {
    constructor() {
        super('add-field', {
            name: 'Add Field',
            icon: '➕',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'With Field', dataType: 'dataset' }];
        this.config = { fieldName: '', fieldType: 'string', defaultValue: '' };
    }

    validate() {
        if (!this.config.fieldName) return { valid: false, message: 'Field name is required' };
        if (/[.\[\]]/.test(this.config.fieldName)) return { valid: false, message: 'Field name cannot contain . [ or ]' };
        if (this.config.fieldType === 'number' && this.config.defaultValue !== '') {
            if (isNaN(Number(this.config.defaultValue))) return { valid: false, message: 'Default value is not a valid number' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const { fieldName, fieldType, defaultValue: rawDefault } = this.config;

        // Check for duplicate field name
        if (data.schema?.fields?.find(f => f.name === fieldName)) {
            throw new Error(`Field "${fieldName}" already exists`);
        }

        // Coerce default value
        let defaultValue = rawDefault === '' ? null : rawDefault;
        if (fieldType === 'attachment') {
            defaultValue = null;
        } else if (defaultValue !== null) {
            if (fieldType === 'number') {
                defaultValue = Number(rawDefault);
                if (isNaN(defaultValue)) throw new Error('Default value is not a valid number');
            } else if (fieldType === 'boolean') {
                defaultValue = ['true', '1', 'yes'].includes(rawDefault.toLowerCase());
            }
        }

        // Build new schema field
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
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...(f.properties || {}), [fieldName]: defaultValue }
            }));
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }

        // Table
        const rows = data.rows.map(r => ({ ...r, [fieldName]: defaultValue }));
        return { ...data, rows, schema };
    }
}
