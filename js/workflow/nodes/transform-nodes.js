/**
 * Transform nodes — data manipulation operations
 */
import { NodeBase } from './node-base.js';
import { convertFeatureCoords } from '../../tools/coordinates.js';
import { computeFilterRows } from '../../tools/compute/filter-rows.js';
import { computeDeduplicate } from '../../tools/compute/deduplicate.js';
import {
    FILTER_OPERATOR_ALIASES,
    normalizeFilterOperator,
    evalFilterRule
} from '../../tools/compute/filter-operators.js';
import {
    computeRenameFields,
    computeDeleteFields,
    computeSort,
    computeFindReplace,
    computeAddUniqueId,
    computeCombineFields,
    computeSplitColumn,
    computeTemplateBuilder,
    computeTypeConvert,
    computeJoinLookup,
    computeCalculateField,
    computeConditionalValue,
    computeUnitConvert,
    computeAddField
} from '../../tools/compute/transform-operations.js';
import { adaptComputeContext } from '../compute-run-context.js';

export { FILTER_OPERATOR_ALIASES, normalizeFilterOperator };
export { UNIT_CATEGORIES } from '../../tools/compute/transform-operations.js';

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
        return computeFilterRows(inputs, this.config, adaptComputeContext(context));
    }

    _evalRule(props, rule) {
        return evalFilterRule(props, rule);
    }
}

// ==============================
// Rename Fields
// ==============================
export class RenameFieldsNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeRenameFields(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Delete Fields
// ==============================
export class DeleteFieldsNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeDeleteFields(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Sort
// ==============================
export class SortNode extends NodeBase {
    static runsInWorker = true;

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
        return computeSort(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Find & Replace
// ==============================
export class FindReplaceNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeFindReplace(inputs, this.config, adaptComputeContext(context));
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
        return computeDeduplicate(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Add Unique ID
// ==============================
export class AddUniqueIdNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeAddUniqueId(inputs, this.config, adaptComputeContext(context));
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
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeCombineFields(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Split Column
// ==============================
export class SplitColumnNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeSplitColumn(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Template Builder
// ==============================
export class TemplateBuilderNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeTemplateBuilder(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Type Convert
// ==============================
export class TypeConvertNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeTypeConvert(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Join / Lookup (VLOOKUP)
// ==============================
export class JoinLookupNode extends NodeBase {
    static runsInWorker = true;

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
        return computeJoinLookup(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Calculate Field (math expressions)
// ==============================
export class CalculateFieldNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeCalculateField(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Conditional Value (IF / CASE)
// ==============================
export class ConditionalValueNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeConditionalValue(inputs, this.config, adaptComputeContext(context));
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
export class UnitConvertNode extends NodeBase {
    static runsInWorker = true;

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

    async execute(inputs, context) {
        return computeUnitConvert(inputs, this.config, adaptComputeContext(context));
    }
}

// ==============================
// Add Field — add a new attribute field with a default value
// ==============================
export class AddFieldNode extends NodeBase {
    static runsInWorker = true;

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
        return computeAddField(inputs, this.config, adaptComputeContext(context));
    }
}
