/**
 * Stationing adapter — consumes Project Stationing output as the authoritative source.
 */

import { formatStation } from '../widgets/project-stationing/engine.js';
import {
    readRouteProfile,
    isProjectStationingCenterline
} from '../widgets/project-stationing/route-profile.js';
import { lineLengthAny, nearestPointOnLineAny, lineSliceAlongRoute } from '../tools/line-geojson.js';

/**
 * @param {object[]} layers
 * @returns {object[]}
 */
export function getStationingRoutes(layers = []) {
    const routes = [];
    for (const layer of layers) {
        if (!isProjectStationingCenterline(layer)) continue;
        const profile = readRouteProfile(layer);
        if (!profile) continue;
        const lineFeature = layer?.geojson?.features?.find((f) =>
            f?.geometry?.type === 'LineString' || f?.geometry?.type === 'MultiLineString'
        );
        if (!lineFeature) continue;
        routes.push({
            routeId: profile.route_id || layer.id,
            routeName: profile.route_name || layer.name || 'Stationed route',
            layerId: layer.id,
            geometry: lineFeature.geometry,
            lineFeature,
            profile,
            startStationFeet: Number(profile.start_station_feet ?? 0),
            endStationFeet: Number(profile.end_station_feet ?? 0),
            beginMilepost: profile.begin_milepost,
            endMilepost: profile.end_milepost,
            stationDirection: profile.station_direction || 'geometry'
        });
    }
    return routes;
}

/**
 * @param {object[]} layers
 * @param {[number, number]} coordinate
 * @returns {object|null}
 */
export function getNearestStationingRoute(layers, coordinate) {
    if (!coordinate || typeof turf === 'undefined') return null;
    const routes = getStationingRoutes(layers);
    if (!routes.length) return null;

    const point = turf.point(coordinate);
    let best = null;
    let bestDistance = Infinity;

    for (const route of routes) {
        const snap = nearestPointOnLineAny(point, route.lineFeature, 'feet');
        const dist = Number(snap?.properties?.dist ?? Infinity);
        if (dist < bestDistance) {
            bestDistance = dist;
            best = { ...route, snap, distanceFt: dist };
        }
    }

    return best;
}

/**
 * @param {object} route
 * @param {[number, number]} coordinate
 * @returns {object|null}
 */
export function getStationAtCoordinate(route, coordinate) {
    if (!route?.lineFeature || !coordinate || typeof turf === 'undefined') return null;
    const point = turf.point(coordinate);
    const snap = nearestPointOnLineAny(point, route.lineFeature, 'feet');
    const distAlong = Number(snap?.properties?.location ?? 0);
    const totalLen = lineLengthAny(route.lineFeature, 'feet');
    const startFeet = Number(route.startStationFeet ?? route.profile?.start_station_feet ?? 0);
    const endFeet = Number(route.endStationFeet ?? route.profile?.end_station_feet ?? startFeet);
    const stationFeet = totalLen > 0
        ? startFeet + (distAlong / totalLen) * (endFeet - startFeet)
        : startFeet;

    const beginMp = route.beginMilepost ?? route.profile?.begin_milepost;
    const endMp = route.endMilepost ?? route.profile?.end_milepost;
    let milepost = null;
    if (beginMp != null && endMp != null && totalLen > 0) {
        milepost = beginMp + (distAlong / totalLen) * (endMp - beginMp);
    }

    return {
        stationingRouteId: route.routeId,
        routeName: route.routeName,
        stationFeet,
        formattedStation: formatStation(stationFeet),
        milepost,
        distanceAlongFt: distAlong,
        distanceFromRouteFt: Number(snap?.properties?.dist ?? 0),
        snapCoordinate: snap?.geometry?.coordinates || coordinate
    };
}

/**
 * @param {object} route
 * @param {import('geojson').Feature<import('geojson').LineString>} lineFeature
 * @returns {object|null}
 */
export function getStationRangeForLine(route, lineFeature) {
    if (!route?.lineFeature || !lineFeature?.geometry || typeof turf === 'undefined') return null;
    const coords = lineFeature.geometry.type === 'LineString'
        ? lineFeature.geometry.coordinates
        : lineFeature.geometry.coordinates?.[0];
    if (!coords?.length) return null;

    const start = getStationAtCoordinate(route, coords[0]);
    const end = getStationAtCoordinate(route, coords[coords.length - 1]);
    if (!start || !end) return null;

    const minStation = Math.min(start.stationFeet, end.stationFeet);
    const maxStation = Math.max(start.stationFeet, end.stationFeet);

    return {
        stationingRouteId: route.routeId,
        routeName: route.routeName,
        startStation: minStation,
        endStation: maxStation,
        formattedStationRange: `${formatStation(minStation)} – ${formatStation(maxStation)}`,
        startMilepost: start.milepost != null && end.milepost != null ? Math.min(start.milepost, end.milepost) : null,
        endMilepost: start.milepost != null && end.milepost != null ? Math.max(start.milepost, end.milepost) : null
    };
}

/**
 * @param {object} route
 * @param {[number, number]} coordinate
 * @returns {number|null}
 */
export function getMilepostAtCoordinate(route, coordinate) {
    return getStationAtCoordinate(route, coordinate)?.milepost ?? null;
}

export { formatStation };

/**
 * @param {object} route
 * @param {import('geojson').Feature<import('geojson').LineString>} lineFeature
 * @returns {object}
 */
export function applyStationingToLineFeature(route, lineFeature) {
    const range = getStationRangeForLine(route, lineFeature);
    if (!range) return lineFeature;
    return {
        ...lineFeature,
        properties: {
            ...(lineFeature.properties || {}),
            stationing_route_id: range.stationingRouteId,
            stationing_route_name: range.routeName,
            start_station: range.startStation,
            end_station: range.endStation,
            start_station_label: formatStation(range.startStation),
            end_station_label: formatStation(range.endStation),
            formatted_station_range: range.formattedStationRange,
            start_milepost: range.startMilepost,
            end_milepost: range.endMilepost
        }
    };
}

/**
 * @param {object} route
 * @param {import('geojson').Feature<import('geojson').Point>} pointFeature
 * @returns {object}
 */
export function applyStationingToPointFeature(route, pointFeature) {
    const coord = pointFeature?.geometry?.coordinates;
    const station = coord ? getStationAtCoordinate(route, coord) : null;
    if (!station) return pointFeature;
    return {
        ...pointFeature,
        properties: {
            ...(pointFeature.properties || {}),
            stationing_route_id: station.stationingRouteId,
            stationing_route_name: station.routeName,
            station: station.stationFeet,
            station_label: station.formattedStation,
            milepost: station.milepost,
            distance_from_route_ft: station.distanceFromRouteFt
        }
    };
}

/**
 * Slice helper exposed for downstream widgets.
 */
export { lineSliceAlongRoute };
