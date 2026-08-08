import { describe, expect, it } from 'vitest';
import {
    mergeDatasetLabelsIntoStyle,
    resolveLayerLabels
} from '../js/map/map-labels.js';
import { extractDefaultStyle } from '../js/map/style-panel-helpers.js';
import { convertSimpleStyleToSmart } from '../js/map/style-import.js';
import { normalizeStyle } from '../js/map/style-engine.js';

describe('layer style ↔ labels interaction', () => {
    it('mergeDatasetLabelsIntoStyle respects explicit labels.enabled=false', () => {
        const style = {
            mode: 'simple',
            strokeColor: '#ff0000',
            labels: { enabled: false, field: 'name' }
        };
        const dataset = { _mapLabels: { field: 'station', size: 12 } };
        const merged = mergeDatasetLabelsIntoStyle(style, dataset);
        expect(merged.labels.enabled).toBe(false);
        expect(merged.labels.field).toBe('name');
        expect(merged.strokeColor).toBe('#ff0000');
    });

    it('mergeDatasetLabelsIntoStyle migrates legacy _mapLabels only when style.labels is absent', () => {
        const style = { mode: 'simple', strokeColor: '#00ff00' };
        const dataset = { _mapLabels: { field: 'station', size: 14 } };
        const merged = mergeDatasetLabelsIntoStyle(style, dataset);
        expect(merged.labels.enabled).toBe(true);
        expect(merged.labels.field).toBe('station');
        expect(merged.labels.size).toBe(14);
    });

    it('resolveLayerLabels does not fall back to legacy when labels.enabled is set without field', () => {
        const style = { labels: { enabled: true, field: '' } };
        const dataset = { _mapLabels: { field: 'station' } };
        expect(resolveLayerLabels(style, dataset)).toBeNull();
    });

    it('resolveLayerLabels returns null when labels are explicitly disabled', () => {
        const style = { labels: { enabled: false, field: 'name' } };
        const dataset = { _mapLabels: { field: 'station' } };
        expect(resolveLayerLabels(style, dataset)).toBeNull();
    });

    it('extractDefaultStyle strips labels so they stay on the root style', () => {
        const style = normalizeStyle({
            mode: 'simple',
            strokeColor: '#112233',
            labels: { enabled: true, field: 'name', size: 16 }
        });
        const defaults = extractDefaultStyle(style);
        expect(defaults.labels).toBeUndefined();
        expect(defaults.strokeColor).toBe('#112233');
        expect(defaults.mode).toBeUndefined();
    });

    it('convertSimpleStyleToSmart preserves existing labels', () => {
        const features = [
            { properties: { stroke: '#ff0000', name: 'A' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { properties: { stroke: '#00ff00', name: 'B' }, geometry: { type: 'Point', coordinates: [1, 1] } }
        ];
        const existing = {
            mode: 'simple',
            labels: { enabled: true, field: 'name', size: 18, color: '#222222' }
        };
        const converted = convertSimpleStyleToSmart(features, 'stroke', '#2563eb', existing);
        expect(converted.mode).toBe('smart');
        expect(converted.labels).toEqual(existing.labels);
        expect(converted.smart.visualVariables.length).toBe(1);
    });

    it('label patch onto styled object keeps paint properties', () => {
        // Simulates RightPanel shared draft: style edits then label toggle.
        let draft = normalizeStyle({
            mode: 'simple',
            strokeColor: '#abcdef',
            fillColor: '#abcdef',
            strokeWidth: 4,
            pointSize: 12
        });
        draft = {
            ...draft,
            labels: {
                enabled: true,
                field: 'name',
                size: 11
            }
        };
        expect(draft.strokeColor).toBe('#abcdef');
        expect(draft.strokeWidth).toBe(4);
        expect(draft.pointSize).toBe(12);
        expect(draft.labels.enabled).toBe(true);
        expect(draft.labels.field).toBe('name');
    });
});
