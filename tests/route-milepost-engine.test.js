import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ARCGIS_ENDPOINTS from '../js/arcgis/endpoints.js';
import { UDOT_ROUTE_SEGMENT_CONFIG } from '../js/widgets/route-milepost-segment/config.js';
import {
    buildMilepostPointWhere,
    buildMilepostRangeWhere
} from '../js/widgets/route-milepost-segment/engine.js';
import {
    MILEPOST_SOURCES,
    buildMilepostLayerName,
    fieldConfigForSource,
    getMilepostSource,
    milepostQueryUrls,
    resolveMilepostFieldConfig,
    selectMilepostFeatures,
    validateMilepostRequest
} from '../js/widgets/route-milepost/engine.js';
import { fetchMilepostSelection, searchMilepostRoutes } from '../js/widgets/route-milepost/query.js';

const KNOWN_URLS = new Set([
    ...ARCGIS_ENDPOINTS.map((entry) => entry.url),
    UDOT_ROUTE_SEGMENT_CONFIG.routeLayerUrl,
    UDOT_ROUTE_SEGMENT_CONFIG.milepostWholeLayerUrl,
    UDOT_ROUTE_SEGMENT_CONFIG.milepostTenthLayerUrl
]);

function point(measure, direction = 'P', valueField = 'Measure') {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-111.5, 40.5 + measure / 1000] },
        properties: {
            ROUTE_ID: '0080PM',
            [valueField]: measure,
            RouteDir: direction
        }
    };
}

function walk(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, acc);
        else acc.push(path);
    }
    return acc;
}

