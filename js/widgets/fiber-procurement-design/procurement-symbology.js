/**
 * Procurement design symbology catalog — categories, line items, and symbol keys.
 * Catalog CSV rows will be matched to these entries via catalogMatchers until
 * explicit symbol_key columns are provided in the spreadsheet.
 */

export const PROCUREMENT_CATEGORIES = {
    CONDUIT: 'conduit_products',
    FIBER: 'fiber_optic_cables',
    HANDHOLES: 'hand_holds',
    SPLICING: 'splicing',
    BUILDINGS: 'buildings'
};

/** @type {Record<string, string>} */
export const PROCUREMENT_CATEGORY_LABELS = {
    [PROCUREMENT_CATEGORIES.CONDUIT]: 'Conduit Products',
    [PROCUREMENT_CATEGORIES.FIBER]: 'Fiber Optic Cables',
    [PROCUREMENT_CATEGORIES.HANDHOLES]: 'Hand Holds',
    [PROCUREMENT_CATEGORIES.SPLICING]: 'Splicing',
    [PROCUREMENT_CATEGORIES.BUILDINGS]: 'Buildings'
};

/**
 * Conduit diameter → line width (px) for map display.
 * @type {Record<string, number>}
 */
const CONDUIT_WIDTHS = {
    '1': 2.5,
    '1.25': 3,
    '2': 3.5,
    '3': 4.5,
    '4': 5.5
};

/**
 * Fiber strand count → line width (px) for map display.
 * @type {Record<number, number>}
 */
const FIBER_WIDTHS = {
    6: 1.75,
    12: 2,
    24: 2.25,
    48: 2.5,
    72: 2.75,
    144: 3,
    288: 3.5
};

/**
 * @param {string} diameter
 * @param {string} color
 * @returns {object}
 */
function conduitLineSymbol(diameter, color) {
    return {
        kind: 'line',
        color,
        width: CONDUIT_WIDTHS[diameter] || 3,
        dash: [],
        casing: { color: '#ffffff', width: (CONDUIT_WIDTHS[diameter] || 3) + 2 },
        displayOffset: 0,
        labelTemplate: `${diameter}" conduit`,
        category: PROCUREMENT_CATEGORIES.CONDUIT,
        diameterInches: Number(diameter)
    };
}

/**
 * @param {number} count
 * @param {string} color
 * @param {number[]} dash
 * @returns {object}
 */
function fiberLineSymbol(count, color, dash) {
    return {
        kind: 'line',
        color,
        width: FIBER_WIDTHS[count] || 2,
        dash,
        casing: { color: '#1e293b', width: (FIBER_WIDTHS[count] || 2) + 2 },
        displayOffset: 3,
        labelTemplate: `{strandCount}F {cableType}`,
        category: PROCUREMENT_CATEGORIES.FIBER,
        strandCount: count
    };
}

/**
 * @param {string} icon
 * @param {string} label
 * @param {object} [extra]
 * @returns {object}
 */
function pointSymbol(icon, label, extra = {}) {
    return {
        kind: 'point',
        icon,
        size: extra.size ?? 1,
        labelTemplate: extra.labelTemplate || label,
        category: extra.category,
        ...extra
    };
}

/**
 * Catalog entries — each maps to a symbolKey and optional CSV matchers.
 * @type {Array<object>}
 */
