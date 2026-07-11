/**
 * Procurement catalog adapter — normalizes spreadsheet rows into catalog items.
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const MEASUREMENT_RULES = {
    ROUTE_LINEAR: 'route_linear',
    REPEATED_LINEAR: 'repeated_linear',
    FIBER_LENGTH: 'fiber_length',
    POINT_COUNT: 'point_count',
    AREA_RESTORATION: 'area_restoration',
    MANUAL: 'manual',
    FORMULA: 'formula'
};

export const SUPPORTED_UNITS = [
    'each',
    'linear_feet',
    'linear_miles',
    'square_feet',
    'square_yards',
    'cubic_yards',
    'hours',
    'days',
    'lump_sum',
    'percentage',
    'manual_quantity'
];

const COLUMN_ALIASES = {
    contractItemNumber: /\b(item|pay item|contract item|item no|item number)\b/i,
    category: /\b(category|group|division)\b/i,
    subcategory: /\b(subcategory|sub category|sub-category)\b/i,
    description: /\b(description|desc|item description)\b/i,
    shortDescription: /\b(short description|short desc|label)\b/i,
    unit: /\b(unit|uom|measure)\b/i,
    productType: /\b(product type|type|product)\b/i,
    installationMethod: /\b(installation|install method|method)\b/i,
    materialSpecification: /\b(material|spec|specification)\b/i
};

/**
 * @param {string[]} headers
 * @returns {Record<string, number>}
 */
export function detectCatalogColumns(headers = []) {
    const mapping = {};
    headers.forEach((header, index) => {
        const text = String(header || '');
        for (const [field, pattern] of Object.entries(COLUMN_ALIASES)) {
            if (mapping[field] != null) continue;
            if (pattern.test(text)) mapping[field] = index;
        }
    });
    return mapping;
}

/**
 * @param {string} unitText
 * @returns {string}
 */
export function normalizeCatalogUnit(unitText = '') {
    const raw = String(unitText || '').trim().toLowerCase();
    if (!raw) return 'each';
    if (/each|ea\b/.test(raw)) return 'each';
    if (/linear foot|linear ft|\blf\b|\bft\b/.test(raw)) return 'linear_feet';
    if (/mile|\bmi\b/.test(raw)) return 'linear_miles';
    if (/square foot|sq\.? ?ft|\bsf\b/.test(raw)) return 'square_feet';
    if (/square yard|sq\.? ?yd|\bsy\b/.test(raw)) return 'square_yards';
    if (/cubic yard|cu\.? ?yd|\bcy\b/.test(raw)) return 'cubic_yards';
    if (/hour|\bhr\b/.test(raw)) return 'hours';
    if (/day/.test(raw)) return 'days';
    if (/lump|ls\b/.test(raw)) return 'lump_sum';
    if (/%|percent/.test(raw)) return 'percentage';
    return 'manual_quantity';
}

/**
 * @param {object} row
 * @param {Record<string, number>} columnMap
 * @param {number} rowIndex
 * @returns {object}
 */
