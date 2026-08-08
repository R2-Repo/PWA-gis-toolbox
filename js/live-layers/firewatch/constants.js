/**
 * Firewatch Utah composite live layer — ArcGIS sources, AOI, and style constants.
 */

export const FIREWATCH_CATALOG_ID = 'firewatch';

export const FIREWATCH_KIND = 'firewatch';

/** @typedef {'perimeters' | 'incidents' | 'viirs' | 'modis' | 'noaa'} FirewatchPart */

export const FIREWATCH_PARTS = /** @type {const} */ (['perimeters', 'incidents', 'viirs', 'modis', 'noaa']);

export const HOTSPOT_PARTS = new Set(['viirs', 'modis', 'noaa']);

/** @param {string} [part] */
export function isHotspotPart(part) {
    return HOTSPOT_PARTS.has(part);
}

/** Utah state envelope (WGS84). */
export const UTAH_BOUNDS = {
    west: -114.0529,
    south: 36.9979,
    east: -109.0415,
    north: 42.0017
};

export const UTAH_BORDER_BUFFER_DEG = 0.8;

/** Utah ± 0.8° query envelope. */
export const UTAH_QUERY_ENVELOPE = {
    xmin: UTAH_BOUNDS.west - UTAH_BORDER_BUFFER_DEG,
    ymin: UTAH_BOUNDS.south - UTAH_BORDER_BUFFER_DEG,
    xmax: UTAH_BOUNDS.east + UTAH_BORDER_BUFFER_DEG,
    ymax: UTAH_BOUNDS.north + UTAH_BORDER_BUFFER_DEG,
    spatialReference: { wkid: 4326 }
};

export const FIREWATCH_REFRESH_MS = 300000;
export const HOTSPOT_MAX_FEATURES = 8000;
export const HOTSPOT_FRP_FULL_MW = 50;
export const HOTSPOT_DEFAULT_AGE_HOURS = 48;

export const WILDFIRE_INCIDENT_ICON_ID = 'wildfire-incident-icon';
export const WILDFIRE_INCIDENT_ICON_URL = '/icons/map-icon-wildfire-incident.png';

export const COLORS = {
    wildfire: '#ff6a3d',
    wildfireHalo: 'rgba(255, 106, 61, 0.32)',
    prescribed: '#f4b04a',
    other: '#ff8a4d',
    label: '#ffe6c2',
    labelHalo: 'rgba(13, 19, 18, 0.96)'
};

/**
 * ArcGIS Firefly–inspired palettes.
 * Use one saturated hue per feed — glow layers share that color (blur/opacity only).
 * A lighter neon mid-ring makes centers look washed-out / hollow.
 * @type {Record<'viirs' | 'modis' | 'noaa', { core: string }>}
 */
export const FIREFLY_PALETTES = {
    viirs: { core: '#ff8c1a' },
    modis: { core: '#ff4d00' },
    noaa: { core: '#e0122d' }
};

/** Recency ramp stops: ageHours → color (legacy / unused by Firefly stack) */
export const HOTSPOT_AGE_RAMP = [
    [0, '#e8c078'],
    [6, '#e09850'],
    [24, '#d06a3a'],
    [48, '#b84432'],
    [96, '#8c2424']
];

/** Acre breaks matching ArcGIS USA Wildfire Incidents (Acres). */
export const INCIDENT_ACRE_BREAKS = [1000, 10000, 50000, 300000];

/** Icon sizes at zoom 5 / 10 / 14 for the five acre classes. */
export const INCIDENT_ICON_SIZES = {
    5: [0.13, 0.16, 0.2, 0.24, 0.3],
    10: [0.16, 0.2, 0.24, 0.29, 0.36],
    14: [0.18, 0.23, 0.28, 0.34, 0.42]
};

/**
 * @typedef {object} FirewatchSourceDef
 * @property {string} id
 * @property {FirewatchPart} role
 * @property {string} url
 * @property {string[]} outFields
 * @property {number} maxRecordCount
 * @property {string} [credit]
 */

/** @type {FirewatchSourceDef[]} */
export const FIREWATCH_SOURCES = [
    {
        id: 'nifc-perimeters',
        role: 'perimeters',
        url: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/1',
        outFields: ['OBJECTID', 'IncidentName', 'FeatureCategory', 'GISAcres', 'Label', 'DateCurrent', 'GACC'],
        maxRecordCount: 2000,
        credit: 'NIFC / Esri'
    },
    {
        id: 'nifc-incidents',
        role: 'incidents',
        url: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/0',
        outFields: [
            'OBJECTID',
            'IncidentName',
            'IncidentTypeCategory',
            'DailyAcres',
            'PercentContained',
            'FireCause',
            'FireDiscoveryDateTime',
            'POOState',
            'FireDiscoveryAge'
        ],
        maxRecordCount: 4000,
        credit: 'NIFC / Esri'
    },
    {
        id: 'viirs-hotspots',
        role: 'viirs',
        url: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0',
        outFields: ['OBJECTID', 'frp', 'bright_ti4', 'confidence', 'acq_date', 'acq_time', 'satellite', 'daynight'],
        maxRecordCount: 4000,
        credit: 'NASA FIRMS — VIIRS 375 m'
    },
    {
        id: 'modis-hotspots',
        role: 'modis',
        url: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/MODIS_Thermal_v1/FeatureServer/0',
        outFields: ['OBJECTID', 'FRP', 'BRIGHTNESS', 'CONFIDENCE', 'ACQ_DATE', 'SATELLITE', 'DAYNIGHT', 'HOURS_OLD'],
        maxRecordCount: 4000,
        credit: 'NASA FIRMS — MODIS 1 km'
    },
    {
        id: 'noaa-hotspots',
        role: 'noaa',
        url: 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Fire_Detections_(v1)/FeatureServer/0',
        outFields: ['FID', 'FRP', 'Satellite', 'YearDay', 'Time'],
        maxRecordCount: 2000,
        credit: 'NOAA / NESDIS'
    }
];

export const PART_URLS = {
    perimeters: FIREWATCH_SOURCES.find((s) => s.role === 'perimeters').url,
    incidents: FIREWATCH_SOURCES.find((s) => s.role === 'incidents').url,
    viirs: FIREWATCH_SOURCES.find((s) => s.role === 'viirs').url,
    modis: FIREWATCH_SOURCES.find((s) => s.role === 'modis').url,
    noaa: FIREWATCH_SOURCES.find((s) => s.role === 'noaa').url
};

export const PART_ATTRIBUTION = {
    perimeters: 'Fire perimeters & incidents: NIFC / Esri',
    incidents: 'Fire perimeters & incidents: NIFC / Esri',
    viirs: 'NASA FIRMS — VIIRS 375 m',
    modis: 'NASA FIRMS — MODIS 1 km',
    noaa: 'NOAA / NESDIS'
};

export const PART_LABELS = {
    perimeters: 'Firewatch Perimeters',
    incidents: 'Firewatch Incidents',
    viirs: 'VIIRS Hotspots',
    modis: 'MODIS Hotspots',
    noaa: 'NOAA Hotspots'
};
