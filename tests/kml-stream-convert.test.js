import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import toGeoJSON from '@mapbox/togeojson';
import { createKmlBlockConverter } from '../js/import/stream/kml-stream-convert.js';
import { parseKmlText } from '../js/import/parsers/parse-kml.js';

const DEPS = { DOMParserImpl: DOMParser, toGeoJsonLib: toGeoJSON };

const PLACEMARK = `<Placemark>
    <name>Manhole 12</name>
    <description><![CDATA[<b>big html</b>]]></description>
    <styleUrl>#m1</styleUrl>
    <ExtendedData><Data name="depth"><value>3.4</value></Data></ExtendedData>
    <Point><coordinates>-111.91,40.76,0</coordinates></Point>
</Placemark>`;

const STYLE = '<Style id="s1"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>';
const STYLEMAP = '<StyleMap id="m1"><Pair><key>normal</key><styleUrl>#s1</styleUrl></Pair></StyleMap>';

describe('createKmlBlockConverter', () => {
    it('produces the same core output as the full-document parser', () => {
        const fullDoc = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${PLACEMARK}</Document></kml>`;
        const reference = parseKmlText(fullDoc, DEPS).geojson.features;

        const converter = createKmlBlockConverter({ ...DEPS, importMode: 'preserve' });
        const { features, failed } = converter.convert([PLACEMARK]);

        expect(failed).toBe(0);
        expect(features).toHaveLength(reference.length);
        expect(features[0].geometry).toEqual(reference[0].geometry);
        expect(features[0].properties.name).toBe('Manhole 12');
        expect(features[0].properties.depth).toBe(reference[0].properties.depth);
    });

    it('gis mode strips presentation properties', () => {
        const converter = createKmlBlockConverter({ ...DEPS, importMode: 'gis' });
        const { features } = converter.convert([PLACEMARK]);
        expect(features).toHaveLength(1);
        expect(features[0].properties.name).toBe('Manhole 12');
        expect(features[0].properties.depth).toBeDefined();
        expect(features[0].properties.description).toBeUndefined();
        expect(features[0].properties.styleUrl).toBeUndefined();
    });

    it('preserve mode resolves shared styles referenced via styleUrl/StyleMap', () => {
        const converter = createKmlBlockConverter({ ...DEPS, importMode: 'preserve' });
        converter.addShared('Style', 's1', STYLE);
        converter.addShared('StyleMap', 'm1', STYLEMAP);
        const { features } = converter.convert([PLACEMARK]);
        expect(features).toHaveLength(1);
        expect(features[0].properties.styleUrl).toBe('#m1');
        // toGeoJSON resolves the style chain into stroke properties.
        expect(features[0].properties.stroke).toBeDefined();
    });

    it('uses the original root tag namespaces when provided', () => {
        const converter = createKmlBlockConverter({
            ...DEPS,
            importMode: 'gis',
            rootTag: '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">'
        });
        const block = `<Placemark><name>T</name><gx:Track><when>2020-01-01T00:00:00Z</when><gx:coord>-111.9 40.7 0</gx:coord></gx:Track></Placemark>`;
        const { features, failed } = converter.convert([block]);
        expect(failed).toBe(0);
        expect(features.length).toBeGreaterThanOrEqual(1);
    });

    it('converts batches of many placemarks in one pass', () => {
        const blocks = [];
        for (let i = 0; i < 120; i++) {
            blocks.push(`<Placemark><name>p${i}</name><Point><coordinates>${-112 + i / 1000},40.5</coordinates></Point></Placemark>`);
        }
        const converter = createKmlBlockConverter({ ...DEPS, importMode: 'gis' });
        const { features, failed } = converter.convert(blocks);
        expect(failed).toBe(0);
        expect(features).toHaveLength(120);
        expect(features[119].properties.name).toBe('p119');
    });

    it('skips broken placemarks without losing the rest of the batch', () => {
        const good = '<Placemark><name>ok</name><Point><coordinates>1,2</coordinates></Point></Placemark>';
        const broken = '<Placemark><name>bad</name><Point><coordinates>1,2</coordinates></Point>';
        const converter = createKmlBlockConverter({ ...DEPS, importMode: 'gis' });
        const { features, failed } = converter.convert([good, broken, good]);
        expect(failed).toBe(1);
        expect(features).toHaveLength(2);
    });
});
