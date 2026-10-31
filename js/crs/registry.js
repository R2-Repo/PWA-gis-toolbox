/**
 * CRS registry — curated EPSG presets and custom WKT registration.
 */
import { loadProj4 } from '../core/libs.js';
import { AppError, ErrorCategory } from '../core/error-handler.js';

/** @type {Map<string, { code: string, label: string, proj4?: string, wkt?: string }>} */
const _presets = new Map();

/** @type {Map<string, string>} */
const _customWkt = new Map();

const BUILTIN_PRESETS = [
    { code: 'EPSG:4326', label: 'WGS 84 (EPSG:4326)', proj4: '+proj=longlat +datum=WGS84 +no_defs +type=crs', aliases: ['wgs84', 'geographic'] },
    { code: 'EPSG:4269', label: 'NAD83 geographic (EPSG:4269)', proj4: '+proj=longlat +datum=NAD83 +no_defs +type=crs', aliases: ['nad83', 'lat lon'] },
    { code: 'EPSG:3857', label: 'Web Mercator (EPSG:3857)', proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +type=crs', aliases: ['web mercator'] },
    // NAD83(2011) UTM — typical horizontal CRS when NAVD88 is used for elevations (Utah / western US)
    {
        code: 'EPSG:6337',
        label: 'NAD83(2011) UTM zone 12N — NAVD88 survey horizontal (EPSG:6337)',
        proj4: '+proj=utm +zone=12 +ellps=GRS80 +units=m +no_defs +type=crs',
        aliases: ['navd88', 'navd 88', 'utm 12', 'utm12', 'utah', 'nad83 2011'],
        wkt: 'PROJCS["NAD_1983_2011_UTM_Zone_12N",GEOGCS["GCS_NAD_1983_2011",DATUM["D_NAD_1983_2011",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-111.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    {
        code: 'EPSG:6336',
        label: 'NAD83(2011) UTM zone 11N — NAVD88 survey horizontal (EPSG:6336)',
        proj4: '+proj=utm +zone=11 +ellps=GRS80 +units=m +no_defs +type=crs',
        aliases: ['navd88', 'utm 11', 'utm11', 'nad83 2011']
    },
    {
        code: 'EPSG:6338',
        label: 'NAD83(2011) UTM zone 13N — NAVD88 survey horizontal (EPSG:6338)',
        proj4: '+proj=utm +zone=13 +ellps=GRS80 +units=m +no_defs +type=crs',
        aliases: ['navd88', 'utm 13', 'utm13', 'nad83 2011']
    },
    {
        code: 'EPSG:26912',
        label: 'NAD83 UTM zone 12N — NAVD88 survey horizontal (EPSG:26912)',
        proj4: '+proj=utm +zone=12 +datum=NAD83 +units=m +no_defs +type=crs',
        aliases: ['navd88', 'navd 88', 'utm 12', 'utm12', 'utah', 'nad83 utm'],
        wkt: 'PROJCS["NAD_1983_UTM_Zone_12N",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-111.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    { code: 'EPSG:26911', label: 'NAD83 UTM zone 11N — NAVD88 survey horizontal (EPSG:26911)', proj4: '+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs +type=crs', aliases: ['navd88', 'utm 11', 'utm11'] },
    { code: 'EPSG:26913', label: 'NAD83 UTM zone 13N — NAVD88 survey horizontal (EPSG:26913)', proj4: '+proj=utm +zone=13 +datum=NAD83 +units=m +no_defs +type=crs', aliases: ['navd88', 'utm 13', 'utm13'] },
    { code: 'EPSG:6610', label: 'NAD83(2011) / Utah North (EPSG:6610)', proj4: '+proj=lcc +lat_0=40.33333333333334 +lon_0=-111.5 +lat_1=41.78333333333333 +lat_2=40.65 +x_0=500000 +y_0=1000000 +datum=NAD83 +units=m +no_defs +type=crs', aliases: ['navd88', 'utah state plane', 'utah north'] },
    { code: 'EPSG:6611', label: 'NAD83(2011) / Utah Central (EPSG:6611)', proj4: '+proj=lcc +lat_0=39.33333333333334 +lon_0=-111.5 +lat_1=40.65 +lat_2=39.01666666666667 +x_0=500000 +y_0=1000000 +datum=NAD83 +units=m +no_defs +type=crs', aliases: ['navd88', 'utah state plane', 'utah central'] },
    { code: 'EPSG:6612', label: 'NAD83(2011) / Utah South (EPSG:6612)', proj4: '+proj=lcc +lat_0=38.35 +lon_0=-111.5 +lat_1=39.01666666666667 +lat_2=37.21666666666667 +x_0=500000 +y_0=3000000 +datum=NAD83 +units=m +no_defs +type=crs', aliases: ['navd88', 'utah state plane', 'utah south'] },
    { code: 'EPSG:2276', label: 'NAD83 / Texas North Central (EPSG:2276)', proj4: '+proj=lcc +lat_0=31.66666666666666 +lon_0=-98.5 +lat_1=36.18333333333359 +lat_2=34.65 +x_0=600000 +y_0=2000000 +datum=NAD83 +units=m +no_defs +type=crs', aliases: [] },
    { code: 'EPSG:2263', label: 'NAD83 / New York Long Island (EPSG:2263)', proj4: '+proj=lcc +lat_0=40.16666666666666 +lon_0=-74 +lat_1=41.03333333333333 +lat_2=40.73333333333333 +x_0=300000 +y_0=0 +datum=NAD83 +units=ft +no_defs +type=crs', aliases: [] },
    { code: 'UNKNOWN', label: 'Unknown projected CRS', proj4: null, aliases: [] }
];

for (const preset of BUILTIN_PRESETS) {
    _presets.set(preset.code, { ...preset });
}

let _proj4Ready = false;

async function _ensureProj4() {
    const proj4 = await loadProj4();
    if (_proj4Ready) return proj4;
    for (const preset of _presets.values()) {
        if (preset.proj4) {
            proj4.defs(preset.code, preset.proj4);
        } else if (preset.wkt) {
            try {
                proj4.defs(preset.code, preset.wkt);
            } catch {
                // invalid preset WKT — resolveCrs will fail later
            }
        }
    }
    for (const [code, wkt] of _customWkt) {
        try {
            proj4.defs(code, wkt);
        } catch {
            // ignore invalid WKT at boot
        }
    }
    _proj4Ready = true;
    return proj4;
}

/**
 * @returns {{ code: string, label: string }[]}
 */
export function listPresetCrs() {
    return [..._presets.values()]
        .filter((p) => p.code !== 'UNKNOWN')
        .map(({ code, label, aliases }) => ({ code, label, aliases: aliases || [] }));
}

/**
 * @param {string} code
 * @returns {string}
 */
export function crsLabel(code) {
    if (!code) return 'Unknown';
    const preset = _presets.get(normalizeCrsCode(code));
    if (preset) return preset.label;
    if (_customWkt.has(code)) return code;
    return code;
}

/**
 * @param {string} code
 * @returns {string}
 */
export function normalizeCrsCode(code) {
    if (!code) return 'EPSG:4326';
    const trimmed = String(code).trim();
    if (/^EPSG:\d+$/i.test(trimmed)) {
        return `EPSG:${trimmed.split(':')[1]}`;
    }
    if (/^\d+$/.test(trimmed)) {
        return `EPSG:${trimmed}`;
    }
    return trimmed;
}

/**
 * Register custom WKT under a code (e.g. CUSTOM:my-layer).
 * @param {string} code
 * @param {string} wkt
 */
export async function registerWkt(code, wkt) {
    const normalized = normalizeCrsCode(code);
    const trimmed = String(wkt || '').trim();
    if (!trimmed) {
        throw new AppError(
            `Custom CRS "${normalized}" has empty WKT and cannot be registered.`,
            ErrorCategory.VALIDATION_ERROR,
            { side: 'source', crs: normalized, reason: 'malformed' }
        );
    }
    const proj4 = await _ensureProj4();
    try {
        proj4.defs(normalized, trimmed);
    } catch (e) {
        throw new AppError(
            `Custom CRS "${normalized}" WKT could not be parsed: ${e?.message || 'invalid WKT'}`,
            ErrorCategory.VALIDATION_ERROR,
            { side: 'source', crs: normalized, reason: 'malformed' }
        );
    }
    _customWkt.set(normalized, trimmed);
    _presets.set(normalized, { code: normalized, label: normalized, wkt: trimmed });
    _proj4Ready = true;
}

/**
 * Resolve CRS to proj4 definition string.
 * @param {string} code
 * @returns {Promise<string|null>}
 */
export async function resolveCrs(code) {
    const normalized = normalizeCrsCode(code);
    if (normalized === 'UNKNOWN') return null;
    const preset = _presets.get(normalized);
    if (preset?.proj4) {
        await _ensureProj4();
        return preset.proj4;
    }
    if (_customWkt.has(normalized) || preset?.wkt) {
        await _ensureProj4();
        const proj4 = await loadProj4();
        return proj4.defs(normalized) ? normalized : null;
    }
    return null;
}

/**
 * Get proj4 instance with defs registered.
 */
export async function getProj4() {
    return _ensureProj4();
}

/**
 * Get WKT for export (.prj file).
 * @param {string} code
 * @returns {string|null}
 */
export function getCrsWkt(code) {
    const normalized = normalizeCrsCode(code);
    const preset = _presets.get(normalized);
    if (preset?.wkt) return preset.wkt;
    if (_customWkt.has(normalized)) return _customWkt.get(normalized);
    if (normalized === 'EPSG:4326') {
        return 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    }
    return null;
}

/** Reset registry state for tests. */
export function resetCrsRegistryForTests() {
    _proj4Ready = false;
    _customWkt.clear();
    for (const preset of BUILTIN_PRESETS) {
        _presets.set(preset.code, { ...preset });
    }
}
