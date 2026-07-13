import { formatStation } from './engine.js';

export const PROJECT_STATIONING_WIDGET_ID = 'project-stationing';

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`
        ).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function calculateGeometryHash(geometry) {
    const text = stableStringify(geometry || null);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildRouteProfile(input = {}, generatedOutput = {}) {
    const centerline = generatedOutput.centerline || input.centerline;
    const summary = generatedOutput.summary || {};
    const routeMeta = input.routeMeta || {};
    const clipMeta = input.clipMeta || {};
    const startFeet = Number(summary.beginStationFeet ?? input.beginStationFeet ?? 0);
    const endFeet = Number(summary.endStationFeet ?? input.endStationFeet ?? startFeet);
    const totalLengthFt = Number(summary.lineLengthFeet ?? centerline?.properties?.total_length_ft ?? 0);
    const stationIntervalFt = Number(summary.intervalFeet ?? input.intervalFeet ?? input.intervalFt ?? 100);
    const labelIntervalFt = Number(centerline?.properties?.label_interval_ft ?? stationIntervalFt);
    const routeName = routeMeta.routeAlias || routeMeta.routeName || centerline?.properties?.route_name || '';
    const routeId = routeMeta.routeId || centerline?.properties?.route_id || '';
    const beginMilepost = clipMeta.mileposts?.startMp ?? centerline?.properties?.begin_milepost ?? null;
    const endMilepost = clipMeta.mileposts?.endMp ?? centerline?.properties?.end_milepost ?? null;
    const routeDirection = routeMeta.routeDirection
        ?? centerline?.properties?.route_direction
        ?? centerline?.properties?.ROUTE_DIRECTION
        ?? '';
    const centerlineOffsetFt = Number(
        centerline?.properties?.centerline_offset_ft ?? input.centerlineOffsetFt ?? 0
    );
    const centerlineOffsetSide = String(
        centerline?.properties?.centerline_offset_side ?? input.centerlineOffsetSide ?? 'right'
    ).toLowerCase() === 'left' ? 'left' : 'right';
    const labelOffsetFt = Number(
        centerline?.properties?.label_offset_ft
        ?? input.graphics?.labelOffsetFt
        ?? input.labelOffsetFt
        ?? 35
    );
    const labelSide = String(
        centerline?.properties?.label_side ?? input.graphics?.labelSide ?? input.labelSide ?? 'right'
    ).toLowerCase() === 'left' ? 'left' : 'right';

    return {
        route_id: routeId,
        route_name: routeName,
        route_direction: String(routeDirection || '').toUpperCase(),
        travel_direction: input.travelDirection
            || routeMeta.travelDirection
            || centerline?.properties?.travel_direction
            || '',
        source_layer_id: routeMeta.sourceLayerId || '',
        source_feature_id: routeMeta.sourceFeatureId ?? '',
        stationed_centerline_layer_id: input.stationedCenterlineLayerId || '',
        route_geometry_hash: calculateGeometryHash(centerline?.geometry),
        start_station_label: formatStation(startFeet),
        start_station_feet: startFeet,
        end_station_label: formatStation(endFeet),
        end_station_feet: endFeet,
        total_length_ft: totalLengthFt,
        begin_milepost: beginMilepost != null ? Number(beginMilepost) : null,
        end_milepost: endMilepost != null ? Number(endMilepost) : null,
        station_direction: input.stationDirection || 'geometry',
        station_interval_ft: stationIntervalFt,
        label_interval_ft: labelIntervalFt,
        centerline_offset_ft: centerlineOffsetFt,
        centerline_offset_side: centerlineOffsetSide,
        label_offset_ft: labelOffsetFt,
        label_side: labelSide,
        units: 'feet',
        clip_method: clipMeta.clipMethod || centerline?.properties?.clip_method || '',
        created_date: new Date().toISOString(),
        created_by_widget: PROJECT_STATIONING_WIDGET_ID
    };
}

export function routeProfileToProperties(profile = {}) {
    return {
        route_id: profile.route_id || '',
        route_name: profile.route_name || '',
        start_station_label: profile.start_station_label || '',
        start_station_feet: profile.start_station_feet ?? null,
        end_station_label: profile.end_station_label || '',
        end_station_feet: profile.end_station_feet ?? null,
        total_length_ft: profile.total_length_ft ?? null,
        begin_milepost: profile.begin_milepost ?? null,
        end_milepost: profile.end_milepost ?? null,
        route_direction: profile.route_direction || '',
        travel_direction: profile.travel_direction || '',
        station_direction: profile.station_direction || 'geometry',
        station_interval_ft: profile.station_interval_ft ?? null,
        label_interval_ft: profile.label_interval_ft ?? null,
        centerline_offset_ft: profile.centerline_offset_ft ?? null,
        centerline_offset_side: profile.centerline_offset_side || '',
        label_offset_ft: profile.label_offset_ft ?? null,
        label_side: profile.label_side || '',
        clip_method: profile.clip_method || '',
        route_geometry_hash: profile.route_geometry_hash || '',
        created_by_widget: PROJECT_STATIONING_WIDGET_ID
    };
}

export function readRouteProfile(layer) {
    if (layer?._stationingProfile) return layer._stationingProfile;
    const feature = layer?.geojson?.features?.find((f) =>
        f?.properties?.created_by_widget === PROJECT_STATIONING_WIDGET_ID
    ) || layer?.geojson?.features?.[0];
    const props = feature?.properties || {};
    if (props.created_by_widget !== PROJECT_STATIONING_WIDGET_ID && !props.route_geometry_hash) {
        return null;
    }
    return {
        route_id: props.route_id || '',
        route_name: props.route_name || props.route_alias || layer?.name || '',
        source_layer_id: props.source_layer_id || '',
        source_feature_id: props.source_feature_id ?? '',
        stationed_centerline_layer_id: layer?.id || '',
        route_geometry_hash: props.route_geometry_hash || calculateGeometryHash(feature?.geometry),
        start_station_label: props.start_station_label || props.begin_station || props.station_begin || '',
        start_station_feet: Number(props.start_station_feet ?? props.station_begin_ft ?? 0),
        end_station_label: props.end_station_label || props.end_station || props.station_end || '',
        end_station_feet: Number(props.end_station_feet ?? props.station_end_ft ?? 0),
        total_length_ft: Number(props.total_length_ft ?? props.length_ft ?? 0),
        begin_milepost: props.begin_milepost != null ? Number(props.begin_milepost) : null,
        end_milepost: props.end_milepost != null ? Number(props.end_milepost) : null,
        route_direction: String(props.route_direction || props.ROUTE_DIRECTION || '').toUpperCase(),
        travel_direction: props.travel_direction || '',
        station_direction: props.station_direction || 'geometry',
        station_interval_ft: Number(props.station_interval_ft ?? props.interval_ft ?? 100),
        label_interval_ft: Number(props.label_interval_ft ?? props.interval_ft ?? 100),
        centerline_offset_ft: Number(props.centerline_offset_ft ?? 0),
        centerline_offset_side: String(props.centerline_offset_side || 'right').toLowerCase() === 'left'
            ? 'left'
            : 'right',
        label_offset_ft: Number(props.label_offset_ft ?? 35),
        label_side: String(props.label_side || 'right').toLowerCase() === 'left' ? 'left' : 'right',
        clip_method: props.clip_method || '',
        units: props.units || 'feet',
        created_date: props.created_date || props.created_at || '',
        created_by_widget: PROJECT_STATIONING_WIDGET_ID
    };
}

export function isProjectStationingCenterline(layer) {
    if (!layer || layer.type !== 'spatial') return false;
    if (layer._stationingProfile) return true;
    return Boolean(readRouteProfile(layer));
}

export function validateRouteProfile(layer, currentGeometry = null) {
    const profile = readRouteProfile(layer);
    if (!profile) {
        return { valid: false, warning: 'Route metadata is missing.' };
    }
    const geometry = currentGeometry || layer?.geojson?.features?.[0]?.geometry;
    if (geometry && profile.route_geometry_hash && profile.route_geometry_hash !== calculateGeometryHash(geometry)) {
        return {
            valid: false,
            profile,
            warning: 'This route geometry may have changed since stationing was created. Imported station points may not match the original stationing.'
        };
    }
    return { valid: true, profile, warning: '' };
}
