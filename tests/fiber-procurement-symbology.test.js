import { describe, expect, it } from 'vitest';
import {
    PROCUREMENT_CATEGORIES,
    PROCUREMENT_SYMBOLOGY_ITEMS,
    getSymbologyCatalogGrouped,
    getSymbologyItemsByCategory,
    resolveSymbolKeyFromCatalogItem,
    resolveConduitSymbolKey,
    resolveFiberSymbolKey,
    resolveHandholeSymbolKey
} from '../js/widgets/fiber-procurement-design/procurement-symbology.js';
import {
    SYMBOL_REGISTRY,
    getSymbolDefinition,
    getSymbolsByCategory
} from '../js/plan-project/symbology-registry.js';
import { renderProcurementIcon } from '../js/plan-project/symbol-icons.js';

describe('fiber procurement symbology', () => {
    it('defines all five procurement categories', () => {
        const grouped = getSymbologyCatalogGrouped();
        expect(grouped).toHaveLength(5);
        expect(grouped.map((group) => group.id)).toEqual([
            PROCUREMENT_CATEGORIES.CONDUIT,
            PROCUREMENT_CATEGORIES.FIBER,
            PROCUREMENT_CATEGORIES.HANDHOLES,
            PROCUREMENT_CATEGORIES.SPLICING,
            PROCUREMENT_CATEGORIES.BUILDINGS
        ]);
    });

    it('registers a symbol definition for every catalog item', () => {
        for (const item of PROCUREMENT_SYMBOLOGY_ITEMS) {
            expect(getSymbolDefinition(item.symbolKey)).toBeTruthy();
            expect(SYMBOL_REGISTRY[item.symbolKey]).toBeTruthy();
        }
    });

    it('assigns unique symbol keys', () => {
        const keys = PROCUREMENT_SYMBOLOGY_ITEMS.map((item) => item.symbolKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('matches catalog descriptions to conduit and fiber symbols', () => {
        expect(resolveSymbolKeyFromCatalogItem({ description: '2-inch HDPE conduit' }))
            .toBe('conduit-2in');
        expect(resolveSymbolKeyFromCatalogItem({ description: '144-count single-mode fiber cable' }))
            .toBe('fiber-144ct');
        expect(resolveSymbolKeyFromCatalogItem({ description: 'Type 3 junction box' }))
            .toBe('handhole-type-3');
        expect(resolveSymbolKeyFromCatalogItem({ description: 'Splice enclosure' }))
            .toBe('splice-enclosure');
        expect(resolveSymbolKeyFromCatalogItem({ description: 'Building entrance' }))
            .toBe('building-entrance');
    });

    it('resolves helper symbol keys from design attributes', () => {
        expect(resolveConduitSymbolKey('2-inch')).toBe('conduit-2in');
        expect(resolveFiberSymbolKey(48)).toBe('fiber-48ct');
        expect(resolveHandholeSymbolKey('vault', '')).toBe('handhole-vault');
        expect(resolveHandholeSymbolKey('junction_box', 'Type 2')).toBe('handhole-type-2');
    });

    it('groups symbols by category in the registry', () => {
        const conduitSymbols = getSymbolsByCategory(PROCUREMENT_CATEGORIES.CONDUIT);
        expect(Object.keys(conduitSymbols)).toHaveLength(5);
        expect(getSymbologyItemsByCategory(PROCUREMENT_CATEGORIES.FIBER)).toHaveLength(7);
    });

    it('renders custom SVG icons for point symbols', () => {
        const svg = renderProcurementIcon('handhole-type-3');
        expect(svg).toContain('<svg');
        expect(svg).toContain('polygon');
    });
});
