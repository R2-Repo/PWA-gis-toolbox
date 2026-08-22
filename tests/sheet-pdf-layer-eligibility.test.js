import { describe, expect, it } from 'vitest';
import { SHEET_FIBER_SNAPSHOT_FORMAT, UDOT_FIBER_SERVICE_URL } from '../js/symbology/udot-fiber/constants.js';
import {
    SHEET_PDF_LIVE_NOTE,
    SHEET_PDF_PARTIAL_NOTE,
    SHEET_PDF_SKIP_REASON,
    buildSheetPdfLayerOption,
    classifySheetPdfLayer,
    countLoadedSheetPdfFeatures,
    isSheetCutterLayerCandidate,
    keepEligibleSheetPdfLayerIds
} from '../js/widgets/sheet-cutting/pdf-layer-eligibility.js';

describe('sheet PDF layer eligibility', () => {
    it('counts the larger of dataset and map-record features', () => {
        const layer = { geojson: { features: [{}, {}] } };
        const record = { geojson: { features: [{}, {}, {}] } };
        expect(countLoadedSheetPdfFeatures(layer, record)).toBe(3);
    });

    it('includes spatial and service layers, skips tables', () => {
        expect(isSheetCutterLayerCandidate({ type: 'spatial' })).toBe(true);
        expect(isSheetCutterLayerCandidate({ type: 'service' })).toBe(true);
        expect(isSheetCutterLayerCandidate({ type: 'table' })).toBe(false);
        expect(isSheetCutterLayerCandidate(null)).toBe(false);
    });

    it('allows in-memory spatial layers with loaded features', () => {
        const result = classifySheetPdfLayer({
            type: 'spatial',
            geojson: { features: [{ geometry: { type: 'LineString' } }] }
        });
        expect(result.eligible).toBe(true);
        expect(result.reason).toBeNull();
        expect(result.loadedFeatureCount).toBe(1);
    });

    it('rejects empty in-memory spatial layers', () => {
        const result = classifySheetPdfLayer({
            type: 'spatial',
            geojson: { features: [] }
        });
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe(SHEET_PDF_SKIP_REASON.empty);
    });

    it('rejects WMS / MapServer image / COG as raster', () => {
        expect(classifySheetPdfLayer({
            type: 'service',
            service: { kind: 'wms' }
        }).reasonKey).toBe('raster');
        expect(classifySheetPdfLayer({
            type: 'service',
            service: { kind: 'arcgis-mapserver' }
        }).reasonKey).toBe('raster');
        expect(classifySheetPdfLayer({
            type: 'spatial',
            source: { format: 'cog', adapter: 'cog' }
        }).reasonKey).toBe('raster');
    });

    it('rejects stored or tiled layers with no loaded features', () => {
        const workspace = classifySheetPdfLayer({
            type: 'spatial-chunked',
            storage: 'workspace',
            geojson: { features: [] },
            schema: { featureCount: 900000 }
        });
        expect(workspace.eligible).toBe(false);
        expect(workspace.reason).toBe(SHEET_PDF_SKIP_REASON.tiled);

        const tiles = classifySheetPdfLayer({
            type: 'pmtiles',
            source: { format: 'pmtiles' },
            geojson: { features: [] }
        });
        expect(tiles.eligible).toBe(false);
        expect(tiles.reasonKey).toBe('tiled');
    });

    it('notes partial stored layers when only some features are loaded', () => {
        const result = classifySheetPdfLayer({
            type: 'spatial-chunked',
            storage: 'workspace',
            geojson: { features: [{}, {}] },
            schema: { featureCount: 5000 }
        });
        expect(result.eligible).toBe(true);
        expect(result.note).toBe(SHEET_PDF_PARTIAL_NOTE);
        expect(result.loadedFeatureCount).toBe(2);
    });

    it('allows live vector layers even when the viewport cache is empty', () => {
        const result = classifySheetPdfLayer({
            type: 'service',
            service: { kind: 'arcgis-featureserver', url: 'https://example.com/FeatureServer/0' },
            geojson: { features: [] }
        });
        expect(result.eligible).toBe(true);
        expect(result.isLiveViewport).toBe(true);
        expect(result.note).toBe(SHEET_PDF_LIVE_NOTE);
    });

    it('allows live UDOT Fiber even when the service kind is a MapServer image', () => {
        const result = classifySheetPdfLayer({
            type: 'service',
            service: {
                kind: 'arcgis-mapserver',
                url: `${UDOT_FIBER_SERVICE_URL}/6`
            },
            geojson: { features: [] }
        });
        expect(result.eligible).toBe(true);
        expect(result.isUdotFiberLive).toBe(true);
    });

    it('allows converted Fiber snapshot layers', () => {
        const result = classifySheetPdfLayer({
            type: 'spatial',
            source: { format: SHEET_FIBER_SNAPSHOT_FORMAT },
            geojson: { features: [{ geometry: { type: 'Point' } }] }
        });
        expect(result.eligible).toBe(true);
    });

    it('builds picker options and drops ineligible selected ids', () => {
        const ready = buildSheetPdfLayerOption({
            id: 'a',
            name: 'Design',
            type: 'spatial',
            geojson: { features: [{}, {}, {}] }
        });
        const skip = buildSheetPdfLayerOption({
            id: 'b',
            name: 'Aerial',
            type: 'service',
            service: { kind: 'wms' }
        });
        expect(ready.eligible).toBe(true);
        expect(ready.featureCount).toBe(3);
        expect(skip.eligible).toBe(false);
        expect(keepEligibleSheetPdfLayerIds(['a', 'b', 'missing'], [ready, skip])).toEqual(['a']);
    });
});
