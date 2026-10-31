#!/usr/bin/env node
/**
 * Deterministic local fixture generator for GIS e2e import tests.
 * Usage: node scripts/gen-e2e-fixtures.mjs [--force]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as turf from '@turf/turf';
import XLSX from 'xlsx';
import {
    buildProjectKitSnapshot,
    packProjectKit
} from '../js/core/project-kit.js';
import { parseGpxForImport } from '../js/import/import-parse-service.js';
import { writeShp, writeDbf } from '../tests/helpers/shp-writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tests/fixtures/e2e/tune');

/** @type {object[]} */
const manifestFixtures = [];

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rand = mulberry32(0x6e2e0001);

function pickCount(tier) {
    return tier === 'T0' ? 12 + Math.floor(rand() * 5) : 1000;
}

function makeProperties(i, tier) {
    return {
        id: i,
        name: `site-${tier}-${i}`,
        unicode: i === 0 ? '测试 τῆμος' : `val-${i}`
    };
}

function makePointFeatures(tier) {
    const n = pickCount(tier);
    /** @type {import('geojson').Feature[]} */
    const features = [];
    for (let i = 0; i < n; i++) {
        const lon = -112 + rand() * 2;
        const lat = 39 + rand() * 2;
        features.push({
            type: 'Feature',
            properties: makeProperties(i, tier),
            geometry: { type: 'Point', coordinates: [lon, lat] }
        });
    }
    return features;
}

function fcMeta(features, extra = {}) {
    const fc = { type: 'FeatureCollection', features };
    const bbox = turf.bbox(fc);
    const types = [...new Set(features.map((f) => f.geometry?.type).filter(Boolean))];
    /** @type {Record<string, string>} */
    const fields = { id: 'number', name: 'string' };
    if (extra.includeUnicode !== false) {
        fields.unicode = 'string';
    }
    return {
        featureCount: features.length,
        bbox,
        geometryTypes: types,
        fields,
        crs: 'EPSG:4326',
        ...extra
    };
}

function addFixture(entry) {
    manifestFixtures.push(entry);
}

async function writeJson(name, obj) {
    const file = path.join(OUT_DIR, name);
    await fs.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    return file;
}

async function writeText(name, text) {
    const file = path.join(OUT_DIR, name);
    await fs.writeFile(file, text, 'utf8');
    return file;
}

async function writeGeojsonTier(tier) {
    const features = makePointFeatures(tier);
    const name = `${tier.toLowerCase()}-geojson-fc.geojson`;
    await writeJson(name, { type: 'FeatureCollection', features });
    addFixture({
        id: `${tier}-geojson-fc`,
        file: name,
        format: 'geojson',
        tier,
        tag: '@tune',
        expectedOutcome: 'success',
        ...fcMeta(features)
    });
    return features;
}

async function writeJsonVariants(tier) {
    const features = makePointFeatures(tier);
    const rows = features.map((f, i) => ({
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        id: i,
        name: f.properties.name,
        unicode: f.properties.unicode
    }));
    const arrayName = `${tier.toLowerCase()}-json-array.json`;
    await writeJson(arrayName, rows);
    addFixture({
        id: `${tier}-json-array`,
        file: arrayName,
        format: 'json',
        tier,
        tag: '@tune',
        expectedOutcome: 'success',
        ...fcMeta(features)
    });

    const esri = {
        features: features.map((f, i) => ({
            geometry: { x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] },
            attributes: { ...f.properties, OBJECTID: i + 1 }
        }))
    };
    const esriName = `${tier.toLowerCase()}-json-esri.json`;
    await writeJson(esriName, esri);
    addFixture({
        id: `${tier}-json-esri`,
        file: esriName,
        format: 'json-esri',
        tier,
        tag: '@tune',
        expectedOutcome: 'success',
        ...fcMeta(features)
    });
}

async function writeDelimited(tier, ext, variant, rows, meta) {
    const name = `${tier.toLowerCase()}-${ext}-${variant}.${ext}`;
    await writeText(name, rows);
    addFixture({
        id: `${tier}-${ext}-${variant}`,
        file: name,
        format: ext,
        tier,
        tag: '@tune',
        expectedOutcome: meta.expectedOutcome || 'success',
        ...meta
    });
}

