import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import shp from 'shpjs';
import proj4 from 'proj4';
import {
    readZipEntries,
    openZipEntryStream,
    isRealZipEntry
} from '../js/import/stream/zip-central-directory.js';
import { streamShapefileFeatures, buildPrjTransform, prjIsWgs84 } from '../js/import/stream/shapefile-stream.js';
import { writeShp, writeDbf } from './helpers/shp-writer.js';

const UTM12_WKT = 'PROJCS["NAD_1983_UTM_Zone_12N",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-111.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const WGS84_WKT = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

async function makeShapefileZip({ shapes, rows = null, fields = null, prj = null, cpg = null, base = 'layer' }) {
    const zip = new JSZip();
    zip.file(`${base}.shp`, writeShp(shapes));
    if (rows && fields) zip.file(`${base}.dbf`, writeDbf(rows, fields));
    if (prj) zip.file(`${base}.prj`, prj);
    if (cpg) zip.file(`${base}.cpg`, cpg);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new File([bytes], `${base}.zip`, { type: 'application/zip' });
}

async function streamZip(file) {
    const entries = await readZipEntries(file);
    const real = entries.filter(isRealZipEntry);
    const shpEntry = real.find((e) => e.name.toLowerCase().endsWith('.shp'));
    const dbfEntry = real.find((e) => e.name.toLowerCase().endsWith('.dbf')) || null;
    const prjEntry = real.find((e) => e.name.toLowerCase().endsWith('.prj')) || null;

    let prjWkt = null;
    if (prjEntry) {
        const stream = await openZipEntryStream(file, prjEntry);
        const reader = stream.getReader();
        const { value } = await reader.read();
        prjWkt = new TextDecoder().decode(value);
        await reader.cancel();
    }

    const source = streamShapefileFeatures({
        shpStream: await openZipEntryStream(file, shpEntry),
        dbfStream: dbfEntry ? await openZipEntryStream(file, dbfEntry) : null,
        prjWkt,
        proj4Lib: proj4
    });
    const features = [];
    for await (const f of source.features) features.push(f);
    return { features, warnings: source.warnings };
}

// Shapefiles are homogeneous — one geometry type per file (plus null shapes).
const POINT_SHAPES = [
    { type: 'Point', points: [[425000, 4510000]] },
    { type: 'Point', points: [[426500, 4512000]] },
    null,
    { type: 'Point', points: [[428000, 4508000]] }
];

const LINE_SHAPES = [
    { type: 'PolyLine', parts: [[[425000, 4510000], [425500, 4510500], [426000, 4510200]]] },
    { type: 'PolyLine', parts: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }
];

// Spec winding: outer clockwise, hole counter-clockwise.
const POLY_SHAPES = [
    {
        type: 'Polygon',
        parts: [
            [[430000, 4500000], [430000, 4501000], [431000, 4501000], [431000, 4500000], [430000, 4500000]],
            [[430200, 4500200], [430800, 4500200], [430800, 4500800], [430200, 4500800], [430200, 4500200]]
        ]
    }
];

const FIELDS = [
    { name: 'ASSET', type: 'C', length: 16 },
    { name: 'SIZE_IN', type: 'N', length: 8, decimal: 1 },
    { name: 'LIVE', type: 'L', length: 1 }
];
// Fully-populated rows — shpjs maps EMPTY numeric/logical cells to NaN/false
// where the streaming parser deliberately uses null (covered in the dbf unit
// tests), so the parity fixture avoids empty cells.
const POINT_ROWS = [
    { ASSET: 'Hydrant-1', SIZE_IN: 6, LIVE: true },
    { ASSET: 'Main-A', SIZE_IN: 12.5, LIVE: true },
    { ASSET: 'Ghost', SIZE_IN: 1, LIVE: false },
    { ASSET: 'Zone-3', SIZE_IN: 99, LIVE: false }
];

/** shpjs adds optional GeoJSON bbox members — strip for structural parity. */
function stripBbox(geometry) {
    if (!geometry) return geometry;
    const { bbox: _bbox, ...rest } = geometry;
    return rest;
}

