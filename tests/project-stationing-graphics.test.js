import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    computeProjectStationing,
    offsetCenterlineFeature,
    offsetPointLabelsAlongCenterline,
    normalizeOffsetSide,
    buildStationTick,
    buildStationLabelFromTick,
    snapMilepostsAlongCenterline,
    buildMilepostLabelFeatures
} from '../js/widgets/project-stationing/engine.js';

globalThis.turf = turf;

describe('project stationing graphics', () => {
    const centerline = turf.lineString([
        [-111.92, 40.75],
        [-111.90, 40.75],
        [-111.88, 40.75]
    ], { name: 'Test Route' });

    it('normalizes offset side values', () => {
        expect(normalizeOffsetSide('left')).toBe('left');
        expect(normalizeOffsetSide('RIGHT')).toBe('right');
        expect(normalizeOffsetSide()).toBe('right');
    });

    it('offsets centerline to the requested side', () => {
        const right = offsetCenterlineFeature(centerline, 30, 'right');
        const left = offsetCenterlineFeature(centerline, 30, 'left');

        const midOriginal = turf.along(centerline, 1100, { units: 'feet' });
        const midRight = turf.along(right.feature, 1100, { units: 'feet' });
        const midLeft = turf.along(left.feature, 1100, { units: 'feet' });

        const rightSeparation = turf.distance(midOriginal, midRight, { units: 'feet' });
        const leftSeparation = turf.distance(midOriginal, midLeft, { units: 'feet' });

        expect(rightSeparation).toBeGreaterThan(25);
        expect(rightSeparation).toBeLessThan(35);
        expect(leftSeparation).toBeGreaterThan(25);
        expect(leftSeparation).toBeLessThan(35);
        expect(right.warning).toBe('');
        expect(left.warning).toBe('');
    });

    it('returns the original line when centerline offset is zero', () => {
        const result = offsetCenterlineFeature(centerline, 0, 'right');
        expect(result.feature.geometry).toEqual(centerline.geometry);
    });

    it('applies custom label placement in computeProjectStationing', () => {
        const result = computeProjectStationing({
            centerline,
            beginStation: '0+00',
            intervalFt: 100,
            graphics: {
                labelOffsetFt: 50,
                labelSide: 'left'
            }
        });

        expect(result.ok).toBe(true);
        expect(result.stationLabels.length).toBeGreaterThan(0);
        expect(result.stationLabels[0].properties.label_side).toBe('left');
        expect(result.centerline.properties.label_offset_ft).toBe(50);
        expect(result.centerline.properties.label_side).toBe('left');
    });

    it('shifts output centerline when centerline offset is set', () => {
        const result = computeProjectStationing({
            centerline,
            beginStation: '0+00',
            intervalFt: 100,
            centerlineOffsetFt: 40,
            centerlineOffsetSide: 'right'
        });

        expect(result.ok).toBe(true);
        expect(result.centerline.properties.centerline_offset_ft).toBe(40);
        expect(result.centerline.properties.centerline_offset_side).toBe('right');
        expect(result.baseCenterline.geometry).toEqual(centerline.geometry);

        const originalMid = turf.along(centerline, 1100, { units: 'feet' });
        const offsetMid = turf.along(result.centerline, 1100, { units: 'feet' });
        const separation = turf.distance(originalMid, offsetMid, { units: 'feet' });
        expect(separation).toBeGreaterThan(35);
        expect(separation).toBeLessThan(45);
    });

    it('offsets milepost label points along the centerline', () => {
        const milepost = turf.point([-111.90, 40.75], { milepost: '12.3' });
        const [offsetLeft, offsetRight] = [
            offsetPointLabelsAlongCenterline([milepost], centerline, { offsetFt: 35, side: 'left' }),
            offsetPointLabelsAlongCenterline([milepost], centerline, { offsetFt: 35, side: 'right' })
        ];

        const centerPoint = turf.along(centerline, 1100, { units: 'feet' });
        const leftDistance = turf.distance(centerPoint, offsetLeft[0], { units: 'feet' });
        const rightDistance = turf.distance(centerPoint, offsetRight[0], { units: 'feet' });

        expect(leftDistance).toBeGreaterThan(30);
        expect(rightDistance).toBeGreaterThan(30);
        expect(offsetLeft[0].properties.label_side).toBe('left');
        expect(offsetRight[0].properties.label_side).toBe('right');
        expect(turf.distance(offsetLeft[0], offsetRight[0], { units: 'feet' })).toBeGreaterThan(60);
    });

    it('places station labels beyond the tick end on the label side', () => {
        const stationPoint = turf.along(centerline, 1100, { units: 'feet' });
        const tangent = 90;
        const tick = buildStationTick(stationPoint, tangent, 30, {});
        const label = buildStationLabelFromTick(tick, tangent, 20, 'right');
        const tickEnd = turf.point(tick.geometry.coordinates[1]);

        expect(turf.distance(tickEnd, label, { units: 'feet' })).toBeGreaterThan(18);
        expect(turf.distance(tickEnd, label, { units: 'feet' })).toBeLessThan(22);
    });

    it('snaps mileposts by distance along a reference centerline', () => {
        const offset = offsetCenterlineFeature(centerline, 30, 'right').feature;
        const milepost = turf.along(centerline, 1100, { units: 'feet' });
        const [snapped] = snapMilepostsAlongCenterline([milepost], centerline, offset);
        const expected = turf.along(offset, 1100, { units: 'feet' });

        expect(turf.distance(snapped, expected, { units: 'feet' })).toBeLessThan(1);
    });

    it('builds offset milepost labels without moving milepost points', () => {
        const milepost = turf.along(centerline, 1100, { units: 'feet' });
        const labels = buildMilepostLabelFeatures([milepost], centerline, {
            labelOffsetFt: 35,
            labelSide: 'right'
        });

        expect(labels).toHaveLength(1);
        expect(turf.distance(milepost, labels[0], { units: 'feet' })).toBeGreaterThan(30);
        expect(buildMilepostLabelFeatures([milepost], centerline, { labelOffsetFt: 0 })).toHaveLength(0);
    });
});
