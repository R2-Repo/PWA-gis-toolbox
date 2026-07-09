import { describe, expect, it } from 'vitest';
import { isLayerFeatureDeletable } from '../js/tools/context-menu-gis-tools.js';

describe('context-menu GIS tools', () => {
    it('evaluates feature deletable without throwing for spatial layers', () => {
        expect(isLayerFeatureDeletable({ type: 'spatial' })).toBe(true);
        expect(isLayerFeatureDeletable({ type: 'spatial', storage: 'workspace' })).toBe(false);
        expect(isLayerFeatureDeletable(null)).toBe(false);
    });
});
