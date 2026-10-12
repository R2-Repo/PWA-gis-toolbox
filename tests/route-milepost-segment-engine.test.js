import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    buildRouteCenterlineOutputProperties,
    computeSegmentResult,
    formatRouteMileage,
    locateMilepostOnRoute,
    readRouteMileageDisplay
} from '../js/widgets/route-milepost-segment/engine.js';
import { UDOT_ROUTE_SEGMENT_CONFIG } from '../js/widgets/route-milepost-segment/config.js';

globalThis.turf = turf;

describe('route-milepost-segment display helpers', () => {
    it('formats route mileage to two decimals or em dash', () => {
        expect(formatRouteMileage(10.5)).toBe('10.50');
        expect(formatRouteMileage(null)).toBe('—');
        expect(formatRouteMileage('bad')).toBe('—');
    });

    it('reads formatted route mileage from route context', () => {
        const routeContext = {
            routeRecord: { BEG_MILEAGE: 0, END_MILEAGE: 45.678 },
            routeSelection: {
                positiveLine: {
                    properties: { BEG_MILEAGE: 999, END_MILEAGE: 999 }
                }
            }
        };
        expect(readRouteMileageDisplay(routeContext, UDOT_ROUTE_SEGMENT_CONFIG)).toEqual({
            begMileageFormatted: '0.00',
            endMileageFormatted: '45.68'
        });
    });

    it('falls back to positive line properties when route record is missing mileage', () => {
        const routeContext = {
            routeRecord: {},
            routeSelection: {
                positiveLine: {
                    properties: { BEG_MILEAGE: 12.3, END_MILEAGE: 98.76 }
                }
            }
        };
        expect(readRouteMileageDisplay(routeContext, UDOT_ROUTE_SEGMENT_CONFIG)).toEqual({
            begMileageFormatted: '12.30',
            endMileageFormatted: '98.76'
        });
    });
});

describe('buildRouteCenterlineOutputProperties', () => {
    it('returns the expected attribute schema with rounded lengths', () => {
        const outputGeometry = turf.lineString([
            [-111.9, 40.7],
            [-111.899, 40.701]
        ]);
        const props = buildRouteCenterlineOutputProperties({
            routeAlias: 'I-15',
            startMp: 10.65,
            endMp: 12.5,
            outputGeometry
        });

        expect(props).toMatchObject({
            route_alias_common: 'I-15',
            start_milepost: 10.65,
            end_milepost: 12.5,
            Name: '',
            ID: '',
            Future1: '',
            Future2: ''
        });
        expect(props.length_miles).toBe(Number(props.length_miles.toFixed(2)));
        expect(props.length_feet).toBe(Number(props.length_feet.toFixed(2)));
        expect(Object.keys(props)).toEqual([
            'route_alias_common',
            'start_milepost',
            'end_milepost',
            'length_miles',
            'length_feet',
            'Name',
            'ID',
            'Future1',
            'Future2'
        ]);
    });
});

describe('multipart route centerlines', () => {
    const mileageConfig = {
        begMileageField: 'BEG_MILEAGE',
        endMileageField: 'END_MILEAGE',
        milepostValueField: 'Measure',
        routeAliasField: 'ROUTE_ALIAS_COMMON',
        routeIdField: 'ROUTE_ID'
    };

    function dividedRoute() {
        return {
            type: 'Feature',
            properties: {
                ROUTE_ID: '0080PM',
                ROUTE_ALIAS_COMMON: 'I-80',
                BEG_MILEAGE: 0,
                END_MILEAGE: 100
            },
            geometry: {
                type: 'MultiLineString',
                coordinates: [
                    [[-114.0, 40.7], [-112.0, 40.7]],
                    [[-111.5, 40.9], [-111.0, 41.2]]
                ]
            }
        };
    }

    it('locates mileposts on a multipart centerline', () => {
        const line = dividedRoute();
        const located = locateMilepostOnRoute(line, 10, line.properties, mileageConfig);
        expect(located.ok).toBe(true);
        expect(located.point.geometry.type).toBe('Point');
    });

    it('builds a segment that stays on one part', () => {
        const line = dividedRoute();
        const result = computeSegmentResult({
            positiveLine: line,
            startMp: 10,
            endMp: 20,
            alignment: 'positive_direction_centerline',
            config: mileageConfig,
            milepostLayerKey: 'whole',
            routeMeta: { routeAlias: 'I-80', routeId: '0080PM', routeRecord: line.properties }
        });

        expect(result.ok).toBe(true);
        expect(result.summary.startMp).toBe(10);
        expect(result.summary.endMp).toBe(20);
        expect(result.centerlineSegment.geometry.type).toBe('LineString');
        expect(result.outputFeature.geometry.type).toBe('LineString');
    });

    it('keeps a spatial gap when the milepost range crosses parts', () => {
        const line = dividedRoute();
        const result = computeSegmentResult({
            positiveLine: line,
            startMp: 5,
            endMp: 95,
            alignment: 'positive_direction_centerline',
            config: mileageConfig,
            milepostLayerKey: 'whole',
            routeMeta: { routeAlias: 'I-80', routeId: '0080PM', routeRecord: line.properties }
        });

        expect(result.ok).toBe(true);
        expect(result.centerlineSegment.geometry.type).toBe('MultiLineString');
        expect(result.centerlineSegment.geometry.coordinates).toHaveLength(2);
        const [first, second] = result.centerlineSegment.geometry.coordinates;
        const gapFeet = turf.distance(
            turf.point(first[first.length - 1]),
            turf.point(second[0]),
            { units: 'feet' }
        );
        expect(gapFeet).toBeGreaterThan(1000);
    });
});
