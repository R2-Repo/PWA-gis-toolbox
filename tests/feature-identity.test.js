import { describe, expect, it } from 'vitest';
import {
    LGID_PROP,
    createLgid,
    isLgid,
    ensureFeatureLgid,
    isInternalFeatureProp,
    buildDisplayIdentityProps
} from '../js/workspace/feature-identity.js';
import {
    splitHotColdProperties,
    joinHotColdProperties,
    detachFieldsFromHot,
    mergeColdFieldNames
} from '../js/workspace/cold-attributes.js';

describe('feature-identity', () => {
    it('mints unique lgids', () => {
        const a = createLgid();
        const b = createLgid();
        expect(isLgid(a)).toBe(true);
        expect(a).not.toBe(b);
    });

    it('reuses existing __lgid on a feature', () => {
        const feature = { type: 'Feature', properties: { [LGID_PROP]: 'keep-me', name: 'x' } };
        expect(ensureFeatureLgid(feature)).toBe('keep-me');
        expect(ensureFeatureLgid({ properties: {} })).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('builds display identity props including __lgid', () => {
        const props = buildDisplayIdentityProps({
            lgid: 'abc',
            layerId: 'layer1',
            featureIndex: 7,
            properties: { Name: 'Pole' }
        });
        expect(props).toEqual({
            _featureIndex: 7,
            _datasetId: 'layer1',
            _featureId: 'layer1:f:7',
            [LGID_PROP]: 'abc',
            name: 'Pole'
        });
        expect(isInternalFeatureProp(LGID_PROP)).toBe(true);
        expect(isInternalFeatureProp('_featureIndex')).toBe(true);
        expect(isInternalFeatureProp('owner')).toBe(false);
    });
});

describe('cold-attributes', () => {
    it('splits and joins hot/cold properties', () => {
        const { hot, cold } = splitHotColdProperties(
            { a: 1, b: 2, _featureIndex: 0, [LGID_PROP]: 'x' },
            ['b']
        );
        expect(hot).toEqual({ a: 1 });
        expect(cold).toEqual({ b: 2 });
        expect(joinHotColdProperties(hot, cold)).toEqual({ a: 1, b: 2 });
        // hot wins on conflict
        expect(joinHotColdProperties({ a: 9 }, { a: 1, b: 2 })).toEqual({ a: 9, b: 2 });
    });

    it('detaches named fields from hot into cold', () => {
        const { hot, cold, moved } = detachFieldsFromHot(
            { owner: 'A', notes: 'long', height: 30 },
            { archive: 1 },
            ['notes', 'missing']
        );
        expect(moved).toEqual(['notes']);
        expect(hot).toEqual({ owner: 'A', height: 30 });
        expect(cold).toEqual({ archive: 1, notes: 'long' });
        expect(mergeColdFieldNames(['notes'], ['owner', 'notes'])).toEqual(['notes', 'owner']);
    });
});
