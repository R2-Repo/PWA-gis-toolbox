import { beforeEach, describe, expect, it } from 'vitest';
import { searchAtlas, searchAtlasDetailed } from '../js/atlas/search.js';
import { patchAtlasSnapshot, resetAtlasSnapshot } from '../js/atlas/store.js';

describe('atlas search', () => {
    beforeEach(() => {
        resetAtlasSnapshot();
    });

    it('flags truncation when more than limit matches', () => {
        patchAtlasSnapshot({
            channels: Array.from({ length: 12 }, (_, i) => ({
                id: `c${i}`,
                channelNumber: String(100 + i),
                primaryHubCode: 'H1',
                secondaryHubCode: 'H2'
            })),
            hubs: [],
            drops: [],
            sites: [],
            devices: [],
            pingResults: {}
        });
        const page = searchAtlasDetailed('10', 5);
        expect(page.hits).toHaveLength(5);
        expect(page.truncated).toBe(true);
        expect(searchAtlas('10', 5)).toHaveLength(5);
        expect(searchAtlasDetailed('10', 50).truncated).toBe(false);
    });
});
