import { describe, expect, it } from 'vitest';
import {
    chooseAnalysisProvider,
    NATIVE_ANALYSIS_MIN_FEATURES,
    resolveLayerNativePath
} from '../js/library/desktop-analysis.js';
import { isKnownNativeOperation, NATIVE_OPERATIONS } from '../js/platform/jobs/allowed-operations.js';

describe('desktop analysis dual-path', () => {
    it('exposes analysis sidecar ops on the allow-list', () => {
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.BUFFER_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.CLIP_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.SPATIAL_JOIN)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.REPROJECT_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.SPATIAL_FILTER)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.NEAREST_JOIN)).toBe(true);
    });

    it('chooses javascript on web / without python', () => {
        expect(chooseAnalysisProvider(100_000, false, null, true)).toBe('javascript');
        expect(chooseAnalysisProvider(100, true, null, false)).toBe('javascript');
    });

    it('chooses python for large layers or native paths', () => {
        expect(
            chooseAnalysisProvider(NATIVE_ANALYSIS_MIN_FEATURES, true, null, true)
        ).toBe('python');
        expect(
            chooseAnalysisProvider(10, true, 'C:/data/layer.geojson', true)
        ).toBe('python');
        expect(chooseAnalysisProvider(10, true, null, true)).toBe('javascript');
    });

    it('resolves library disk paths from layer source', () => {
        expect(
            resolveLayerNativePath({
                source: { workingPath: 'C:/gis/data.parquet' }
            })
        ).toBe('C:/gis/data.parquet');
        expect(
            resolveLayerNativePath({
                source: { managedOriginalPath: 'C:/gis/orig.geojson' }
            })
        ).toBe('C:/gis/orig.geojson');
        expect(resolveLayerNativePath({ geojson: { features: [] } })).toBe(null);
    });
});