export function normalizeCatalogRow(row, columnMap = {}, rowIndex = 0) {
    const read = (field, fallback = '') => {
        const index = columnMap[field];
        if (index == null) return fallback;
        return row[index] ?? fallback;
    };

    const description = String(read('description', '')).trim();
    const category = String(read('category', '')).trim();
    const unit = normalizeCatalogUnit(read('unit', 'each'));
    const productType = String(read('productType', '')).trim();
    const installationMethod = String(read('installationMethod', '')).trim();

    let measurementRule = MEASUREMENT_RULES.MANUAL;
    if (/conduit|duct|pipe|bore|trench/i.test(description + category)) {
        measurementRule = MEASUREMENT_RULES.REPEATED_LINEAR;
    } else if (/fiber|cable/i.test(description + category)) {
        measurementRule = MEASUREMENT_RULES.FIBER_LENGTH;
    } else if (/junction|vault|handhole|structure|enclosure/i.test(description + category)) {
        measurementRule = MEASUREMENT_RULES.POINT_COUNT;
    } else if (/restoration/i.test(description + category)) {
        measurementRule = MEASUREMENT_RULES.AREA_RESTORATION;
    } else if (/mobil|traffic|permit|testing|management/i.test(description + category)) {
        measurementRule = MEASUREMENT_RULES.MANUAL;
    }

    const catalogItemId = createStableId('cat');

    return {
        catalogItemId,
        contractItemNumber: String(read('contractItemNumber', '')).trim(),
        category: category || 'General',
        subcategory: String(read('subcategory', '')).trim(),
        description: description || `Catalog item ${rowIndex + 1}`,
        shortDescription: String(read('shortDescription', description)).trim() || description,
        unit,
        measurementRule,
        geometryType: measurementRule === MEASUREMENT_RULES.POINT_COUNT ? 'Point' : (
            measurementRule === MEASUREMENT_RULES.AREA_RESTORATION ? 'Polygon' : 'LineString'
        ),
        productType,
        installationMethod,
        materialSpecification: String(read('materialSpecification', '')).trim(),
        defaultSymbolKey: '',
        defaultAttributes: {},
        allowsManualQuantity: measurementRule === MEASUREMENT_RULES.MANUAL,
        requiresRoute: measurementRule !== MEASUREMENT_RULES.MANUAL && measurementRule !== MEASUREMENT_RULES.POINT_COUNT,
        requiresParentAsset: measurementRule === MEASUREMENT_RULES.REPEATED_LINEAR,
        optionalUnitPrice: null,
        vendorBidFields: {},
        sourceSpreadsheetRow: rowIndex + 1,
        active: true,
        notes: ''
    };
}

/**
 * @param {Array<string[]>} rows
 * @returns {{ catalogId: string, version: string, items: object[], warnings: string[] }}
 */
export function normalizeProcurementCatalog(rows = []) {
    if (!rows.length) {
        return { catalogId: createStableId('catalog'), version: '1', items: [], warnings: ['Catalog is empty.'] };
    }

    const [headerRow, ...dataRows] = rows;
    const columnMap = detectCatalogColumns(headerRow);
    const items = dataRows
        .filter((row) => row?.some((cell) => String(cell ?? '').trim()))
        .map((row, index) => normalizeCatalogRow(row, columnMap, index + 1));

    const warnings = [];
    const seenIds = new Set();
    for (const item of items) {
        if (seenIds.has(item.catalogItemId)) {
            warnings.push(`Duplicate catalog item ID ${item.catalogItemId}.`);
        }
        seenIds.add(item.catalogItemId);
    }

    return {
        catalogId: createStableId('catalog'),
        version: '1',
        items,
        warnings
    };
}

/**
 * Sample catalog for Phase 1 smoke tests.
 * @returns {{ catalogId: string, version: string, items: object[] }}
 */
export function createSampleProcurementCatalog() {
    const rows = [
        ['Item', 'Category', 'Description', 'Unit', 'Product Type', 'Installation Method'],
        ['101', 'Construction', 'Directional bore', 'LF', '', 'Directional Bore'],
        ['102', 'Conduit', '2-inch HDPE conduit', 'LF', 'HDPE', ''],
        ['103', 'Conduit', 'Tracer wire', 'LF', 'Tracer Wire', ''],
        ['104', 'Conduit', 'Pull tape', 'LF', 'Pull Tape', ''],
        ['201', 'Structures', 'Type 3 junction box', 'EA', 'Junction Box', ''],
        ['202', 'Structures', 'Type 4 vault', 'EA', 'Vault', ''],
        ['301', 'Fiber', '144-count single-mode fiber cable', 'LF', 'SM Fiber', ''],
        ['302', 'Fiber', '12-count building drop', 'LF', 'SM Fiber', ''],
        ['401', 'Splicing', 'Fusion splice', 'EA', '', ''],
        ['501', 'General', 'Mobilization', 'LS', '', '']
    ];
    const normalized = normalizeProcurementCatalog(rows);
    return {
        catalogId: normalized.catalogId,
        version: normalized.version,
        items: normalized.items,
        warnings: normalized.warnings
    };
}

/**
 * @param {object[]} items
 * @param {string} catalogItemId
 * @returns {object|null}
 */
export function findCatalogItem(items, catalogItemId) {
    return (items || []).find((item) => item.catalogItemId === catalogItemId) || null;
}
