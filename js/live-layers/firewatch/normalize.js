/**
 * Normalize ArcGIS wildfire features into Firewatch GeoJSON properties.
 */
import {
    HOTSPOT_DEFAULT_AGE_HOURS,
    HOTSPOT_FRP_FULL_MW,
    HOTSPOT_MAX_FEATURES
} from './constants.js';

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function toNumber(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * @param {string} [featureCategory]
 * @returns {'prescribed' | 'wildfire' | 'other'}
 */
export function categorizePerimeter(featureCategory) {
    const text = String(featureCategory || '').toLowerCase();
    if (text.includes('prescribed')) return 'prescribed';
    if (text.includes('wildfire')) return 'wildfire';
    return 'other';
}

/**
 * @param {number | null} frp
 */
export function hotspotWeight(frp) {
    const mw = frp == null ? 0 : frp;
    return clamp(mw / HOTSPOT_FRP_FULL_MW, 0.08, 1);
}

/**
 * Parse acquisition age in hours from common FIRMS / NOAA fields.
 * @param {Record<string, unknown>} props
 * @param {number} [nowMs]
 */
export function resolveAgeHours(props, nowMs = Date.now()) {
    const hoursOld = toNumber(props.HOURS_OLD ?? props.hours_old);
    if (hoursOld != null && hoursOld >= 0) return hoursOld;

    const acqDate = props.acq_date ?? props.ACQ_DATE ?? props.YearDay;
    const acqTime = props.acq_time ?? props.ACQ_TIME ?? props.Time;
    if (acqDate != null) {
        const parsed = parseAcquisitionTimestamp(acqDate, acqTime);
        if (parsed != null) {
            const ageMs = nowMs - parsed;
            if (Number.isFinite(ageMs) && ageMs >= 0) {
                return ageMs / (1000 * 60 * 60);
            }
        }
    }

    return HOTSPOT_DEFAULT_AGE_HOURS;
}

/**
 * @param {unknown} dateVal
 * @param {unknown} timeVal
 * @returns {number | null} epoch ms
 */
export function parseAcquisitionTimestamp(dateVal, timeVal) {
    const dateStr = String(dateVal ?? '').trim();
    if (!dateStr) return null;

    // YYYYMMDD or YYYY-MM-DD
    let y;
    let m;
    let d;
    const dashed = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const compact = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
    const yearDay = dateStr.match(/^(\d{4})(\d{3})$/); // NOAA YearDay e.g. 2026150
    if (dashed) {
        y = Number(dashed[1]);
        m = Number(dashed[2]);
        d = Number(dashed[3]);
    } else if (compact) {
        y = Number(compact[1]);
        m = Number(compact[2]);
        d = Number(compact[3]);
    } else if (yearDay) {
        y = Number(yearDay[1]);
        const doy = Number(yearDay[2]);
        const base = Date.UTC(y, 0, 1);
        const withDay = base + (doy - 1) * 86400000;
        const timeNum = toNumber(timeVal);
        let hh = 0;
        let mm = 0;
        let ss = 0;
        if (timeNum != null) {
            const t = String(Math.trunc(timeNum)).padStart(4, '0');
            if (t.length <= 4) {
                hh = Number(t.slice(0, -2) || 0);
                mm = Number(t.slice(-2));
            } else {
                const t6 = t.padStart(6, '0');
                hh = Number(t6.slice(0, 2));
                mm = Number(t6.slice(2, 4));
                ss = Number(t6.slice(4, 6));
            }
        }
        return withDay + ((hh * 3600) + (mm * 60) + ss) * 1000;
    } else {
        const asNum = toNumber(dateVal);
        // ArcGIS epoch ms
        if (asNum != null && asNum > 1e11) return asNum;
        const tryDate = Date.parse(dateStr);
        if (Number.isFinite(tryDate)) {
            const timeNum = toNumber(timeVal);
            if (timeNum == null) return tryDate;
            const t = String(Math.trunc(timeNum)).padStart(4, '0');
            const hh = Number(t.slice(0, -2) || 0);
            const mm = Number(t.slice(-2));
            const day = new Date(tryDate);
            return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm, 0);
        }
        return null;
    }

    const timeNum = toNumber(timeVal);
    let hh = 0;
    let mm = 0;
    let ss = 0;
    if (timeNum != null) {
        const t = String(Math.trunc(timeNum)).padStart(4, '0');
        if (t.length <= 4) {
            hh = Number(t.slice(0, -2) || 0);
            mm = Number(t.slice(-2));
        } else {
            const t6 = t.padStart(6, '0');
            hh = Number(t6.slice(0, 2));
            mm = Number(t6.slice(2, 4));
            ss = Number(t6.slice(4, 6));
        }
    }

    return Date.UTC(y, m - 1, d, hh, mm, ss);
}