export const PROCUREMENT_SYMBOLOGY_ITEMS = [
    // Conduit products
    {
        itemId: 'conduit-1in',
        category: PROCUREMENT_CATEGORIES.CONDUIT,
        label: '1 inch',
        symbolKey: 'conduit-1in',
        geometryKind: 'line',
        catalogMatchers: [/\b1[\s-]*(inch|in|")\b/i, /\b1\.0[\s-]*(inch|in|")?\b/i]
    },
    {
        itemId: 'conduit-1.25in',
        category: PROCUREMENT_CATEGORIES.CONDUIT,
        label: '1.25 inch',
        symbolKey: 'conduit-1.25in',
        geometryKind: 'line',
        catalogMatchers: [/\b1\.?25[\s-]*(inch|in|")?\b/i]
    },
    {
        itemId: 'conduit-2in',
        category: PROCUREMENT_CATEGORIES.CONDUIT,
        label: '2 inch',
        symbolKey: 'conduit-2in',
        geometryKind: 'line',
        catalogMatchers: [/\b2[\s-]*(inch|in|")\b/i, /\b2\.0[\s-]*(inch|in|")?\b/i]
    },
    {
        itemId: 'conduit-3in',
        category: PROCUREMENT_CATEGORIES.CONDUIT,
        label: '3 inch',
        symbolKey: 'conduit-3in',
        geometryKind: 'line',
        catalogMatchers: [/\b3[\s-]*(inch|in|")\b/i, /\b3\.0[\s-]*(inch|in|")?\b/i]
    },
    {
        itemId: 'conduit-4in',
        category: PROCUREMENT_CATEGORIES.CONDUIT,
        label: '4 inch',
        symbolKey: 'conduit-4in',
        geometryKind: 'line',
        catalogMatchers: [/\b4[\s-]*(inch|in|")\b/i, /\b4\.0[\s-]*(inch|in|")?\b/i]
    },

    // Fiber optic cables
    ...([6, 12, 24, 48, 72, 144, 288].map((count) => ({
        itemId: `fiber-${count}ct`,
        category: PROCUREMENT_CATEGORIES.FIBER,
        label: `${count} count`,
        symbolKey: `fiber-${count}ct`,
        geometryKind: 'line',
        strandCount: count,
        catalogMatchers: [
            new RegExp(`\\b${count}[\\s-]*(count|ct|fiber|strand|f)\\b`, 'i'),
            new RegExp(`\\b${count}[\\s-]*count\\b`, 'i')
        ]
    }))),

    // Hand holds
    {
        itemId: 'handhole-type-1',
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        label: 'Type 1 junction box',
        symbolKey: 'handhole-type-1',
        geometryKind: 'point',
        catalogMatchers: [/type\s*1/i, /\bt1\b/i, /junction\s*box.*1/i]
    },
    {
        itemId: 'handhole-type-2',
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        label: 'Type 2 junction box',
        symbolKey: 'handhole-type-2',
        geometryKind: 'point',
        catalogMatchers: [/type\s*2/i, /\bt2\b/i, /junction\s*box.*2/i]
    },
    {
        itemId: 'handhole-type-3',
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        label: 'Type 3 junction box',
        symbolKey: 'handhole-type-3',
        geometryKind: 'point',
        catalogMatchers: [/type\s*3/i, /\bt3\b/i, /junction\s*box.*3/i]
    },
    {
        itemId: 'handhole-vault',
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        label: 'Vault',
        symbolKey: 'handhole-vault',
        geometryKind: 'point',
        catalogMatchers: [/\bvault\b/i, /type\s*4/i]
    },

    // Splicing
    {
        itemId: 'splice-enclosure',
        category: PROCUREMENT_CATEGORIES.SPLICING,
        label: 'Splice enclosure',
        symbolKey: 'splice-enclosure',
        geometryKind: 'point',
        catalogMatchers: [/splice\s*enclosure/i, /fusion\s*splice/i, /\benclosure\b/i]
    },

    // Buildings
    {
        itemId: 'building-entrance',
        category: PROCUREMENT_CATEGORIES.BUILDINGS,
        label: 'Building entrance',
        symbolKey: 'building-entrance',
        geometryKind: 'point',
        catalogMatchers: [/building\s*entrance/i, /\bentrance\b/i, /service\s*entrance/i]
    },
    {
        itemId: 'building',
        category: PROCUREMENT_CATEGORIES.BUILDINGS,
        label: 'Building',
        symbolKey: 'building',
        geometryKind: 'point',
        isContainer: true,
        catalogMatchers: [/^building$/i, /\bbuilding\b(?!.*entrance)/i],
        notes: 'Not a line item — represents a building with attribute line items.'
    }
];

/**
 * Symbol style definitions keyed by symbolKey.
 * Merged into the shared SYMBOL_REGISTRY at runtime.
 * @type {Record<string, object>}
 */
export const PROCUREMENT_SYMBOL_DEFINITIONS = {
    'conduit-1in': conduitLineSymbol('1', '#0ea5e9'),
    'conduit-1.25in': conduitLineSymbol('1.25', '#06b6d4'),
    'conduit-2in': conduitLineSymbol('2', '#0891b2'),
    'conduit-3in': conduitLineSymbol('3', '#2563eb'),
    'conduit-4in': conduitLineSymbol('4', '#1d4ed8'),

    'fiber-6ct': fiberLineSymbol(6, '#fcd34d', [3, 2]),
    'fiber-12ct': fiberLineSymbol(12, '#fbbf24', [4, 2]),
    'fiber-24ct': fiberLineSymbol(24, '#f59e0b', [2, 1]),
    'fiber-48ct': fiberLineSymbol(48, '#f97316', [5, 2, 1, 2]),
    'fiber-72ct': fiberLineSymbol(72, '#ea580c', [6, 2]),
    'fiber-144ct': fiberLineSymbol(144, '#dc2626', [3, 1, 1, 1]),
    'fiber-288ct': fiberLineSymbol(288, '#991b1b', [8, 3]),

    'handhole-type-1': pointSymbol('handhole-type-1', 'Type 1 junction box', {
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        labelTemplate: 'Type 1 JB',
        accentColor: '#10b981'
    }),
    'handhole-type-2': pointSymbol('handhole-type-2', 'Type 2 junction box', {
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        labelTemplate: 'Type 2 JB',
        size: 1.05,
        accentColor: '#059669'
    }),
    'handhole-type-3': pointSymbol('handhole-type-3', 'Type 3 junction box', {
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        labelTemplate: 'Type 3 JB',
        size: 1.08,
        accentColor: '#14b8a6'
    }),
    'handhole-vault': pointSymbol('handhole-vault', 'Vault', {
        category: PROCUREMENT_CATEGORIES.HANDHOLES,
        labelTemplate: 'Vault',
        size: 1.15,
        accentColor: '#64748b'
    }),

    'splice-enclosure': pointSymbol('splice-enclosure', 'Splice enclosure', {
        category: PROCUREMENT_CATEGORIES.SPLICING,
        labelTemplate: '{enclosureType}',
        accentColor: '#8b5cf6'
    }),

    'building-entrance': pointSymbol('building-entrance', 'Building entrance', {
        category: PROCUREMENT_CATEGORIES.BUILDINGS,
        labelTemplate: 'Building entrance',
        accentColor: '#6366f1'
    }),
    'building': pointSymbol('building', 'Building', {
        category: PROCUREMENT_CATEGORIES.BUILDINGS,
        labelTemplate: '{buildingName}',
        size: 1.12,
        accentColor: '#7c3aed',
        isContainer: true
    })
};

/**
 * @param {string} [categoryId]
 * @returns {object[]}
 */
export function getSymbologyItemsByCategory(categoryId) {
    if (!categoryId) return [...PROCUREMENT_SYMBOLOGY_ITEMS];
    return PROCUREMENT_SYMBOLOGY_ITEMS.filter((item) => item.category === categoryId);
}

/**
 * @returns {Array<{ id: string, label: string, items: object[] }>}
 */
export function getSymbologyCatalogGrouped() {
    return Object.values(PROCUREMENT_CATEGORIES).map((categoryId) => ({
        id: categoryId,
        label: PROCUREMENT_CATEGORY_LABELS[categoryId] || categoryId,
        items: getSymbologyItemsByCategory(categoryId)
    }));
}

/**
 * @param {string} symbolKey
 * @returns {object|null}
 */
export function getProcurementSymbologyItem(symbolKey) {
    return PROCUREMENT_SYMBOLOGY_ITEMS.find((item) => item.symbolKey === symbolKey) || null;
}

/**
 * Match a catalog item description/category to a procurement symbol key.
 * @param {object} catalogItem
 * @returns {string|null}
 */
export function resolveSymbolKeyFromCatalogItem(catalogItem = {}) {
    if (catalogItem.defaultSymbolKey) return catalogItem.defaultSymbolKey;

    const haystack = [
        catalogItem.description,
        catalogItem.shortDescription,
        catalogItem.category,
        catalogItem.subcategory,
        catalogItem.productType
    ].filter(Boolean).join(' ');

    if (!haystack.trim()) return null;

    for (const item of PROCUREMENT_SYMBOLOGY_ITEMS) {
        if (item.catalogMatchers?.some((pattern) => pattern.test(haystack))) {
            return item.symbolKey;
        }
    }
    return null;
}

/**
 * Resolve symbol key from conduit diameter string (e.g. "2-inch", "2").
 * @param {string} diameter
 * @returns {string}
 */
export function resolveConduitSymbolKey(diameter = '') {
    const normalized = String(diameter).replace(/[^\d.]/g, '');
    const match = PROCUREMENT_SYMBOLOGY_ITEMS.find(
        (item) => item.category === PROCUREMENT_CATEGORIES.CONDUIT
            && item.symbolKey === `conduit-${normalized}in`
    );
    return match?.symbolKey || 'conduit-2in';
}

/**
 * Resolve symbol key from fiber strand count.
 * @param {number} strandCount
 * @returns {string}
 */
export function resolveFiberSymbolKey(strandCount = 0) {
    const count = Number(strandCount);
    const match = PROCUREMENT_SYMBOLOGY_ITEMS.find(
        (item) => item.category === PROCUREMENT_CATEGORIES.FIBER && item.strandCount === count
    );
    return match?.symbolKey || 'fiber-144ct';
}

/**
 * Resolve handhole symbol key from structure type and size label.
 * @param {string} assetType
 * @param {string} [sizeLabel]
 * @returns {string}
 */
export function resolveHandholeSymbolKey(assetType = '', sizeLabel = '') {
    const text = `${assetType} ${sizeLabel}`.toLowerCase();
    if (/vault/.test(text)) return 'handhole-vault';
    if (/type\s*3|t3/.test(text)) return 'handhole-type-3';
    if (/type\s*2|t2/.test(text)) return 'handhole-type-2';
    if (/type\s*1|t1/.test(text)) return 'handhole-type-1';
    return 'handhole-type-1';
}