describe('shapefile streaming vs shpjs reference', () => {
    it('matches shpjs output for points with attributes', async () => {
        const file = await makeShapefileZip({ shapes: POINT_SHAPES, rows: POINT_ROWS, fields: FIELDS });
        const { features } = await streamZip(file);

        const reference = await shp(await file.arrayBuffer());
        expect(features).toHaveLength(reference.features.length);
        for (let i = 0; i < features.length; i++) {
            expect(features[i].geometry).toEqual(stripBbox(reference.features[i].geometry));
            expect(features[i].properties).toEqual(reference.features[i].properties);
        }
    });

    it('matches shpjs output for multi-part polylines', async () => {
        const file = await makeShapefileZip({ shapes: LINE_SHAPES });
        const { features } = await streamZip(file);
        const reference = await shp(await file.arrayBuffer());
        expect(features).toHaveLength(reference.features.length);
        for (let i = 0; i < features.length; i++) {
            expect(features[i].geometry).toEqual(stripBbox(reference.features[i].geometry));
        }
    });

    it('matches shpjs output for a polygon with a hole', async () => {
        const file = await makeShapefileZip({ shapes: POLY_SHAPES });
        const { features } = await streamZip(file);
        const reference = await shp(await file.arrayBuffer());
        expect(features).toHaveLength(1);
        expect(features[0].geometry).toEqual(stripBbox(reference.features[0].geometry));
        expect(features[0].geometry.coordinates).toHaveLength(2);
    });

    it('reprojects via .prj within tolerance of shpjs', async () => {
        const file = await makeShapefileZip({ shapes: POINT_SHAPES, rows: POINT_ROWS, fields: FIELDS, prj: UTM12_WKT });
        const { features, warnings } = await streamZip(file);
        expect(warnings).toHaveLength(0);

        const reference = await shp(await file.arrayBuffer());
        expect(features).toHaveLength(reference.features.length);
        for (let i = 0; i < features.length; i++) {
            if (!features[i].geometry) {
                expect(reference.features[i].geometry).toBeNull();
                continue;
            }
            const [lonA, latA] = features[i].geometry.coordinates;
            const [lonB, latB] = reference.features[i].geometry.coordinates;
            expect(Math.abs(lonA - lonB)).toBeLessThan(1e-6);
            expect(Math.abs(latA - latB)).toBeLessThan(1e-6);
        }
        // Sanity: coordinates actually became lon/lat near Utah.
        const [lon, lat] = features[0].geometry.coordinates;
        expect(lon).toBeGreaterThan(-113);
        expect(lon).toBeLessThan(-110);
        expect(lat).toBeGreaterThan(40);
        expect(lat).toBeLessThan(42);
    });

    it('imports without attributes when no .dbf is present', async () => {
        const file = await makeShapefileZip({ shapes: [POINT_SHAPES[0]] });
        const { features } = await streamZip(file);
        expect(features).toHaveLength(1);
        expect(features[0].properties).toEqual({});
        expect(features[0].geometry.type).toBe('Point');
    });

    it('recovers holes from wrong-winding polygons via containment', async () => {
        // Both rings counter-clockwise (non-spec writer) — the inner ring must
        // still become a hole, not a second polygon.
        const wrongWinding = [{
            type: 'Polygon',
            parts: [
                [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]
            ]
        }];
        const file = await makeShapefileZip({ shapes: wrongWinding });
        const { features } = await streamZip(file);
        expect(features).toHaveLength(1);
        expect(features[0].geometry.type).toBe('Polygon');
        expect(features[0].geometry.coordinates).toHaveLength(2);
    });
});

describe('buildPrjTransform', () => {
    it('skips transform for WGS84 .prj', () => {
        expect(prjIsWgs84(WGS84_WKT)).toBe(true);
        const { transform, warning } = buildPrjTransform(WGS84_WKT, proj4);
        expect(transform).toBeNull();
        expect(warning).toBeNull();
    });

    it('builds a working transform for projected WKT', () => {
        const { transform, warning } = buildPrjTransform(UTM12_WKT, proj4);
        expect(warning).toBeNull();
        const [lon, lat] = transform([425000, 4510000]);
        expect(lon).toBeCloseTo(-111.88, 1);
        expect(lat).toBeCloseTo(40.73, 1);
    });

    it('degrades gracefully for unparseable WKT', () => {
        const { transform, warning } = buildPrjTransform('PROJCS["garbage', proj4);
        expect(transform).toBeNull();
        expect(warning).toMatch(/could not be parsed/i);
    });
});
