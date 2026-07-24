/**
 * Path-backed File-like objects for desktop native dialogs (no full JS File read).
 */
import { getNativeFilePath } from './import-policy.js';

const GIS_OPEN_FILTERS = [
    {
        name: 'GIS data',
        extensions: [
            'geojson', 'json', 'csv', 'tsv', 'txt', 'xlsx', 'xls',
            'kml', 'kmz', 'gpx', 'zip', 'xml', 'gpkg', 'shp',
            'parquet', 'tif', 'tiff', 'cog'
        ]
    },
    { name: 'All files', extensions: ['*'] }
];

/**
 * @param {string} path
 * @param {number} [size]
 * @returns {File & { path: string, __pathBacked: true }}
 */
export function createPathBackedImportFile(path, size = 0) {
    const normalized = String(path || '').trim();
    const name = normalized.replace(/\\/g, '/').split('/').pop() || 'file';
    const file = {
        name,
        size: Number(size) || 0,
        type: '',
        lastModified: Date.now(),
        path: normalized,
        __pathBacked: true,
        slice() {
            throw new Error(`"${name}" is a path-backed desktop import — use disk path import, not File.slice`);
        },
        arrayBuffer() {
            throw new Error(`"${name}" is a path-backed desktop import — use disk path import`);
        },
        text() {
            throw new Error(`"${name}" is a path-backed desktop import — use disk path import`);
        },
        stream() {
            throw new Error(`"${name}" is a path-backed desktop import — use disk path import`);
        }
    };
    return /** @type {any} */ (file);
}

/**
 * Native Open dialog → path-backed import files with sizes from disk.
 *
 * @param {import('../platform/contracts.js').FileService|null|undefined} filesService
 * @returns {Promise<Array>}
 */
export async function pickDesktopImportFiles(filesService) {
    if (!filesService?.open) return [];
    const result = await filesService.open({
        multiple: true,
        title: 'Import GIS files',
        filters: GIS_OPEN_FILTERS
    });
    if (result?.canceled) return [];
    const paths = Array.isArray(result.paths)
        ? result.paths
        : (result.path ? [result.path] : []);
    const out = [];
    for (const path of paths) {
        if (!path) continue;
        let size = 0;
        try {
            if (filesService.stat) {
                const meta = await filesService.stat(path);
                size = Number(meta?.size) || 0;
            }
        } catch {
            size = 0;
        }
        out.push(createPathBackedImportFile(path, size));
    }
    return out;
}

/**
 * @param {File|object} file
 * @returns {boolean}
 */
export function isPathBackedImportFile(file) {
    return Boolean(file?.__pathBacked || getNativeFilePath(file));
}
