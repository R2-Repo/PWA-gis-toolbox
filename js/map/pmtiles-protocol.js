/**
 * MapLibre PMTiles protocol (desktop library files via ranged IPC reads).
 * No @tauri-apps imports — uses GisCatalogService.readFileRange from the platform bundle.
 */
import { Protocol, PMTiles } from 'pmtiles';
import { getGisCatalogService } from '../library/gis-library.js';

let protocol = null;
let registered = false;

/**
 * Source that reads PMTiles archives under the Local GIS Library via Tauri range IPC.
 */
class LibraryPmTilesSource {
    /**
     * @param {string} absolutePath
     * @param {(path: string, offset: number, length: number) => Promise<{ base64: string, bytesRead: number }>} readRange
     */
    constructor(absolutePath, readRange) {
        this.path = absolutePath;
        this._readRange = readRange;
    }

    getKey() {
        return this.path;
    }

    /**
     * @param {number} offset
     * @param {number} length
     * @param {AbortSignal} [signal]
     * @returns {Promise<{ data: ArrayBuffer }>}
     */
    async getBytes(offset, length, signal) {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        const result = await this._readRange(this.path, offset, length);
        const b64 = result?.base64 || '';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return { data: bytes.buffer };
    }
}

/**
 * Register MapLibre `pmtiles://` protocol once. Safe to call repeatedly.
 */
export function ensurePmtilesProtocol() {
    if (registered || typeof maplibregl === 'undefined') return protocol;
    protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);
    registered = true;
    return protocol;
}

/**
 * Register a local library PMTiles file so `pmtiles://<path>` resolves.
 * @param {string} absolutePath
 * @returns {Promise<import('pmtiles').PMTiles>}
 */
function normalizeLibraryPath(absolutePath) {
    return String(absolutePath || '').trim().replace(/\\/g, '/');
}

export async function registerLibraryPmTiles(absolutePath) {
    const proto = ensurePmtilesProtocol();
    if (!proto) throw new Error('MapLibre is not available');
    const catalog = getGisCatalogService();
    if (!catalog?.readFileRange) {
        throw new Error('PMTiles file reads require the Windows desktop GIS Library');
    }
    const key = normalizeLibraryPath(absolutePath);
    // Disk path for Tauri must keep OS separators on Windows
    const diskPath = String(absolutePath || '').trim();
    const existing = proto.get(key);
    if (existing) return existing;

    const source = new LibraryPmTilesSource(key, (_path, offset, length) =>
        catalog.readFileRange(diskPath, offset, length)
    );
    // Override getKey to stable forward-slash key
    source.path = key;
    const p = new PMTiles(source);
    proto.add(p);
    return p;
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
export function pmtilesMapUrl(absolutePath) {
    // Protocol strips the pmtiles:// prefix and looks up by Source.getKey()
    return `pmtiles://${normalizeLibraryPath(absolutePath)}`;
}