/**
 * @param {object} feature
 * @returns {object}
 */
export function normalizePerimeterFeature(feature) {
    const props = feature?.properties || {};
    const acres = toNumber(props.GISAcres);
    return {
        ...feature,
        properties: {
            ...props,
            category: categorizePerimeter(props.FeatureCategory),
            incidentName: props.IncidentName || props.Label || '',
            acres: acres ?? 0
        }
    };
}

/**
 * @param {object} feature
 * @returns {object}
 */
export function normalizeIncidentFeature(feature) {
    const props = feature?.properties || {};
    const dailyAcres = toNumber(props.DailyAcres) ?? 0;
    const name = String(props.IncidentName || '').trim();
    return {
        ...feature,
        properties: {
            ...props,
            dailyAcres,
            incidentName: name,
            hasName: name ? 1 : 0
        }
    };
}

/**
 * @param {object} feature
 * @param {{ credit: string, sourceKey: string }} meta
 * @param {number} [nowMs]
 */
export function normalizeHotspotFeature(feature, meta, nowMs = Date.now()) {
    const props = feature?.properties || {};
    const frp = toNumber(props.frp ?? props.FRP) ?? 0;
    const ageHours = resolveAgeHours(props, nowMs);
    return {
        ...feature,
        properties: {
            ...props,
            frp,
            weight: hotspotWeight(frp),
            ageHours,
            hotspotSource: meta.sourceKey,
            hotspotCredit: meta.credit
        }
    };
}

/**
 * Cap a single hotspot feed by FRP (highest first).
 * @param {object[]} features
 * @param {number} [max]
 */
export function mergeAndCapHotspots(features, max = HOTSPOT_MAX_FEATURES) {
    const sorted = [...(features || [])].sort((a, b) => {
        const fa = toNumber(a?.properties?.frp) ?? 0;
        const fb = toNumber(b?.properties?.frp) ?? 0;
        return fb - fa;
    });
    return sorted.slice(0, max);
}

/**
 * @param {object[]} features
 * @param {{ sourceKey: string, credit: string }} meta
 * @param {number} nowMs
 * @param {number} [max]
 */
function normalizeHotspotPack(features, meta, nowMs, max) {
    return mergeAndCapHotspots(
        (features || [])
            .filter((f) => f?.geometry)
            .map((f) => normalizeHotspotFeature(f, meta, nowMs)),
        max
    );
}

/**
 * @param {{ perimeters?: object[], incidents?: object[], viirs?: object[], modis?: object[], noaa?: object[] }} packs
 * @param {{ nowMs?: number, viirsCredit?: string, modisCredit?: string, noaaCredit?: string, viirsMax?: number, modisMax?: number, noaaMax?: number }} [opts]
 */
export function buildFirewatchCollections(packs, opts = {}) {
    const nowMs = opts.nowMs ?? Date.now();
    const perimeters = (packs.perimeters || [])
        .filter((f) => f?.geometry)
        .map(normalizePerimeterFeature);
    const incidents = (packs.incidents || [])
        .filter((f) => f?.geometry)
        .map(normalizeIncidentFeature);

    const viirs = normalizeHotspotPack(packs.viirs, {
        sourceKey: 'viirs',
        credit: opts.viirsCredit || 'NASA FIRMS — VIIRS 375 m'
    }, nowMs, opts.viirsMax ?? 4000);

    const modis = normalizeHotspotPack(packs.modis, {
        sourceKey: 'modis',
        credit: opts.modisCredit || 'NASA FIRMS — MODIS 1 km'
    }, nowMs, opts.modisMax ?? 4000);

    const noaa = normalizeHotspotPack(packs.noaa, {
        sourceKey: 'noaa',
        credit: opts.noaaCredit || 'NOAA / NESDIS'
    }, nowMs, opts.noaaMax ?? 2000);

    return {
        perimeters: { type: 'FeatureCollection', features: perimeters },
        incidents: { type: 'FeatureCollection', features: incidents },
        viirs: { type: 'FeatureCollection', features: viirs },
        modis: { type: 'FeatureCollection', features: modis },
        noaa: { type: 'FeatureCollection', features: noaa }
    };
}