describe('route milepost sources', () => {
    it('uses the three existing milepost layer URLs and no others', () => {
        expect(MILEPOST_SOURCES.map((source) => source.label)).toEqual([
            'LR Mile',
            'LR Tenth Mile',
            'Physical Mile Post'
        ]);
        expect(getMilepostSource('lr-mile').url).toBe(UDOT_ROUTE_SEGMENT_CONFIG.milepostWholeLayerUrl);
        expect(getMilepostSource('lr-tenth').url).toBe(UDOT_ROUTE_SEGMENT_CONFIG.milepostTenthLayerUrl);
        expect(getMilepostSource('physical').url).toContain('Physical_Location_of_Reference_Post_RP');
        for (const url of milepostQueryUrls()) {
            expect(KNOWN_URLS.has(url)).toBe(true);
        }
    });

    it('does not hardcode a service URL or call getMap', () => {
        const files = [
            ...walk(join(process.cwd(), 'js/widgets/route-milepost')),
            join(process.cwd(), 'react/widgets/RouteMilepostDialog.jsx'),
            join(process.cwd(), 'react/widgets/mountRouteMilepostDialog.jsx')
        ];
        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            expect(source, file).not.toMatch(/https?:\/\//);
            expect(source, file).not.toMatch(/getMap\s*\(/);
        }
    });
});

describe('route milepost request validation', () => {
    it('requires a route, a known source, and a point or range', () => {
        expect(validateMilepostRequest({}).errors[0]).toMatch(/Route/);
        expect(validateMilepostRequest({ routeId: '0080PM', sourceId: 'nope', mode: 'point', milepost: '1' }).errors[0])
            .toMatch(/source/);
        expect(validateMilepostRequest({
            routeId: '0080PM',
            sourceId: 'lr-mile',
            mode: 'point',
            milepost: '10.2'
        })).toMatchObject({ valid: true, milepost: 10.2, mode: 'point' });
        expect(validateMilepostRequest({
            routeId: '0080PM',
            sourceId: 'lr-tenth',
            mode: 'range',
            startMilepost: '12',
            endMilepost: '10'
        })).toMatchObject({ valid: true, startMp: 10, endMp: 12, reversed: true });
        expect(validateMilepostRequest({
            routeId: '0080PM',
            sourceId: 'lr-mile',
            mode: 'range',
            startMilepost: '10',
            endMilepost: '10'
        }).valid).toBe(false);
    });
});

describe('route milepost feature selection', () => {
    const lrMile = getMilepostSource('lr-mile');
    const fieldConfig = fieldConfigForSource(lrMile, null);

    it('keeps an inclusive range and drops the snap buffer', () => {
        const request = validateMilepostRequest({
            routeId: '0080PM',
            routeAlias: 'I-80',
            routeDirection: 'P',
            sourceId: 'lr-mile',
            mode: 'range',
            startMilepost: '10',
            endMilepost: '12'
        });
        const selected = selectMilepostFeatures(
            [point(9.5), point(10, 'P'), point(11, 'P'), point(12, 'P'), point(12.6, 'P'), point(11, 'N')],
            request,
            fieldConfig
        );
        expect(selected.ok).toBe(true);
        expect(selected.features.map((feature) => feature.properties.Measure)).toEqual([10, 11, 12]);
    });

    it('snaps a point on the whole-mile grid and reports the snap', () => {
        const request = validateMilepostRequest({
            routeId: '0080PM',
            routeAlias: 'I-80',
            sourceId: 'lr-mile',
            mode: 'point',
            milepost: '10.2'
        });
        const selected = selectMilepostFeatures([point(10)], request, fieldConfig);
        expect(selected.ok).toBe(true);
        expect(selected.features).toHaveLength(1);
        expect(selected.warnings.join(' ')).toMatch(/snapped/i);
        expect(buildMilepostLayerName(request)).toBe('I-80 MP 10.2 LR Mile');
    });

    it('names a tenth-mile range from the ordered mileposts', () => {
        const request = validateMilepostRequest({
            routeId: '0015PM',
            routeAlias: 'I-15',
            sourceId: 'lr-tenth',
            mode: 'range',
            startMilepost: '12.5',
            endMilepost: '10'
        });
        expect(buildMilepostLayerName(request)).toBe('I-15 MP 10 to 12.5 LR Tenth Mile');
    });
});

describe('route milepost queries', () => {
    function services() {
        return {
            searchRoutes: vi.fn(async () => []),
            fetchLayerMetadata: vi.fn(async () => ({ fields: [] })),
            queryAllFeatures: vi.fn(async () => [])
        };
    }

    it('does not query until a search term is long enough', async () => {
        const client = services();
        await searchMilepostRoutes('I', client);
        expect(client.searchRoutes).not.toHaveBeenCalled();
        expect(client.queryAllFeatures).not.toHaveBeenCalled();
        expect(client.fetchLayerMetadata).not.toHaveBeenCalled();
    });

    it('searches routes through the shared route client', async () => {
        const client = services();
        client.searchRoutes.mockResolvedValue([
            { ROUTE_ID: '0015PM', ROUTE_ALIAS_COMMON: 'I-15', ROUTE_DIRECTION: 'P' }
        ]);
        const groups = await searchMilepostRoutes('I-15', client);
        expect(client.queryAllFeatures).not.toHaveBeenCalled();
        expect(client.fetchLayerMetadata).not.toHaveBeenCalled();
        expect(client.searchRoutes).toHaveBeenCalledTimes(1);
        expect(client.searchRoutes.mock.calls[0][1]).toBe(UDOT_ROUTE_SEGMENT_CONFIG);
        expect(String(client.searchRoutes.mock.calls[0][0])).toContain('I-15');
        expect(groups[0].routeAlias).toBe('I-15');
        expect(groups[0].variants[0].routeId).toBe('0015PM');
    });

    it('queries LR Mile with the shared where builder and no metadata round trip', async () => {
        const client = services();
        client.queryAllFeatures.mockResolvedValue([point(10), point(10.4)]);
        const result = await fetchMilepostSelection({
            routeId: '0080PM',
            routeAlias: 'I-80',
            routeDirection: 'P',
            sourceId: 'lr-mile',
            mode: 'point',
            milepost: '10'
        }, client);

        expect(client.fetchLayerMetadata).not.toHaveBeenCalled();
        expect(client.queryAllFeatures).toHaveBeenCalledTimes(1);
        const [url, query] = client.queryAllFeatures.mock.calls[0];
        expect(url).toBe(UDOT_ROUTE_SEGMENT_CONFIG.milepostWholeLayerUrl);
        expect(query.where).toBe(buildMilepostPointWhere('0080PM', 10, UDOT_ROUTE_SEGMENT_CONFIG, 'whole'));
        expect(query.outFields).toEqual(UDOT_ROUTE_SEGMENT_CONFIG.milepostOutFields);
        expect(query.returnGeometry).toBe(true);
        expect(result.features).toHaveLength(1);
        expect(result.features[0].properties.milepost).toBe(10);
        expect(result.features[0].properties.source).toBe('lr-mile');
        expect(result.features[0].properties._preview).toBeUndefined();
        expect(result.preview.features[0].properties._preview).toBe('milepost');
        expect(result.layerName).toBe('I-80 MP 10 LR Mile');
    });

    it('filters a tenth-mile range to the requested mileposts', async () => {
        const client = services();
        client.queryAllFeatures.mockResolvedValue([
            point(9.9),
            point(10),
            point(12),
            point(12.2)
        ]);
        const result = await fetchMilepostSelection({
            routeId: '0080PM',
            routeAlias: 'I-80',
            routeDirection: 'P',
            sourceId: 'lr-tenth',
            mode: 'range',
            startMilepost: '10',
            endMilepost: '12'
        }, client);
        const [url, query] = client.queryAllFeatures.mock.calls[0];
        expect(url).toBe(UDOT_ROUTE_SEGMENT_CONFIG.milepostTenthLayerUrl);
        expect(query.where).toBe(buildMilepostRangeWhere('0080PM', 10, 12, UDOT_ROUTE_SEGMENT_CONFIG, 'tenth'));
        expect(result.features.map((feature) => feature.properties.milepost)).toEqual([10, 12]);
        expect(result.summary.count).toBe(2);
    });

    it('reads physical milepost fields from metadata and still uses a known URL', async () => {
        const client = services();
        const physical = getMilepostSource('physical');
        client.fetchLayerMetadata.mockResolvedValue({
            fields: [
                { name: 'ROUTE_ID', alias: 'Route ID' },
                { name: 'MILEPOST', alias: 'Milepost' },
                { name: 'DIRECTION', alias: 'Direction' }
            ]
        });
        client.queryAllFeatures.mockResolvedValue([
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-111.8, 40.4] },
                properties: { ROUTE_ID: '0015PM', MILEPOST: 12, DIRECTION: 'P' }
            },
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-111.7, 40.3] },
                properties: { ROUTE_ID: '0015PM', MILEPOST: 12, DIRECTION: 'N' }
            }
        ]);

        const result = await fetchMilepostSelection({
            routeId: '0015PM',
            routeAlias: 'I-15',
            routeDirection: 'P',
            sourceId: 'physical',
            mode: 'point',
            milepost: '12'
        }, client);

        expect(client.fetchLayerMetadata).toHaveBeenCalledWith(physical.url);
        const [url, query] = client.queryAllFeatures.mock.calls[0];
        expect(url).toBe(physical.url);
        expect(KNOWN_URLS.has(url)).toBe(true);
        const fieldConfig = resolveMilepostFieldConfig({
            fields: [
                { name: 'ROUTE_ID' },
                { name: 'MILEPOST' },
                { name: 'DIRECTION' }
            ]
        });
        expect(fieldConfig.milepostValueField).toBe('MILEPOST');
        expect(query.where).toBe(buildMilepostPointWhere('0015PM', 12, fieldConfig, 'whole'));
        expect(query.orderByFields).toBe('MILEPOST');
        expect(result.features).toHaveLength(1);
        expect(result.features[0].properties.milepost).toBe(12);
        expect(result.features[0].properties.source_label).toBe('Physical Mile Post');
        expect(result.layerName).toBe('I-15 MP 12 Physical Mile Post');
    });

    it('fails closed when the physical layer has no measure field', async () => {
        const client = services();
        client.fetchLayerMetadata.mockResolvedValue({
            fields: [{ name: 'ROUTE_ID' }]
        });
        await expect(fetchMilepostSelection({
            routeId: '0015PM',
            sourceId: 'physical',
            mode: 'point',
            milepost: '4'
        }, client)).rejects.toThrow(/measure field/);
        expect(client.queryAllFeatures).not.toHaveBeenCalled();
    });

    it('does not call fetch while services are injected', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const client = services();
        client.queryAllFeatures.mockResolvedValue([point(4)]);
        await fetchMilepostSelection({
            routeId: '0080PM',
            routeAlias: 'I-80',
            sourceId: 'lr-mile',
            mode: 'point',
            milepost: '4'
        }, client);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
