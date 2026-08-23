import { describe, expect, it } from 'vitest';
import { compilePaint } from '../js/map/style-engine.js';
import { validateCatalog, resolveLiveLayer, expandCatalogEntry } from '../js/live-layers/catalog-schema.js';
import { isVectorServiceKind } from '../js/live-layers/live-layer-viewport.js';
import {
    UDOT_BOX_IN_LABEL_PROP,
    UDOT_BOX_LABEL_FIELD,
    UDOT_FIBER_CATALOG_ID,
    matchUdotFiberLayerUrl
} from '../js/symbology/udot-fiber/constants.js';
import {
    buildUdotFiberLayerStyle,
    resolveStyle,
    lookupBentleyColor,
    requiredStyleFieldsForUdotFiberLayer,
    mergeUdotFiberStyleFields,
    markDatasetForUdotFiberStyle,
    resolveUdotFiberStyleForDataset
} from '../js/symbology/udot-fiber/resolve-style.js';
import { applyUdotFiberDisplayOffsets } from '../js/symbology/udot-fiber/display-offsets.js';
import {
    UDOT_BOXES_EXCLUDE_FIELD,
    buildUdotFiberExcludeWhere,
    combineUdotFiberMapLibreFilter,
    filterUdotFiberDisplayFeatures,
    isUdotFiberFeatureExcluded
} from '../js/symbology/udot-fiber/display-filters.js';
import {
    UDOT_FIBER_GROUND_LOCK_ZOOM,
    UDOT_FIBER_NEIGHBORHOOD_ZOOM,
    buildUdotFiberIconSizeExpression,
    buildUdotFiberZoomSize,
    interpolateUdotFiberIconPx,
    interpolateZoomStops,
    udotFiberIconSizeFromEsriWidth
} from '../js/symbology/udot-fiber/zoom-scale.js';
import {
    makeUdotGlyphSvg,
    resolvePointGlyph,
    decorateUdotFiberPointFeatures
} from '../js/symbology/udot-fiber/glyphs.js';
import { resolveLookalike, matchLookalikeFamily } from '../js/symbology/udot-fiber/lookalikes.js';
import {
    buildUdotFiberLayerSpecs,
    resolveUdotFiberPaintGeometry,
    UDOT_FIBER_LABEL_FONT,
    widenLineWidth
} from '../js/symbology/udot-fiber/paint.js';
import { resolveServiceLayerStyle } from '../js/live-layers/live-layer-styles.js';
import { UDOT_FIBER_STYLE, UDOT_CONDUIT_STYLE } from '../js/symbology/udot-fiber/styles.js';
import { applyImportLayerStyles } from '../js/import/post-import.js';
import { isSmartStyleActive } from '../js/map/style-engine.js';