function rowsToCsv(rows, sep = ',') {
    const headers = Object.keys(rows[0]);
    const escape = (v) => {
        const s = String(v ?? '');
        if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    return [headers.join(sep), ...rows.map((r) => headers.map((h) => escape(r[h])).join(sep))].join('\n');
}

async function writeTableFormats(tier) {
    const features = makePointFeatures(tier);
    const latlonRows = features.map((f, i) => ({
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
        id: i,
        name: f.properties.name,
        unicode: f.properties.unicode
    }));
    const meta = fcMeta(features);
    await writeDelimited(tier, 'csv', 'latlon', rowsToCsv(latlonRows), meta);
    await writeDelimited(tier, 'tsv', 'latlon', rowsToCsv(latlonRows, '\t'), meta);
    await writeDelimited(tier, 'txt', 'latlon', rowsToCsv(latlonRows), meta);

    if (tier === 'T0') {
        const utmRows = features.map((f, i) => {
            const easting = 500000 + i * 15;
            const northing = 4400000 + i * 15;
            return { easting, northing, id: i, name: f.properties.name };
        });
        await writeDelimited(tier, 'csv', 'utm-epsg26912', rowsToCsv(utmRows), {
            ...fcMeta(features, { includeUnicode: false }),
            crs: 'EPSG:26912',
            crsPick: 'EPSG:26912',
            skipBbox: true
        });

        const bomQuoted = `\ufefflatitude,longitude,name,note\n40.7608,-111.891,"Site, A",ok\n40.7610,-111.890,"Site B","quote "" inner"""`;
        await writeDelimited(tier, 'csv', 'bom-quoted', bomQuoted, {
            featureCount: 2,
            bbox: [-111.891, 40.7608, -111.89, 40.761],
            geometryTypes: ['Point'],
            fields: { name: 'string', note: 'string' },
            crs: 'EPSG:4326',
            allowMissingFields: true,
            skipBbox: true
        });

        const wktRows = features.slice(0, 3).map((f, i) => ({
            id: i,
            WKT: `POINT (${f.geometry.coordinates[0]} ${f.geometry.coordinates[1]})`
        }));
        await writeDelimited(tier, 'csv', 'wkt-column', rowsToCsv(wktRows), {
            expectedOutcome: 'success',
            featureCount: 0,
            geometryTypes: [],
            fields: { WKT: 'string' },
            crs: 'EPSG:4326',
            notes: 'WKT-only CSV imports as non-spatial table (0 map features)'
        });
    }

    if (tier === 'T1') {
        const utmRows = features.slice(0, 50).map((f, i) => {
            const easting = 500000 + i * 10;
            const northing = 4400000 + i * 10;
            return { easting, northing, id: i, name: f.properties.name };
        });
        await writeDelimited(tier, 'csv', 'utm-epsg26912', rowsToCsv(utmRows), {
            ...fcMeta(features.slice(0, 50), { includeUnicode: false }),
            featureCount: 50,
            crs: 'EPSG:26912',
            crsPick: 'EPSG:26912',
            skipBbox: true
        });
    }
}

async function writeExcel(tier) {
    const features = makePointFeatures(tier);
    const rows = features.map((f, i) => ({
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        id: i,
        name: f.properties.name,
        unicode: f.properties.unicode
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'data');
    const xlsxName = `${tier.toLowerCase()}-points.xlsx`;
    XLSX.writeFile(wb, path.join(OUT_DIR, xlsxName));
    const xlsName = `${tier.toLowerCase()}-points.xls`;
    XLSX.writeFile(wb, path.join(OUT_DIR, xlsName), { bookType: 'xls' });
    const meta = fcMeta(features);
    addFixture({ id: `${tier}-xlsx`, file: xlsxName, format: 'xlsx', tier, tag: '@tune', expectedOutcome: 'success', ...meta });
    addFixture({ id: `${tier}-xls`, file: xlsName, format: 'xls', tier, tag: '@tune', expectedOutcome: 'success', ...meta });
}

function buildKml(features, tier) {
    const placemarks = features
        .map(
            (f, i) => `<Placemark>
  <name>${f.properties.name}</name>
  <ExtendedData><Data name="id"><value>${i}</value></Data><Data name="unicode"><value>${f.properties.unicode || ''}</value></Data></ExtendedData>
  <MultiGeometry>
    <Point><coordinates>${f.geometry.coordinates[0]},${f.geometry.coordinates[1]},0</coordinates></Point>
  </MultiGeometry>
</Placemark>`
        )
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${tier} tune</name>
    <Folder><name>folder-a</name>${placemarks}</Folder>
  </Document>
</kml>`;
}

async function writeKmlFormats(tier) {
    const features = makePointFeatures(tier);
    const kml = buildKml(features, tier);
    const kmlName = `${tier.toLowerCase()}-folder-multigeom.kml`;
    await writeText(kmlName, kml);
    addFixture({
        id: `${tier}-kml`,
        file: kmlName,
        format: 'kml',
        tier,
        tag: '@tune',
        expectedOutcome: 'success',
        ...fcMeta(features)
    });

    const zip = new JSZip();
    zip.file('doc.kml', kml);
    const kmzName = `${tier.toLowerCase()}-folder.kmz`;
    await fs.writeFile(path.join(OUT_DIR, kmzName), await zip.generateAsync({ type: 'nodebuffer' }));
    addFixture({
        id: `${tier}-kmz`,
        file: kmzName,
        format: 'kmz',
        tier,
        tag: '@tune',
        expectedOutcome: 'success',
        ...fcMeta(features)
    });

    if (tier === 'T0') {
        const disguised = `${tier.toLowerCase()}-kmz-as.zip`;
        await fs.copyFile(path.join(OUT_DIR, kmzName), path.join(OUT_DIR, disguised));
        addFixture({
            id: `${tier}-kmz-zip-disguised`,
            file: disguised,
            format: 'kmz',
            tier,
            tag: '@tune',
            expectedOutcome: 'success',
            ...fcMeta(features)
        });
    }
}

function buildGpx(features) {
    const wpts = features
        .slice(0, 3)
        .map(
            (f) =>
                `<wpt lat="${f.geometry.coordinates[1]}" lon="${f.geometry.coordinates[0]}"><name>${f.properties.name}</name></wpt>`
        )
        .join('');
    const trk = `<trk><name>track</name><trkseg>${features
        .slice(0, 5)
        .map(
            (f) =>
                `<trkpt lat="${f.geometry.coordinates[1]}" lon="${f.geometry.coordinates[0]}"></trkpt>`
        )
        .join('')}</trkseg></trk>`;
    const rte = `<rte><name>route</name>${features
        .slice(0, 4)
        .map(
            (f) =>
                `<rtept lat="${f.geometry.coordinates[1]}" lon="${f.geometry.coordinates[0]}"></rtept>`
        )
        .join('')}</rte>`;
    return `<?xml version="1.0"?><gpx version="1.1"><metadata><name>tune</name></metadata>${wpts}${trk}${rte}</gpx>`;
}

async function writeGpx(tier) {
    const features = makePointFeatures(tier);
    const name = `${tier.toLowerCase()}-wpt-trk-rte.gpx`;
    const text = buildGpx(features);
    await writeText(name, text);
    const { geojson } = await parseGpxForImport(text, text.length);
    addFixture({
        id: `${tier}-gpx`,
        file: name,
        format: 'gpx',
        tier,
        tag: '@tune',
        expectedOutcome: 'success',
        featureCount: tier === 'T0' ? 3 : 3,
        geometryTypes: ['Point', 'LineString'],
        fields: { id: 'number', name: 'string' },
        crs: 'EPSG:4326',
        skipBbox: true,
        notes: 'GPX fixture includes wpt/trk/rte; app materializes 3 features for T0 file'
    });
}

const DBF_FIELDS = [
    { name: 'id', type: 'N', length: 10, decimal: 0 },
    { name: 'name', type: 'C', length: 40 }
];

async function writeShapefileZip(name, shapes, attrs, prjWkt, meta) {
    const shp = writeShp(shapes);
    const dbf = writeDbf(attrs, DBF_FIELDS);
    const zip = new JSZip();
    zip.file('layer.shp', shp);
    zip.file('layer.dbf', dbf);
    if (prjWkt) zip.file('layer.prj', prjWkt);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.writeFile(path.join(OUT_DIR, name), buf);
    addFixture({
        id: meta.id,
        file: name,
        format: 'shapefile',
        tier: meta.tier,
        tag: '@tune',
        expectedOutcome: meta.expectedOutcome || 'success',
        featureCount: meta.featureCount,
        bbox: meta.bbox,
        geometryTypes: meta.geometryTypes,
        fields: meta.fields || { id: 'number', name: 'string' },
        crs: meta.crs,
        crsPick: meta.crsPick || null,
        notes: meta.notes,
        skipBbox: meta.skipBbox || false,
        knownBug: meta.knownBug || null
    });
}

async function writeShapefiles(tier) {
    const features = makePointFeatures(tier);
    const shapes = features.map((f) => ({
        type: 'Point',
        points: [[f.geometry.coordinates[0], f.geometry.coordinates[1]]]
    }));
    const attrs = features.map((f, i) => ({ id: i, name: f.properties.name }));
    const meta = fcMeta(features);
    await writeShapefileZip(
        `${tier.toLowerCase()}-points-wgs84.zip`,
        shapes,
        attrs,
        'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]',
        { ...meta, id: `${tier}-shp-wgs84`, tier, fields: { id: 'number', name: 'string' } }
    );

    if (tier === 'T0') {
        const utmShapes = features.slice(0, 8).map((f) => {
            const easting = 500000 + f.properties.id * 10;
            const northing = 4400000 + f.properties.id * 10;
            return { type: 'Point', points: [[easting, northing]] };
        });
        const utmAttrs = attrs.slice(0, 8);
        await writeShapefileZip(
            't0-points-utm26912.zip',
            utmShapes,
            utmAttrs,
            'PROJCS["NAD83 / UTM zone 12N",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-111],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["Metre",1]]',
            {
                id: 'T0-shp-utm',
                tier: 'T0',
                featureCount: 8,
                bbox: meta.bbox,
                geometryTypes: ['Point'],
                crs: 'EPSG:26912',
                crsPick: 'EPSG:26912',
                skipBbox: true
            }
        );

        const noprjShapes = utmShapes.slice(0, 5);
        await writeShapefileZip('t0-points-noprj.zip', noprjShapes, utmAttrs.slice(0, 5), null, {
            id: 'T0-shp-noprj',
            tier: 'T0',
            featureCount: 5,
            bbox: meta.bbox,
            geometryTypes: ['Point'],
            crs: 'EPSG:26912',
            crsPick: 'EPSG:26912',
            skipBbox: true
        });

        const line = {
            type: 'PolyLine',
            parts: [features.slice(0, 4).map((f) => f.geometry.coordinates)]
        };
        await writeShapefileZip(
            't0-lines-wgs84.zip',
            [line],
            [{ id: 1, name: 'line-a' }],
            'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]',
            {
                id: 'T0-shp-line',
                tier: 'T0',
                featureCount: 1,
                bbox: meta.bbox,
                geometryTypes: ['LineString'],
                crs: 'EPSG:4326',
                skipBbox: true
            }
        );

        const poly = {
            type: 'Polygon',
            parts: [
                [
                    [-111.5, 40.1],
                    [-111.4, 40.1],
                    [-111.4, 40.2],
                    [-111.5, 40.2],
                    [-111.5, 40.1]
                ]
            ]
        };
        await writeShapefileZip(
            't0-polygons-wgs84.zip',
            [poly],
            [{ id: 1, name: 'poly-a' }],
            'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]',
            {
                id: 'T0-shp-poly',
                tier: 'T0',
                featureCount: 1,
                bbox: [-111.5, 40.1, -111.4, 40.2],
                geometryTypes: ['Polygon'],
                crs: 'EPSG:4326'
            }
        );
    }
}

async function writeProjectKit() {
    const features = makePointFeatures('T0');
    const layer = {
        id: 'kit-layer-1',
        name: 'Kit Points',
        type: 'spatial',
        visible: true,
        geojson: { type: 'FeatureCollection', features },
        schema: {
            geometryType: 'Point',
            featureCount: features.length,
            fields: [
                { name: 'id', type: 'number' },
                { name: 'name', type: 'string' }
            ],
            crs: 'EPSG:4326'
        },
        source: { format: 'geojson', file: 'inline' }
    };
    const snapshot = await buildProjectKitSnapshot({
        sections: ['layers', 'map', 'preferences'],
        layers: [layer],
        activeLayerId: layer.id,
        layerStyles: {},
        projectName: 'E2E Kit'
    });
    const blob = await packProjectKit(snapshot, JSZip);
    const buf = Buffer.from(await blob.arrayBuffer());
    const gtbx = 't0-mini.gis-toolbox';
    const legacy = 't0-mini.gtbx';
    await fs.writeFile(path.join(OUT_DIR, gtbx), buf);
    await fs.copyFile(path.join(OUT_DIR, gtbx), path.join(OUT_DIR, legacy));
    const meta = fcMeta(features);
    for (const [id, file] of [
        ['T0-gis-toolbox', gtbx],
        ['T0-gtbx', legacy]
    ]) {
        addFixture({
            id,
            file,
            format: 'gis-toolbox',
            tier: 'T0',
            tag: '@tune',
            expectedOutcome: 'success',
            ...meta,
            knownBug: 'Project kit import does not complete in Playwright (Import Toolbox project flow stalls before layer list updates)'
        });
    }
}

async function writeNegativeFixtures() {
    await fs.writeFile(path.join(OUT_DIR, 'neg-corrupt.zip'), Buffer.from('not a zip'));
    addFixture({
        id: 'neg-corrupt-zip',
        file: 'neg-corrupt.zip',
        format: 'zip',
        tier: 'T0',
        tag: '@tune',
        expectedOutcome: 'failure',
        featureCount: 0,
        geometryTypes: [],
        fields: {},
        crs: 'EPSG:4326'
    });

    await writeText('neg-empty.csv', '');
    addFixture({
        id: 'neg-empty',
        file: 'neg-empty.csv',
        format: 'csv',
        tier: 'T0',
        tag: '@tune',
        expectedOutcome: 'failure',
        featureCount: 0,
        geometryTypes: [],
        fields: {},
        crs: 'EPSG:4326'
    });

    await writeText('neg-truncated.geojson', '{"type":"FeatureCollection","features":[{"type":"Feature","properties":');
    addFixture({
        id: 'neg-truncated-geojson',
        file: 'neg-truncated.geojson',
        format: 'geojson',
        tier: 'T0',
        tag: '@tune',
        expectedOutcome: 'failure',
        featureCount: 0,
        geometryTypes: [],
        fields: {},
        crs: 'EPSG:4326'
    });

    await writeJson('neg-zero-fc.geojson', { type: 'FeatureCollection', features: [] });
    addFixture({
        id: 'neg-zero-fc',
        file: 'neg-zero-fc.geojson',
        format: 'geojson',
        tier: 'T0',
        tag: '@tune',
        expectedOutcome: 'success',
        featureCount: 0,
        bbox: [-112, 39, -110, 41],
        geometryTypes: [],
        fields: {},
        crs: 'EPSG:4326'
    });
}

async function main() {
    const force = process.argv.includes('--force');
    await fs.mkdir(OUT_DIR, { recursive: true });
    const manifestPath = path.join(OUT_DIR, 'manifest.json');
    if (!force && (await fs.stat(manifestPath).catch(() => null))) {
        console.log('manifest exists — use --force to regenerate');
        return;
    }

    manifestFixtures.length = 0;
    await writeGeojsonTier('T0');
    await writeGeojsonTier('T1');
    await writeJsonVariants('T0');
    await writeJsonVariants('T1');
    await writeTableFormats('T0');
    await writeTableFormats('T1');
    await writeExcel('T0');
    await writeExcel('T1');
    await writeKmlFormats('T0');
    await writeKmlFormats('T1');
    await writeGpx('T0');
    await writeGpx('T1');
    await writeShapefiles('T0');
    await writeShapefiles('T1');
    await writeProjectKit();
    await writeNegativeFixtures();

    const t1geo = manifestFixtures.find((f) => f.id === 'T1-geojson-fc');
    if (t1geo) t1geo.roundTrip = true;

    await fs.writeFile(
        manifestPath,
        `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), fixtures: manifestFixtures }, null, 2)}\n`
    );
    console.log(`Wrote ${manifestFixtures.length} fixtures to ${OUT_DIR}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
