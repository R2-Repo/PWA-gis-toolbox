/**
 * Pop-out print exports.
 * PNG and PDF use the same header wrappers as the main window.
 * Orbit GIF is recorded on the map in this window.
 */

import { willUseHighResExport } from '../map/map-export.js';
import { exportHeaderMapView } from '../map/header-export.js';
import { exportOrbitGif } from '../map/orbit-gif-export.js';

/**
 * @param {object} mapService
 * @param {'png'|'pdf'|'gif'} format
 * @param {object} [options]
 * @param {'letter'|'tabloid'} [options.pageSize]
 * @param {string} [options.title]
 * @param {(message: string, type?: string) => void} [options.onWarning]
 * @param {(message: string) => void} [options.onInfo]
 * @param {number} [options.durationMs]
 * @param {number} [options.frameCount]
 */
export async function exportPopoutMapView(mapService, format, options = {}) {
    if (format === 'gif') {
        options.onInfo?.('Recording orbit GIF…');
        return exportOrbitGif(mapService, options);
    }

    if (willUseHighResExport(mapService)) {
        options.onInfo?.('Exporting high-resolution map…');
    }

    return exportHeaderMapView(mapService, format, {
        blockWhenDualScreen: false,
        pageSize: options.pageSize,
        title: options.title,
        maxPixels: options.maxPixels,
        maxWidth: options.maxWidth,
        onWarning: options.onWarning
    });
}
