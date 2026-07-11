/**
 * Built-in callout profiles for fiber plan sets.
 */

export const DEFAULT_PROFILE_ID = 'profile-standard-fiber';

/** @type {object[]} */
export const BUILT_IN_CALLOUT_DEFINITIONS_RAW = [
    {
        calloutId: 'callout-fiber-6f',
        code: '1',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 6-count single-mode fiber',
        fullDescription: 'Install 6-count single-mode fiber optic cable per specification.',
        symbolKey: 'callout-triangle',
        displayOrder: 1
    },
    {
        calloutId: 'callout-fiber-12f',
        code: '2',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 12-count single-mode fiber',
        symbolKey: 'callout-triangle',
        displayOrder: 2
    },
    {
        calloutId: 'callout-fiber-24f',
        code: '3',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 24-count single-mode fiber',
        symbolKey: 'callout-triangle',
        displayOrder: 3
    },
    {
        calloutId: 'callout-fiber-48f',
        code: '4',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 48-count single-mode fiber',
        symbolKey: 'callout-triangle',
        displayOrder: 4
    },
    {
        calloutId: 'callout-fiber-96f',
        code: '5',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 96-count single-mode fiber',
        symbolKey: 'callout-triangle',
        displayOrder: 5
    },
    {
        calloutId: 'callout-fiber-144f',
        code: '6',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 144-count single-mode fiber',
        symbolKey: 'callout-triangle',
        displayOrder: 6
    },
    {
        calloutId: 'callout-fiber-288f',
        code: '7',
        shape: 'triangle',
        category: 'Fiber',
        shortDescription: 'Install 288-count single-mode fiber',
        symbolKey: 'callout-triangle',
        displayOrder: 7
    },
    {
        calloutId: 'callout-conduit-bore',
        code: '10',
        shape: 'square',
        category: 'Conduit',
        shortDescription: 'Directional bore with HDPE duct',
        symbolKey: 'callout-square',
        displayOrder: 10
    },
    {
        calloutId: 'callout-conduit-trench',
        code: '11',
        shape: 'square',
        category: 'Conduit',
        shortDescription: 'Open trench with HDPE duct',
        symbolKey: 'callout-square',
        displayOrder: 11
    },
    {
        calloutId: 'callout-junction-box',
        code: '22',
        shape: 'square',
        category: 'Structure',
        shortDescription: 'Install Type 3 junction box',
        symbolKey: 'callout-square',
        displayOrder: 22
    },
    {
        calloutId: 'callout-vault',
        code: '23',
        shape: 'square',
        category: 'Structure',
        shortDescription: 'Install precast vault',
        symbolKey: 'callout-square',
        displayOrder: 23
    },
    {
        calloutId: 'callout-splice',
        code: '30',
        shape: 'octagon',
        category: 'Splice',
        shortDescription: 'Install splice enclosure',
        symbolKey: 'callout-octagon',
        displayOrder: 30
    }
];

/** @type {object[]} */
export const BUILT_IN_CALLOUT_RULES_RAW = [
    {
        ruleId: 'rule-fiber-6f',
        calloutId: 'callout-fiber-6f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '6' }]
    },
    {
        ruleId: 'rule-fiber-12f',
        calloutId: 'callout-fiber-12f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '12' }]
    },
    {
        ruleId: 'rule-fiber-24f',
        calloutId: 'callout-fiber-24f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '24' }]
    },
    {
        ruleId: 'rule-fiber-48f',
        calloutId: 'callout-fiber-48f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '48' }]
    },
    {
        ruleId: 'rule-fiber-96f',
        calloutId: 'callout-fiber-96f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '96' }]
    },
    {
        ruleId: 'rule-fiber-144f',
        calloutId: 'callout-fiber-144f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '144' }]
    },
    {
        ruleId: 'rule-fiber-288f',
        calloutId: 'callout-fiber-288f',
        conditions: [{ operator: 'equals', field: 'strand_count', value: '288' }]
    },
    {
        ruleId: 'rule-conduit-bore',
        calloutId: 'callout-conduit-bore',
        conditions: [{ operator: 'equals', field: 'installation_method', value: 'directional_bore' }]
    },
    {
        ruleId: 'rule-conduit-trench',
        calloutId: 'callout-conduit-trench',
        conditions: [{ operator: 'equals', field: 'installation_method', value: 'open_trench' }]
    },
    {
        ruleId: 'rule-junction-box',
        calloutId: 'callout-junction-box',
        conditions: [{ operator: 'equals', field: 'asset_type', value: 'junction_box' }]
    },
    {
        ruleId: 'rule-vault',
        calloutId: 'callout-vault',
        conditions: [{ operator: 'equals', field: 'asset_type', value: 'vault' }]
    },
    {
        ruleId: 'rule-splice',
        calloutId: 'callout-splice',
        conditions: [{ operator: 'equals', field: 'feature_type', value: 'splice' }]
    }
];
