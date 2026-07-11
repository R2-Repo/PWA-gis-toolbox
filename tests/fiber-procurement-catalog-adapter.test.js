import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    normalizeProcurementCatalog,
    createSampleProcurementCatalog,
    normalizeCatalogUnit,
    detectCatalogColumns
} from '../js/widgets/fiber-procurement-design/catalog-adapter.js';

describe('fiber procurement catalog adapter', () => {
    beforeEach(() => resetIdSequence());

    it('detects catalog columns from headers', () => {
        const mapping = detectCatalogColumns(['Item', 'Category', 'Description', 'Unit']);
        expect(mapping.contractItemNumber).toBe(0);
        expect(mapping.description).toBe(2);
        expect(mapping.unit).toBe(3);
    });

    it('normalizes catalog units', () => {
        expect(normalizeCatalogUnit('LF')).toBe('linear_feet');
        expect(normalizeCatalogUnit('EA')).toBe('each');
        expect(normalizeCatalogUnit('LS')).toBe('lump_sum');
    });

    it('normalizes spreadsheet rows into catalog items', () => {
        const rows = [
            ['Item', 'Category', 'Description', 'Unit'],
            ['101', 'Construction', 'Directional bore', 'LF'],
            ['201', 'Structures', 'Type 3 junction box', 'EA']
        ];
        const catalog = normalizeProcurementCatalog(rows);
        expect(catalog.items).toHaveLength(2);
        expect(catalog.items[0].description).toBe('Directional bore');
        expect(catalog.items[1].measurementRule).toBe('point_count');
    });

    it('creates a sample procurement catalog', () => {
        const catalog = createSampleProcurementCatalog();
        expect(catalog.items.length).toBeGreaterThan(5);
        expect(catalog.items.some((item) => /fiber/i.test(item.description))).toBe(true);
    });

    it('assigns unique catalog item IDs', () => {
        const catalog = createSampleProcurementCatalog();
        const ids = new Set(catalog.items.map((item) => item.catalogItemId));
        expect(ids.size).toBe(catalog.items.length);
    });
});
