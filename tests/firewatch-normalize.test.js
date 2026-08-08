import { describe, expect, it } from 'vitest';
import {
    buildFirewatchCollections,
    categorizePerimeter,
    hotspotWeight,
    mergeAndCapHotspots,
    normalizeHotspotFeature,
    normalizeIncidentFeature,
    normalizePerimeterFeature,
    parseAcquisitionTimestamp,
    resolveAgeHours
} from '../js/live-layers/firewatch/normalize.js';
import { HOTSPOT_MAX_FEATURES, UTAH_QUERY_ENVELOPE } from '../js/live-layers/firewatch/constants.js';
import { PERIMETER_COLOR, HOTSPOT_CORE_COLOR, INCIDENT_ICON_SIZE, buildHotspotLayerSpecs } from '../js/live-layers/firewatch/styles.js';

describe('firewatch normalize', () => {
    it('categorizes perimeter FeatureCategory', () => {
        expect(categorizePerimeter('Wildfire Daily Fire Perimeter')).toBe('wildfire');
        expect(categorizePerimeter('Prescribed Fire')).toBe('prescribed');
        expect(categorizePerimeter('Something Else')).toBe('other');
    });

    it('normalizes perimeter and incident properties', () => {
        const peri = normalizePerimeterFeature({
            type: 'Feature',
            properties: { FeatureCategory: 'Wildfire', IncidentName: 'Alpha', GISAcres: 120 },
            geometry: { type: 'Polygon', coordinates: [] }
        });
        expect(peri.properties.category).toBe('wildfire');
        expect(peri.properties.incidentName).toBe('Alpha');
        expect(peri.properties.acres).toBe(120);

        const inc = normalizeIncidentFeature({
            type: 'Feature',
            properties: { IncidentName: 'Bravo', DailyAcres: '2500' },
            geometry: { type: 'Point', coordinates: [0, 0] }
        });
        expect(inc.properties.dailyAcres).toBe(2500);
        expect(inc.properties.hasName).toBe(1);
    });

    it('computes hotspot weight and ageHours', () => {
        expect(hotspotWeight(0)).toBe(0.08);
        expect(hotspotWeight(25)).toBe(0.5);
        expect(hotspotWeight(100)).toBe(1);

        const now = Date.UTC(2026, 7, 8, 12, 0, 0);
        const sixHoursAgo = normalizeHotspotFeature({
            type: 'Feature',
            properties: { frp: 10, acq_date: '2026-08-08', acq_time: 600 },
            geometry: { type: 'Point', coordinates: [-111, 40] }
        }, { sourceKey: 'viirs', credit: 'VIIRS' }, now);
        expect(sixHoursAgo.properties.ageHours).toBeCloseTo(6, 5);

        expect(resolveAgeHours({ HOURS_OLD: 12 })).toBe(12);
        expect(resolveAgeHours({})).toBe(48);
    });

    it('parses NOAA YearDay timestamps', () => {
        const ms = parseAcquisitionTimestamp('2026220', 1200);
        expect(ms).toBe(Date.UTC(2026, 0, 220, 12, 0, 0));
    });

    it('merges hotspot feeds and caps by FRP', () => {
        const features = [
            { properties: { frp: 10 }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { properties: { frp: 90 }, geometry: { type: 'Point', coordinates: [1, 1] } },
            { properties: { frp: 40 }, geometry: { type: 'Point', coordinates: [2, 2] } }
        ];
        const capped = mergeAndCapHotspots(features, 2);
        expect(capped).toHaveLength(2);
        expect(capped[0].properties.frp).toBe(90);
        expect(capped[1].properties.frp).toBe(40);
        expect(HOTSPOT_MAX_FEATURES).toBe(8000);
    });

    it('builds five normalized FeatureCollections', () => {
        const packs = buildFirewatchCollections({
            perimeters: [{
                type: 'Feature',
                properties: { FeatureCategory: 'Prescribed Fire', IncidentName: 'RX1', GISAcres: 5 },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
            }],
            incidents: [{
                type: 'Feature',
                properties: { IncidentName: 'Named', DailyAcres: 50 },
                geometry: { type: 'Point', coordinates: [-111, 40] }
            }],
            viirs: [{
                type: 'Feature',
                properties: { frp: 20, HOURS_OLD: 3 },
                geometry: { type: 'Point', coordinates: [-111.1, 40.1] }
            }],
            modis: [{
                type: 'Feature',
                properties: { FRP: 30, HOURS_OLD: 2 },
                geometry: { type: 'Point', coordinates: [-111.2, 40.2] }
            }],
            noaa: [{
                type: 'Feature',
                properties: { FRP: 15, YearDay: '2026220', Time: 1200 },
                geometry: { type: 'Point', coordinates: [-111.3, 40.3] }
            }]
        });
        expect(packs.perimeters.features[0].properties.category).toBe('prescribed');
        expect(packs.incidents.features[0].properties.incidentName).toBe('Named');
        expect(packs.viirs.features[0].properties.weight).toBe(0.4);
        expect(packs.viirs.features[0].properties.hotspotSource).toBe('viirs');
        expect(packs.modis.features[0].properties.hotspotSource).toBe('modis');
        expect(packs.noaa.features[0].properties.hotspotSource).toBe('noaa');
    });

    it('exposes Utah query envelope with border buffer', () => {
        expect(UTAH_QUERY_ENVELOPE.xmin).toBeCloseTo(-114.8529, 4);
        expect(UTAH_QUERY_ENVELOPE.ymax).toBeCloseTo(42.8017, 4);
    });

    it('exports MapLibre style expressions and Firefly hotspot stacks', () => {
        expect(PERIMETER_COLOR[0]).toBe('match');
        expect(HOTSPOT_CORE_COLOR[0]).toBe('interpolate');
        expect(INCIDENT_ICON_SIZE[0]).toBe('interpolate');

        const viirs = buildHotspotLayerSpecs('d1', 's1', 1, 'viirs');
        const modis = buildHotspotLayerSpecs('d2', 's2', 1, 'modis');
        const noaa = buildHotspotLayerSpecs('d3', 's3', 1, 'noaa');
        expect(viirs.every((l) => l.type === 'circle')).toBe(true);
        expect(viirs).toHaveLength(4);
        expect(modis.find((l) => l.id.endsWith('-core')).paint['circle-color']).toBe('#ff4d00');
        expect(noaa).toHaveLength(4);
        expect(noaa.every((l) => l.type === 'circle')).toBe(true);
        expect(noaa.find((l) => l.id.endsWith('-core')).paint['circle-color']).toBe('#e0122d');
    });

    it('hotspot paint expressions are valid MapLibre circle paints', async () => {
        const { createPropertyExpression, latest } = await import('@maplibre/maplibre-gl-style-spec');
        for (const part of ['viirs', 'modis', 'noaa']) {
            for (const layer of buildHotspotLayerSpecs(`d-${part}`, 's', 1, part)) {
                for (const [prop, value] of Object.entries(layer.paint)) {
                    const spec = latest.paint_circle[prop];
                    const result = createPropertyExpression(value, spec);
                    expect(result.result, `${part} ${layer.id} ${prop}`).toBe('success');
                }
            }
        }
    });
});
