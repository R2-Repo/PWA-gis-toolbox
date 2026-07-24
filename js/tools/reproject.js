/**
 * Layer reprojection wrapper — browser proj4 with desktop Python dual-path.
 */
import { reprojectDataset } from '../crs/reproject.js';
import { getLayerCrs } from '../crs/layer-crs.js';
import { normalizeCrsCode } from '../crs/registry.js';
import logger from '../core/logger.js';

/**
 * @param {object} dataset
 * @param {{ fromCrs?: string, toCrs?: string, name?: string, preferPython?: boolean }} options
 */
export async function reprojectLayer(dataset, options = {}) {
    const fromCrs = normalizeCrsCode(options.fromCrs || getLayerCrs(dataset));
    const toCrs = normalizeCrsCode(options.toCrs || 'EPSG:4326');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            reprojectLayerNative,
            NATIVE_ANALYSIS_MIN_FEATURES
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = dataset.geojson?.features?.length
            ?? dataset.source?.fullFeatureCount
            ?? 0;
        const nativePath = resolveLayerNativePath(dataset);
        const prefer = options.preferPython !== false;
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, prefer) === 'python') {
            logger.info('Reproject', 'Via Python sidecar', {
                count: featureCount,
                nativePath: Boolean(nativePath),
                threshold: NATIVE_ANALYSIS_MIN_FEATURES
            });
            return reprojectLayerNative(dataset, {
                fromCrs,
                toCrs,
                name: options.name
            });
        }
    } catch (err) {
        logger.warn('Reproject', 'Native path unavailable — falling back to proj4', {
            message: err?.message || String(err)
        });
    }

    return reprojectDataset(dataset, {
        fromCrs,
        toCrs,
        name: options.name
    });
}