describe('UDOT Fiber symbology', () => {
    it('matches MapServer layer URLs', () => {
        const hit = matchUdotFiberLayerUrl(
            'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6'
        );
        expect(hit).toEqual({ key: 'fiber', id: 6 });
        expect(matchUdotFiberLayerUrl('https://example.com/MapServer/0')).toBeNull();
    });

    it('builds fiber smart style with FIBER_SYMBOLS + Fiber_Label', () => {
        const style = buildUdotFiberLayerStyle('fiber');
        expect(style.mode).toBe('smart');
        expect(style.smart.visualVariables[0].field).toBe('FIBER_SYMBOLS');
        expect(style.smart.visualVariables[0].classes.length).toBeGreaterThan(5);
        expect(style.labels.enabled).toBe(true);
        expect(style.labels.field).toBe('Fiber_Label');
        expect(style.labels.placement).toBe('line');
        expect(style.labels.color[0]).toBe('match');
        expect(JSON.stringify(style.labels.color)).toContain('FIBER_SYMBOLS');
        expect(style._udotFiber.layerKey).toBe('fiber');

        const paint = compilePaint(style, 'line');
        expect(paint.hasDataDriven).toBe(true);
        expect(Array.isArray(paint.strokeColor)).toBe(true);
    });

    it('builds conduit style from CONDUIT_SYM', () => {
        const style = buildUdotFiberLayerStyle('conduit');
        expect(style.smart.visualVariables[0].field).toBe('CONDUIT_SYM');
        expect(style.labels.field).toBe('CustNameRight');
        expect(style._udotFiber.lineDasharray).toEqual([3, 2]);
        expect(style.strokeWidth).toBe(2.5);
        expect(style.labels.color[0]).toBe('match');
        expect(JSON.stringify(style.labels.color)).toContain('CONDUIT_SYM');
        expect(style.labels.haloColor).toBe('#ffffff');
        const paint = compilePaint(style, 'line');
        expect(Array.isArray(paint.strokeColor)).toBe(true);
        expect(paint.strokeWidth).toBe(2.5);
    });

    it('resolves per-feature color from ArcGIS class and Bentley label', () => {
        const byClass = resolveStyle('fiber', { FIBER_SYMBOLS: '72', Fiber_Label: '' });
        expect(byClass.color).toMatch(/^#/);

        const bentley = lookupBentleyColor('Syringa 72 SMF');
        expect(bentley).toBeTruthy();
    });

    it('registers UDOT Fiber Network in live catalog as vector MapServer', () => {
        expect(validateCatalog()).toEqual([]);
        const entry = resolveLiveLayer(UDOT_FIBER_CATALOG_ID);
        expect(entry?.name).toBe('UDOT Fiber Network');
        const services = expandCatalogEntry(entry);
        expect(services).toHaveLength(6);
        expect(services.every((s) => s.kind === 'arcgis-mapserver-vector')).toBe(true);
        expect(isVectorServiceKind('arcgis-mapserver-vector')).toBe(true);
        expect(services.every((s) => s.style?.mode === 'smart')).toBe(true);
    });

    it('holds ArcGIS box/splice size until 19.02, then grows with the map', () => {
        expect(udotFiberIconSizeFromEsriWidth(156, 'building')).toBeCloseTo(44 / 156);
        expect(udotFiberIconSizeFromEsriWidth(20, 'cabinets')).toBeCloseTo(29 / 20);
        const held = buildUdotFiberZoomSize(2, 'fiber');
        expect(held[0]).toBe('interpolate');
        expect(held).toContain(UDOT_FIBER_NEIGHBORHOOD_ZOOM);
        const icon = buildUdotFiberIconSizeExpression('building');
        expect(JSON.stringify(icon)).toContain('_udotEsriWidth');
        expect(icon[0]).toBe('interpolate');
        expect(icon).toContain(14);
        expect(icon).toContain(22);
        expect(JSON.stringify(icon)).toContain('104');
        const boxIcon = buildUdotFiberIconSizeExpression('boxes');
        expect(boxIcon[1]).toEqual(['exponential', 2]);
        const boxJson = JSON.stringify(boxIcon);
        expect(boxIcon).toContain(17);
        expect(boxJson).toContain('19.02');
        expect(boxJson).toContain('18');
        expect(boxJson).toContain('36');
        const spliceIcon = JSON.stringify(buildUdotFiberIconSizeExpression('splices'));
        expect(spliceIcon).toContain('19.02');
        expect(spliceIcon).toContain('18');
        expect(spliceIcon).toContain('36');
        const cabinetIcon = JSON.stringify(buildUdotFiberIconSizeExpression('cabinets'));
        expect(cabinetIcon).toContain('42');
        expect(interpolateUdotFiberIconPx('boxes', UDOT_FIBER_GROUND_LOCK_ZOOM)).toBe(18);
        expect(interpolateUdotFiberIconPx('boxes', 17)).toBe(10);
        expect(interpolateUdotFiberIconPx('boxes', 22)).toBeGreaterThan(70);
        expect(interpolateUdotFiberIconPx('splices', 22)).toBeGreaterThan(
            interpolateUdotFiberIconPx('splices', 18)
        );
        expect(interpolateZoomStops([[14, 10], [16, 20]], 15, 'linear')).toBe(15);
    });

    it('hides listed UDOT Boxes enclosure names', () => {
        expect(isUdotFiberFeatureExcluded('boxes', { DT_RSCENCLOSURE_NAME: 'CCTV' })).toBe(true);
        expect(isUdotFiberFeatureExcluded('boxes', { DT_RSCENCLOSURE_NAME: ' Radio (Slave)' })).toBe(true);
        expect(isUdotFiberFeatureExcluded('boxes', { DT_RSCENCLOSURE_NAME: 'POE' })).toBe(true);
        expect(isUdotFiberFeatureExcluded('boxes', { DT_RSCENCLOSURE_NAME: 'Vault' })).toBe(false);

        const kept = filterUdotFiberDisplayFeatures('boxes', [
            { type: 'Feature', properties: { DT_RSCENCLOSURE_NAME: 'ETC Gantry' } },
            { type: 'Feature', properties: { DT_RSCENCLOSURE_NAME: 'Existing Vault-CTL' } }
        ]);
        expect(kept).toHaveLength(1);
        expect(kept[0].properties.DT_RSCENCLOSURE_NAME).toBe('Existing Vault-CTL');

        const where = buildUdotFiberExcludeWhere('boxes');
        expect(where).toContain(UDOT_BOXES_EXCLUDE_FIELD);
        expect(where).toContain("'CCTV'");
        expect(where).toContain("'POE'");
        expect(where).toContain('IS NULL OR');
        expect(buildUdotFiberExcludeWhere('fiber')).toBe('1=1');

        const style = buildUdotFiberLayerStyle('boxes');
        const classValues = style.smart.visualVariables[0].classes.map((c) => c.value);
        expect(classValues).not.toContain('CCTV');
        expect(classValues).not.toContain('ETC Gantry');

        const filter = combineUdotFiberMapLibreFilter(
            ['==', ['geometry-type'], 'Point'],
            'boxes'
        );
        expect(filter).toEqual(['==', ['geometry-type'], 'Point']);
    });

    it('applies display offsets for multi-sheath lines', () => {
        const features = [
            {
                type: 'Feature',
                properties: { MULTISHEATH: 3 },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-111.9, 40.7], [-111.89, 40.71]]
                }
            },
            {
                type: 'Feature',
                properties: { MULTISHEATH: 3 },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-111.9, 40.7], [-111.89, 40.71]]
                }
            }
        ];
        const out = applyUdotFiberDisplayOffsets(features);
        expect(out[1].properties._udotDisplayOffsetM).toBeGreaterThan(0);
        expect(out[1].geometry.coordinates[0][0]).not.toBe(features[1].geometry.coordinates[0][0]);
    });

    it('builds procedural glyph SVG and resolves seed rules', () => {
        const svg = makeUdotGlyphSvg('square-x', '#00ff00', '#00ff00', 24);
        expect(svg).toContain('<svg');
        expect(svg).toContain('rect');
        expect(svg).not.toContain('rgba(0,0,0,0.28)');
        const boxSvg = makeUdotGlyphSvg('rect', '#111111', '#111111', 24);
        expect(boxSvg).toContain('<rect');
        expect(boxSvg).toContain('#ffffff');
        expect(boxSvg).not.toContain('rgba(0,0,0,0.28)');
        expect(boxSvg).not.toContain('<ellipse');
        expect(makeUdotGlyphSvg('ring', '#ff0000', '#ff0000', 24)).not.toContain('<ellipse');
        expect(makeUdotGlyphSvg('bowtie', '#ff0000', '#ff0000', 24)).not.toContain('<ellipse');
        expect(Number(boxSvg.match(/width="(\d+)"/)?.[1])).toBeGreaterThan(
            Number(boxSvg.match(/height="(\d+)"/)?.[1])
        );
        expect(makeUdotGlyphSvg('ring', '#ff0000', '#ff0000', 24)).toContain('<circle');
        const hit = resolvePointGlyph('building', { MODEL: 'UEN Building' });
        expect(hit?.glyph).toBe('square-x');
    });

    it('styles splices from MODEL enclosure types, not MODEL_1', () => {
        const style = buildUdotFiberLayerStyle('splices');
        expect(style.smart.visualVariables[0].field).toBe('MODEL');
        expect(style.smart.visualVariables[0].classes.map((c) => c.value)).toContain('Telco Handoff');

        expect(resolvePointGlyph('splices', { MODEL: 'Telco Handoff', MODEL_1: 'ButtSplice' }))
            .toEqual({ glyph: 'bowtie', color: '#ff0000' });
        expect(resolvePointGlyph('splices', { MODEL: 'Endpoint' }))
            .toEqual({ glyph: 'bowtie', color: '#ff0000' });
        expect(resolvePointGlyph('splices', { MODEL: 'UDOT SPEC Mid-Sheath' }))
            .toEqual({ glyph: 'bowtie', color: '#ff0000' });
        expect(resolvePointGlyph('splices', {})).toEqual({ glyph: 'bowtie', color: '#ff0000' });
        expect(resolveStyle('splices', { MODEL: 'Others' }).color).toBe('#ff0000');
    });

    it('keeps Fiber class/label fields on a partial ArcGIS field pick', () => {
        expect(requiredStyleFieldsForUdotFiberLayer('fiber')).toEqual(['FIBER_SYMBOLS', 'Fiber_Label']);
        const url = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
        expect(mergeUdotFiberStyleFields(null, url)).toBeNull();
        expect(mergeUdotFiberStyleFields(['OBJECTID', 'Route'], url, ['OBJECTID', 'Route', 'FIBER_SYMBOLS', 'Fiber_Label']))
            .toEqual(['OBJECTID', 'Route', 'FIBER_SYMBOLS', 'Fiber_Label']);
    });

    it('tags custom-URL ArcGIS imports and ignores unmatched URLs', () => {
        const url = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
        const ds = { id: 'a', source: { format: 'arcgis-rest' } };
        expect(markDatasetForUdotFiberStyle(ds, url)).toEqual({ key: 'fiber', id: 6 });
        expect(ds._udotFiberLayerKey).toBe('fiber');
        expect(ds._applyUdotFiberStyle).toBe(true);
        expect(ds.source.url).toBe(url);
        expect(markDatasetForUdotFiberStyle({ id: 'b', source: {} }, 'https://example.com/FeatureServer/0')).toBeNull();
    });

    it('applies the Fiber style pack only when the custom-URL flag is set', () => {
        const styles = new Map();
        const mapService = {
            getLayerStyle: (id) => styles.get(id) || null,
            setLayerStyle: (id, style) => { styles.set(id, style); },
            restyleLayer: (id, _ds, style) => { styles.set(id, style); },
            getLayerRecord: () => null
        };
        const fiberUrl = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
        const untagged = {
            id: 'untagged',
            type: 'spatial',
            source: { url: fiberUrl, format: 'arcgis-rest' },
            geojson: { type: 'FeatureCollection', features: [] }
        };
        applyImportLayerStyles(untagged, { mapService, getLayers: () => [untagged] });
        expect(mapService.getLayerStyle('untagged')).toBeNull();

        const tagged = {
            id: 'tagged',
            type: 'spatial',
            source: { url: fiberUrl, format: 'arcgis-rest' },
            geojson: { type: 'FeatureCollection', features: [] }
        };
        markDatasetForUdotFiberStyle(tagged, fiberUrl);
        applyImportLayerStyles(tagged, { mapService, getLayers: () => [tagged] });
        const applied = mapService.getLayerStyle('tagged');
        expect(applied.mode).toBe('smart');
        expect(applied.smart.visualVariables[0].field).toBe('FIBER_SYMBOLS');
        expect(isSmartStyleActive(applied)).toBe(true);
        expect(resolveUdotFiberStyleForDataset(tagged)?._udotFiber.layerKey).toBe('fiber');
    });

    it('maps published class families to modern lookalikes', () => {
        expect(matchLookalikeFamily('ITS Cabinet')).toEqual({ glyph: 'square-x', color: '#00ff00' });
        expect(matchLookalikeFamily('Type II Box')).toEqual({ glyph: 'rect', color: '#111111' });
        expect(matchLookalikeFamily('Type I Box')).toEqual({ glyph: 'rect', color: '#111111' });
        expect(matchLookalikeFamily('Hub-Mini')).toEqual({ glyph: 'hex', color: '#ff7f00' });
        expect(resolveLookalike('cabinets', { MODEL: 'CCTV(E)-R1' })).toEqual({
            glyph: 'square-x',
            color: '#00ff00'
        });
        expect(resolveLookalike('boxes', { DT_RSCENCLOSURE_NAME: 'Existing Vault-CTL' })).toEqual({
            glyph: 'ring',
            color: '#ff0000'
        });
        expect(resolveLookalike('boxes', { DT_RSCENCLOSURE_NAME: 'Exist Type I PC-R1' })).toEqual({
            glyph: 'rect',
            color: '#111111'
        });
        expect(resolveLookalike('boxes', { DT_RSCENCLOSURE_NAME: 'Unknown Enclosure' })).toEqual({
            glyph: 'rect',
            color: '#111111'
        });
        expect(resolveLookalike('building', { MODEL: 'Hub-R2' })).toEqual({
            glyph: 'hex',
            color: '#ff7f00'
        });
        expect(resolveLookalike('fiber', { FIBER_SYMBOLS: '72' })).toBeNull();
    });

    it('stamps lookalike glyphs and never uses ArcGIS PMS ids', () => {
        const out = decorateUdotFiberPointFeatures('cabinets', [
            { type: 'Feature', properties: { MODEL: 'CCTV(E)-R1' } }
        ], null);
        expect(out[0].properties._udotGlyph).toMatch(/^udot-glyph-square-x-/);
        expect(out[0].properties._udotGlyph).not.toMatch(/^arcgis-pms-/);
        expect(out[0].properties._udotEsriWidth).toBe(186);
        const box = decorateUdotFiberPointFeatures('boxes', [
            { type: 'Feature', properties: { DT_RSCENCLOSURE_NAME: 'Exist Type I PC-R1' } }
        ], null);
        const splice = decorateUdotFiberPointFeatures('splices', [
            { type: 'Feature', properties: { MODEL: 'Endpoint' } }
        ], null);
        expect(box[0].properties._udotEsriWidth).toBe(256);
        expect(splice[0].properties._udotEsriWidth).toBe(256);
        const labeled = decorateUdotFiberPointFeatures('boxes', [
            {
                type: 'Feature',
                properties: {
                    DT_RSCENCLOSURE_NAME: 'Exist Type I PC-R1',
                    BOXLABELS: 'III'
                }
            }
        ], null);
        const vault = decorateUdotFiberPointFeatures('boxes', [
            {
                type: 'Feature',
                properties: {
                    DT_RSCENCLOSURE_NAME: 'Existing Vault-CTL',
                    BOXLABELS: 'III'
                }
            }
        ], null);
        expect(labeled[0].properties[UDOT_BOX_IN_LABEL_PROP]).toBe(1);
        expect(vault[0].properties[UDOT_BOX_IN_LABEL_PROP]).toBeUndefined();
    });

    it('paints conduit as a traditional dash without a grey casing underlay', () => {
        expect(widenLineWidth(2, 2.2)).toBeCloseTo(4.2);
        const specs = buildUdotFiberLayerSpecs({
            datasetId: 'fiber-demo',
            sourceId: 'svc-src-fiber-demo',
            layerStyle: buildUdotFiberLayerStyle('conduit'),
            opacity: 1,
            fiberKey: 'conduit',
            minzoom: 14
        });
        const byId = Object.fromEntries(specs.map((spec) => [spec.id, spec]));
        expect(byId['svc-lyr-fiber-demo-casing']).toBeUndefined();
        expect(byId['svc-lyr-fiber-demo-glow']).toBeUndefined();
        expect(byId['svc-lyr-fiber-demo-shadow'].paint['line-dasharray']).toEqual([3, 2]);
        expect(byId['svc-lyr-fiber-demo-shadow'].paint['line-translate']).toEqual([1.15, 1.55]);
        expect(byId['svc-lyr-fiber-demo-shadow'].layout['line-cap']).toBe('round');
        expect(byId['svc-lyr-fiber-demo-line'].paint['line-dasharray']).toEqual([3, 2]);
        expect(byId['svc-lyr-fiber-demo-line'].layout['line-cap']).toBe('round');
        expect(specs.indexOf(byId['svc-lyr-fiber-demo-shadow'])).toBeLessThan(
            specs.indexOf(byId['svc-lyr-fiber-demo-line'])
        );
        expect(byId['svc-lyr-fiber-demo-line'].paint['line-width'][0]).toBe('interpolate');
        expect(byId['svc-lyr-fiber-demo-line'].paint['line-width']).toContain(2.55);

        const ink = specs.find((spec) => spec.id === 'svc-fiber-demo-line-labels');
        expect(specs.some((spec) => spec.id.endsWith('-line-labels-plate'))).toBe(false);
        expect(specs.indexOf(ink)).toBeGreaterThan(specs.indexOf(byId['svc-lyr-fiber-demo-line']));
        expect(ink.paint['text-color']).toEqual(byId['svc-lyr-fiber-demo-line'].paint['line-color']);
        expect(JSON.stringify(ink.paint['text-color'])).toContain('CONDUIT_SYM');
        expect(ink.paint['text-halo-color']).toBe('#ffffff');
        expect(ink.paint['text-halo-width']).toBeGreaterThanOrEqual(3);
        expect(ink.layout['text-font']).toEqual(UDOT_FIBER_LABEL_FONT);
        expect(ink.layout['symbol-placement']).toBe('line');
        expect(ink.layout['text-allow-overlap']).toBe(true);
        expect(ink.layout['text-ignore-placement']).toBe(true);
        expect(ink.layout['symbol-spacing']).toBe(190);
        expect(ink.layout['text-size']).toEqual([
            'interpolate', ['linear'], ['zoom'],
            14, 9,
            17, 10,
            20, 11
        ]);
        expect(ink.minzoom).toBe(14);
        expect(JSON.stringify(ink.filter)).toContain('MultiLineString');
        expect(ink.layout['text-pitch-alignment']).toBe('map');
        expect(ink.layout['text-rotation-alignment']).toBe('map');
    });

    it('keeps fiber casing/glow because fiber is a solid stroke', () => {
        const specs = buildUdotFiberLayerSpecs({
            datasetId: 'fiber-solid',
            sourceId: 'svc-src-fiber-solid',
            layerStyle: buildUdotFiberLayerStyle('fiber'),
            opacity: 1,
            fiberKey: 'fiber',
            minzoom: 14
        });
        const byId = Object.fromEntries(specs.map((spec) => [spec.id, spec]));
        expect(byId['svc-lyr-fiber-solid-shadow']).toBeTruthy();
        expect(byId['svc-lyr-fiber-solid-shadow'].paint['line-dasharray']).toBeUndefined();
        expect(byId['svc-lyr-fiber-solid-shadow'].paint['line-translate']).toEqual([1.15, 1.55]);
        expect(byId['svc-lyr-fiber-solid-casing']).toBeTruthy();
        expect(byId['svc-lyr-fiber-solid-glow']).toBeTruthy();
        expect(byId['svc-lyr-fiber-solid-line'].paint['line-dasharray']).toBeUndefined();
        const ink = specs.find((spec) => spec.id === 'svc-fiber-solid-line-labels');
        expect(ink.paint['text-color']).toEqual(byId['svc-lyr-fiber-solid-line'].paint['line-color']);
        expect(JSON.stringify(ink.paint['text-color'])).toContain('FIBER_SYMBOLS');
        expect(ink.paint['text-halo-color']).toBe('#ffffff');
        expect(ink.layout['text-size']).toEqual([
            'interpolate', ['linear'], ['zoom'],
            14, 10,
            17, 11,
            20, 12
        ]);
        expect(ink.layout['symbol-spacing']).toBe(360);
    });

    it('paints BOXLABELS inside landscape box rectangles', () => {
        const style = buildUdotFiberLayerStyle('boxes');
        expect(style.labels.field).toBe(UDOT_BOX_LABEL_FIELD);
        expect(style.labels.offset).toEqual([0, 0]);
        expect(style.labels.allowOverlap).toBe(true);
        expect(style.labels.minZoom).toBe(14);
        expect(requiredStyleFieldsForUdotFiberLayer('boxes')).toContain(UDOT_BOX_LABEL_FIELD);
        const specs = buildUdotFiberLayerSpecs({
            datasetId: 'box-demo',
            sourceId: 'svc-src-box-demo',
            layerStyle: style,
            opacity: 1,
            fiberKey: 'boxes',
            minzoom: 14
        });
        const ink = specs.find((spec) => spec.id === 'svc-box-demo-labels');
        expect(ink).toBeTruthy();
        expect(specs.some((spec) => spec.id.endsWith('-labels-plate'))).toBe(false);
        expect(ink.minzoom).toBe(14);
        expect(ink.layout['text-field']).toEqual(['to-string', ['get', UDOT_BOX_LABEL_FIELD]]);
        expect(ink.layout['text-anchor']).toBe('center');
        expect(ink.layout['text-offset']).toEqual([0, 0]);
        expect(ink.layout['text-allow-overlap']).toBe(true);
        expect(ink.layout['text-ignore-placement']).toBe(true);
        expect(ink.layout['text-rotate']).toEqual(['to-number', ['coalesce', ['get', 'Rotation'], 0]]);
        expect(ink.layout['text-keep-upright']).toBe(false);
        expect(ink.paint['text-color']).toBe('#111111');
        expect(ink.paint['text-halo-width']).toBe(0);
        expect(ink.layout['text-size'][0]).toBe('interpolate');
        expect(JSON.stringify(ink.layout['text-size'])).toContain('length');
        expect(JSON.stringify(ink.layout['text-size'])).toContain(UDOT_BOX_LABEL_FIELD);
        expect(JSON.stringify(ink.filter)).toContain(UDOT_BOX_IN_LABEL_PROP);
        const glyph = specs.find((spec) => spec.id.endsWith('-glyph'));
        expect(specs.indexOf(ink)).toBeGreaterThan(specs.indexOf(glyph));
    });

    it('billboards Fiber point icons in 3D', () => {
        const specs = buildUdotFiberLayerSpecs({
            datasetId: 'cab-demo',
            sourceId: 'svc-src-cab-demo',
            layerStyle: buildUdotFiberLayerStyle('cabinets'),
            opacity: 1,
            fiberKey: 'cabinets',
            minzoom: 14
        });
        const glyph = specs.find((spec) => spec.id.endsWith('-glyph'));
        const circle = specs.find((spec) => spec.id.endsWith('-circle'));
        expect(glyph.layout['icon-pitch-alignment']).toBe('viewport');
        expect(glyph.layout['icon-rotation-alignment']).toBe('map');
        expect(glyph.layout['icon-rotate']).toEqual(['to-number', ['coalesce', ['get', 'Rotation'], 0]]);
        expect(glyph.layout['icon-padding']).toBe(0);
        expect(circle.paint['circle-pitch-alignment']).toBe('viewport');
        const hit = specs.find((spec) => spec.id.endsWith('-hit'));
        expect(hit?.type).toBe('circle');
        expect(hit.paint['circle-opacity']).toBe(0);
        expect(hit.paint['circle-radius'][0]).toBe('interpolate');
        expect(specs.some((spec) => spec.id.endsWith('-casing'))).toBe(false);
    });

    it('still builds fiber/conduit line layers if style metadata is stripped', () => {
        expect(resolveUdotFiberPaintGeometry({}, 'fiber')).toBe('line');
        expect(resolveUdotFiberPaintGeometry({}, 'conduit')).toBe('line');
        const normalized = resolveServiceLayerStyle({ style: UDOT_FIBER_STYLE });
        expect(normalized._udotFiber?.geometry).toBe('line');
        const stripped = { ...UDOT_CONDUIT_STYLE };
        delete stripped._udotFiber;
        const specs = buildUdotFiberLayerSpecs({
            datasetId: 'stripped',
            sourceId: 'src',
            layerStyle: stripped,
            opacity: 1,
            fiberKey: 'conduit',
            minzoom: 14
        });
        expect(specs.some((spec) => spec.id === 'svc-lyr-stripped-line')).toBe(true);
        expect(specs.some((spec) => spec.id === 'svc-lyr-stripped-casing')).toBe(false);
        const line = specs.find((spec) => spec.id === 'svc-lyr-stripped-line');
        expect(line.paint['line-dasharray']).toEqual([3, 2]);
    });

    it('paints existing protect in place as dashed black and hides class color', () => {
        const lineSpecs = buildUdotFiberLayerSpecs({
            datasetId: 'pip-fiber',
            sourceId: 'src',
            layerStyle: buildUdotFiberLayerStyle('fiber'),
            opacity: 1,
            fiberKey: 'fiber',
            minzoom: 14
        });
        const line = lineSpecs.find((spec) => spec.id === 'svc-lyr-pip-fiber-line');
        const pip = lineSpecs.find((spec) => spec.id === 'svc-lyr-pip-fiber-pip');
        expect(JSON.stringify(line.filter)).toContain('_udotProtectInPlace');
        expect(pip.type).toBe('line');
        expect(pip.paint['line-color']).toBe('#000000');
        expect(pip.paint['line-dasharray']).toEqual([3, 2]);
        expect(pip.layout['line-cap']).toBe('butt');
        expect(JSON.stringify(pip.filter)).toContain('_udotProtectInPlace');

        const pointSpecs = buildUdotFiberLayerSpecs({
            datasetId: 'pip-boxes',
            sourceId: 'src',
            layerStyle: buildUdotFiberLayerStyle('boxes'),
            opacity: 1,
            fiberKey: 'boxes',
            minzoom: 14
        });
        const glyph = pointSpecs.find((spec) => spec.id.endsWith('-glyph'));
        const labels = pointSpecs.find((spec) => spec.id === 'svc-pip-boxes-labels');
        const pipMark = pointSpecs.find((spec) => spec.id.endsWith('-pip-mark'));
        const hit = pointSpecs.find((spec) => spec.id.endsWith('-hit'));
        expect(JSON.stringify(glyph.filter)).toContain('_udotProtectInPlace');
        expect(JSON.stringify(labels.filter)).toContain('_udotProtectInPlace');
        expect(JSON.stringify(hit.filter)).not.toContain('_udotProtectInPlace');
        expect(pipMark.type).toBe('symbol');
        expect(pipMark.layout['icon-image'][0]).toBe('coalesce');
    });
});
