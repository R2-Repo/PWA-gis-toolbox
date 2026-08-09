import { describe, expect, it } from 'vitest';
import { KmlPlacemarkStreamParser } from '../js/import/stream/kml-stream-parser.js';

function scan(text, chunkSize = null) {
    const placemarks = [];
    const shared = [];
    const parser = new KmlPlacemarkStreamParser({
        onPlacemark: (t) => placemarks.push(t),
        onSharedBlock: (kind, id, t) => shared.push({ kind, id, text: t })
    });
    if (chunkSize == null) {
        parser.push(text);
    } else {
        for (let i = 0; i < text.length; i += chunkSize) {
            parser.push(text.slice(i, i + chunkSize));
        }
    }
    const result = parser.finish();
    return { placemarks, shared, result, parser };
}

const PM = (name, extra = '') =>
    `<Placemark><name>${name}</name>${extra}<Point><coordinates>-111.9,40.7,0</coordinates></Point></Placemark>`;

const BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Doc</name>
  ${PM('One')}
  <Folder><name>F1</name>${PM('Two')}${PM('Three')}</Folder>
</Document>
</kml>`;

describe('KmlPlacemarkStreamParser', () => {
    it('extracts all placemark blocks', () => {
        const { placemarks, result } = scan(BASIC);
        expect(result.placemarkCount).toBe(3);
        expect(placemarks[0]).toContain('<name>One</name>');
        expect(placemarks[1]).toContain('<name>Two</name>');
        expect(placemarks[2]).toContain('<name>Three</name>');
    });

    it.each([1, 3, 7, 16, 64, 501])('is chunk-boundary safe (chunk %d)', (size) => {
        const single = scan(BASIC);
        const chunked = scan(BASIC, size);
        expect(chunked.placemarks).toEqual(single.placemarks);
        expect(chunked.parser.rootTag).toEqual(single.parser.rootTag);
    });

    it('captures the root kml tag with namespaces', () => {
        const { parser } = scan(BASIC);
        expect(parser.rootTag).toContain('xmlns="http://www.opengis.net/kml/2.2"');
        expect(parser.rootTag).toContain('xmlns:gx=');
    });

    it('survives CDATA containing closing tags', () => {
        const text = `<kml><Document><Placemark><name>A</name><description><![CDATA[
            evil </Placemark> text <Placemark> and more
        ]]></description><Point><coordinates>1,2</coordinates></Point></Placemark>${PM('B')}</Document></kml>`;
        for (const size of [null, 5, 13]) {
            const { placemarks } = scan(text, size);
            expect(placemarks).toHaveLength(2);
            expect(placemarks[0]).toContain('evil </Placemark> text');
            expect(placemarks[1]).toContain('<name>B</name>');
        }
    });

    it('ignores placemarks inside XML comments', () => {
        const text = `<kml><Document><!-- ${PM('Commented')} -->${PM('Real')}</Document></kml>`;
        const { placemarks } = scan(text, 4);
        expect(placemarks).toHaveLength(1);
        expect(placemarks[0]).toContain('<name>Real</name>');
    });

    it('handles attribute values containing ">"', () => {
        const text = `<kml><Document><Placemark id="a>b"><name>X</name></Placemark></Document></kml>`;
        const { placemarks } = scan(text, 3);
        expect(placemarks).toHaveLength(1);
        expect(placemarks[0]).toContain('id="a>b"');
    });

    it('collects shared Style / StyleMap / Schema blocks with ids', () => {
        const text = `<kml><Document>
            <Style id="s1"><LineStyle><color>ff0000ff</color></LineStyle></Style>
            <StyleMap id="m1"><Pair><key>normal</key><styleUrl>#s1</styleUrl></Pair></StyleMap>
            <Schema id="sch" name="sch"><SimpleField name="depth" type="float"/></Schema>
            ${PM('P', '<styleUrl>#m1</styleUrl>')}
        </Document></kml>`;
        const { shared, placemarks } = scan(text, 11);
        expect(placemarks).toHaveLength(1);
        const kinds = shared.map((s) => `${s.kind}#${s.id}`).sort();
        expect(kinds).toEqual(['Schema#sch', 'Style#s1', 'StyleMap#m1']);
        // Inline styles inside placemarks are not emitted as shared blocks.
        expect(shared.every((s) => !s.text.includes('<Placemark'))).toBe(true);
    });

    it('does not emit Style blocks nested inside StyleMap or Placemark separately', () => {
        const text = `<kml><Document>
            <StyleMap id="m"><Pair><Style><IconStyle/></Style></Pair></StyleMap>
            <Placemark><Style><LineStyle/></Style><name>Inline</name></Placemark>
        </Document></kml>`;
        const { shared, placemarks } = scan(text, 6);
        expect(shared).toHaveLength(1);
        expect(shared[0].kind).toBe('StyleMap');
        expect(placemarks).toHaveLength(1);
        expect(placemarks[0]).toContain('<Style>');
    });

    it('handles self-closing placemarks', () => {
        const { placemarks } = scan('<kml><Document><Placemark/></Document></kml>');
        expect(placemarks).toEqual(['<Placemark/>']);
    });

    it('handles namespace-prefixed elements', () => {
        const text = `<x:kml xmlns:x="http://www.opengis.net/kml/2.2"><x:Document><x:Placemark><x:name>N</x:name></x:Placemark></x:Document></x:kml>`;
        const { placemarks, parser } = scan(text, 5);
        expect(placemarks).toHaveLength(1);
        expect(parser.rootTag).toContain('x:kml');
    });

    it('throws on truncated capture at finish', () => {
        const parser = new KmlPlacemarkStreamParser({ onPlacemark: () => {} });
        parser.push('<kml><Document><Placemark><name>cut off');
        expect(() => parser.finish()).toThrow(/truncated/i);
    });

    it('enforces the block size cap', () => {
        const parser = new KmlPlacemarkStreamParser({ onPlacemark: () => {}, maxBlockChars: 64 });
        expect(() => {
            parser.push(`<kml><Placemark><name>${'x'.repeat(200)}</name></Placemark></kml>`);
        }).toThrow(/maximum supported size/i);
    });

    it('handles a large document with many placemarks', () => {
        let body = '';
        for (let i = 0; i < 2000; i++) body += PM(`p${i}`);
        const text = `<kml><Document>${body}</Document></kml>`;
        const { placemarks } = scan(text, 4096);
        expect(placemarks).toHaveLength(2000);
        expect(placemarks[1999]).toContain('<name>p1999</name>');
    });
});
