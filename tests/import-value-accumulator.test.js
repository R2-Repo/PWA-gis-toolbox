// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    createValueAccumulator,
    extractKmlPlacemarkProperties
} from '../js/import/import-value-accumulator.js';

describe('import-value-accumulator', () => {
    it('caps distinct values and marks truncated', () => {
        const acc = createValueAccumulator(3);
        acc.ensureFields(['kind']);
        for (const v of ['a', 'b', 'c', 'd', 'e']) {
            acc.addProperties({ kind: v }, ['kind']);
        }
        const built = acc.build();
        expect(built.rowCount).toBe(5);
        expect(built.fields[0].values).toHaveLength(3);
        expect(built.fields[0].truncated).toBe(true);
    });

    it('extracts KML placemark properties without a DOM', () => {
        const props = extractKmlPlacemarkProperties(`
            <Placemark>
              <name>Main St</name>
              <ExtendedData>
                <SimpleData name="kind">Freeway</SimpleData>
                <Data name="lane"><value>2</value></Data>
              </ExtendedData>
            </Placemark>
        `);
        expect(props.name).toBe('Main St');
        expect(props.kind).toBe('Freeway');
        expect(props.lane).toBe('2');
    });
});
