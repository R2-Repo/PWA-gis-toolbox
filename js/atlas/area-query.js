/**
 * Spatial query of Atlas assets inside a polygon / bbox.
 */
import { getAtlasSnapshot } from './store.js';
import { findingsInScope } from './triage.js';

/**
 * @param {[number, number]} point [lon, lat]
 * @param {GeoJSON.Polygon | GeoJSON.MultiPolygon} polygon
 */
function pointInRing(point, ring) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y))
            && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * @param {[number, number]} point
 * @param {object} geometry
 */
export function pointInGeometry(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
        const [outer, ...holes] = geometry.coordinates;
        if (!pointInRing(point, outer)) return false;
        for (const hole of holes) {
            if (pointInRing(point, hole)) return false;
        }
        return true;
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((poly) =>
            pointInGeometry(point, { type: 'Polygon', coordinates: poly }));
    }
    if (geometry.type === 'Point') {
        return point[0] === geometry.coordinates[0] && point[1] === geometry.coordinates[1];
    }
    return false;
}

/**
 * @param {object} geometry GeoJSON Polygon / MultiPolygon / bbox rewritten as Polygon
 */
export function queryAtlasInArea(geometry) {
    const snap = getAtlasSnapshot();
    const drops = snap.drops.filter((d) =>
        d.lat != null && d.lon != null && pointInGeometry([d.lon, d.lat], geometry));
    const hubs = snap.hubs.filter((h) =>
        h.lat != null && h.lon != null && pointInGeometry([h.lon, h.lat], geometry));
    const channelIds = new Set(drops.map((d) => d.channelId).filter(Boolean));
    const channels = snap.channels.filter((c) => channelIds.has(c.id));
    const devices = snap.devices.filter((d) =>
        drops.some((drop) => drop.deviceId === d.id || (drop.ip && drop.ip === d.ip)));

    const primaryHubCodes = new Set(channels.map((c) => c.primaryHubCode).filter(Boolean));
    const secondaryHubCodes = new Set(channels.map((c) => c.secondaryHubCode).filter(Boolean));

    const areaSnap = {
        ...snap,
        areaResults: { drops, hubs, channels, devices },
        selection: { kind: 'area', id: 'area' }
    };
    const warnings = findingsInScope(areaSnap, 'selection').filter((f) => f.status === 'Open');

    return {
        geometry,
        drops,
        hubs,
        channels,
        devices,
        primaryHubCodes: [...primaryHubCodes],
        secondaryHubCodes: [...secondaryHubCodes],
        warnings
    };
}
