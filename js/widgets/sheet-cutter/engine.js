/**
 * Sheet Cutter — pure engine for plan sheet extent generation along linear routes.
 */

export const WIDGET_ID = 'sheet-cutter';

export const ROTATION_MODES = {
    NORTH_UP: 'north-up',
    FOLLOW_CENTERLINE: 'follow-centerline'
};

export const SHEET_PRESETS = {
    LETTER_LANDSCAPE: {
        label: 'Letter landscape',
        orientation: 'landscape',
        usableFrameWidthIn: 9,
        usableFrameHeightIn: 6.5
    },
    TABLOID_LANDSCAPE: {
        label: 'Tabloid landscape',
        orientation: 'landscape',
        usableFrameWidthIn: 15,
        usableFrameHeightIn: 10
    },
    ARCH_D_LANDSCAPE: {
        label: 'ARCH D landscape',
        orientation: 'landscape',
        usableFrameWidthIn: 32,
        usableFrameHeightIn: 18
    },
    ARCH_E_LANDSCAPE: {
        label: 'ARCH E landscape',
        orientation: 'landscape',
        usableFrameWidthIn: 40,
        usableFrameHeightIn: 24
    },
    CUSTOM: {
        label: 'Custom',
        orientation: 'landscape',
        usableFrameWidthIn: null,
        usableFrameHeightIn: null
    }
};

export const LARGE_SHEET_COUNT_WARNING = 50;

function getTurf() {
    if (typeof globalThis !== 'undefined' && globalThis.turf) return globalThis.turf;
    if (typeof turf !== 'undefined') return turf;
    return null;
}

/**
 * @param {string|number} scale
 * @returns {{ label: string, feetPerInch: number }|null}
 */
export function parseScale(scale) {
    if (scale == null || scale === '') return null;

    const text = String(scale).trim();
    const ratioMatch = text.match(/^1\s*[:=]\s*(\d+(?:\.\d+)?)\s*$/i);
    if (ratioMatch) {
        const feetPerInch = Number(ratioMatch[1]);
        if (!Number.isFinite(feetPerInch) || feetPerInch <= 0) return null;
        return { label: `1:${feetPerInch}`, feetPerInch };
    }

    const inchMatch = text.match(/^1\s*in\s*=\s*(\d+(?:\.\d+)?)\s*ft$/i);
    if (inchMatch) {
        const feetPerInch = Number(inchMatch[1]);
        if (!Number.isFinite(feetPerInch) || feetPerInch <= 0) return null;
        return { label: `1in=${feetPerInch}ft`, feetPerInch };
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
        return { label: `1:${numeric}`, feetPerInch: numeric };
    }

    return null;
}

/**
 * @param {number} feet
 * @returns {string}
 */
export function formatStation(feet) {
    const num = Number(feet);
    if (!Number.isFinite(num)) return String(feet ?? '');

    const hundreds = Math.floor(num / 100);
    const remainder = num - hundreds * 100;
    const remainderStr = Math.abs(remainder - Math.round(remainder)) < 0.001
        ? String(Math.round(remainder)).padStart(2, '0')
        : remainder.toFixed(2).padStart(5, '0').replace(/^0/, '');

    return `${hundreds}+${remainderStr}`;
}

/**
 * @param {object} sheetOptions
 * @returns {{ frameWidthFt: number, frameHeightFt: number, scaleLabel: string }}
 */
export function resolveFrameDimensions(sheetOptions = {}) {
    const parsedScale = parseScale(sheetOptions.scale);
    const feetPerInch = parsedScale?.feetPerInch || 100;
    const scaleLabel = parsedScale?.label || String(sheetOptions.scale || '1:100');

    const preset = SHEET_PRESETS[sheetOptions.preset] || SHEET_PRESETS.CUSTOM;
    let frameWidthFt = Number(sheetOptions.usableFrameWidth);
    let frameHeightFt = Number(sheetOptions.usableFrameHeight);

    if (!Number.isFinite(frameWidthFt) || frameWidthFt <= 0) {
        frameWidthFt = (preset.usableFrameWidthIn || 32) * feetPerInch;
    }
    if (!Number.isFinite(frameHeightFt) || frameHeightFt <= 0) {
        frameHeightFt = (preset.usableFrameHeightIn || 18) * feetPerInch;
    }

    return { frameWidthFt, frameHeightFt, scaleLabel };
}

/**
 * @param {object} input
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSheetCutterInput(input) {
    const errors = [];
    const warnings = [];
    const options = input?.options || {};
    const features = input?.centerlineFeatures || [];

    if (!features.length) {
        errors.push('Select a centerline layer with line features.');
    }

    const hasLine = features.some((feature) => {
        const type = feature?.geometry?.type;
        return type === 'LineString' || type === 'MultiLineString';
    });
    if (features.length && !hasLine) {
        errors.push('Centerline layer must contain LineString or MultiLineString geometry.');
    }

    const { frameWidthFt, frameHeightFt } = resolveFrameDimensions(options.sheet || {});
    if (!Number.isFinite(frameWidthFt) || frameWidthFt <= 0) {
        errors.push('Sheet frame width must be greater than zero.');
    }
    if (!Number.isFinite(frameHeightFt) || frameHeightFt <= 0) {
        errors.push('Sheet frame height must be greater than zero.');
    }

    const parsedScale = parseScale(options.sheet?.scale);
    if (!parsedScale) {
        errors.push('Enter a valid map scale such as 1:100 or 1in=100ft.');
    }

    const overlap = Number(options.sheet?.overlap ?? 0);
    if (!Number.isFinite(overlap) || overlap < 0) {
        errors.push('Overlap must be zero or greater.');
    } else if (overlap >= frameWidthFt) {
        errors.push('Overlap must be smaller than the usable sheet length.');
    }

    const rotationMode = options.rotation?.mode || ROTATION_MODES.FOLLOW_CENTERLINE;
    if (!Object.values(ROTATION_MODES).includes(rotationMode)) {
        errors.push('Unsupported rotation mode.');
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * @param {object[]} features
 * @param {object} [options]
 * @returns {{ route: object|null, sourceFeatures: object[], warnings: string[] }}
 */
export function normalizeCenterlineGeometry(features = [], options = {}) {
    const warnings = [];
    const lineFeatures = features.filter((feature) => {
        const type = feature?.geometry?.type;
        return type === 'LineString' || type === 'MultiLineString';
    });

    if (!lineFeatures.length) {
        return { route: null, sourceFeatures: [], warnings: ['No line geometry found in selected features.'] };
    }

    const turf = getTurf();
    if (!turf) {
        return { route: null, sourceFeatures: lineFeatures, warnings: ['Geospatial library unavailable.'] };
    }

    const parts = [];
    for (const feature of lineFeatures) {
        if (feature.geometry.type === 'LineString') {
            parts.push({ coordinates: feature.geometry.coordinates, feature });
        } else {
            for (const line of feature.geometry.coordinates) {
                if (line?.length >= 2) {
                    parts.push({ coordinates: line, feature });
                }
            }
        }
    }

    if (parts.length > 1) {
        warnings.push('The selected route contains multiple disconnected line parts. Sheet order may be inaccurate.');
    }

    let mergedCoords = [];
    for (const part of parts) {
        if (!mergedCoords.length) {
            mergedCoords = [...part.coordinates];
            continue;
        }

        const last = mergedCoords[mergedCoords.length - 1];
        const first = part.coordinates[0];
        const joinDistance = turf.distance(turf.point(last), turf.point(first), { units: 'feet' });
        const skipFirst = joinDistance < 0.01 ? 1 : 0;
        if (joinDistance > 1) {
            warnings.push('Route parts may be disconnected; verify sheet order and direction.');
        }
        mergedCoords = mergedCoords.concat(part.coordinates.slice(skipFirst));
    }

    if (mergedCoords.length < 2) {
        return { route: null, sourceFeatures: lineFeatures, warnings: ['Route geometry is too short.'] };
    }

    let route = turf.lineString(mergedCoords, {
        source_feature_count: lineFeatures.length
    });

    if (options.reverseRoute) {
        route = turf.lineString([...mergedCoords].reverse(), route.properties || {});
    }

    return { route, sourceFeatures: lineFeatures, warnings };
}

/**
 * @param {object} route
 * @param {string} [units]
 * @returns {number}
 */
export function measureRoute(route, units = 'feet') {
    const turf = getTurf();
    if (!route?.geometry || !turf) return 0;
    return turf.length(route, { units });
}

/**
 * @param {number} routeLength
 * @param {number} sheetLength
 * @param {number} overlap
 * @returns {Array<{ stationStart: number, stationEnd: number }>}
 */
export function createSheetStations(routeLength, sheetLength, overlap) {
    const length = Number(routeLength) || 0;
    const step = Number(sheetLength) || 0;
    const lap = Math.max(0, Number(overlap) || 0);

    if (length <= 0 || step <= 0) return [];

    const stations = [];
    let start = 0;

    while (start < length - 0.001) {
        const end = Math.min(start + step, length);
        stations.push({ stationStart: start, stationEnd: end });
        if (end >= length - 0.001) break;
        start += Math.max(0.01, step - lap);
    }

    return stations;
}

/**
 * @param {object} route
 * @param {number} station
 * @returns {object|null}
 */
export function getRoutePointAtStation(route, station) {
    const turf = getTurf();
    if (!route?.geometry || !turf) return null;
    const distance = Math.max(0, Number(station) || 0);
    return turf.along(route, distance, { units: 'feet' });
}

/**
 * @param {object} route
 * @param {number} stationStart
 * @param {number} stationEnd
 * @param {string} mode
 * @returns {number}
 */
export function calculateSheetRotation(route, stationStart, stationEnd, mode = ROTATION_MODES.FOLLOW_CENTERLINE) {
    if (mode === ROTATION_MODES.NORTH_UP) return 0;

    const turf = getTurf();
    if (!route?.geometry || !turf) return 0;

    const midpoint = (Number(stationStart) + Number(stationEnd)) / 2;
    const totalLength = turf.length(route, { units: 'feet' });
    const lookAhead = Math.min(midpoint + 10, totalLength);
    const lookBehind = Math.max(midpoint - 10, 0);
    const ahead = turf.along(route, lookAhead, { units: 'feet' });
    const behind = turf.along(route, lookBehind, { units: 'feet' });
    return turf.bearing(behind, ahead);
}

/**
 * @param {object} centerPoint
 * @param {number} widthFt
 * @param {number} heightFt
 * @param {number} rotationDeg
 * @returns {object|null}
 */
export function createRotatedRectangle(centerPoint, widthFt, heightFt, rotationDeg) {
    const turf = getTurf();
    if (!centerPoint || !turf) return null;

    const center = centerPoint.geometry ? centerPoint : turf.point(centerPoint);
    const halfW = widthFt / 2;
    const halfH = heightFt / 2;
    const corners = [];

    for (const [wSign, hSign] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
        let corner = turf.destination(center, halfW * wSign, rotationDeg, { units: 'feet' });
        corner = turf.destination(corner, halfH * hSign, rotationDeg + 90, { units: 'feet' });
        corners.push(corner.geometry.coordinates);
    }

    return turf.polygon([corners]);
}

/**
 * @param {object} route
 * @param {number} stationStart
 * @param {number} stationEnd
 * @param {object} options
 * @returns {object|null}
 */
export function createSheetFrame(route, stationStart, stationEnd, options = {}) {
    const turf = getTurf();
    if (!route?.geometry || !turf) return null;

    const midpoint = (Number(stationStart) + Number(stationEnd)) / 2;
    const centerPoint = getRoutePointAtStation(route, midpoint);
    if (!centerPoint) return null;

    const rotationDeg = calculateSheetRotation(
        route,
        stationStart,
        stationEnd,
        options.rotationMode || ROTATION_MODES.FOLLOW_CENTERLINE
    );

    const polygon = createRotatedRectangle(
        centerPoint,
        options.frameWidthFt,
        options.frameHeightFt,
        rotationDeg
    );

    if (!polygon) return null;

    return {
        polygon,
        centerPoint,
        rotationDeg,
        stationStart,
        stationEnd
    };
}

/**
 * @param {string} prefix
 * @param {number} number
 * @param {number} [padLength]
 * @returns {string}
 */
export function formatSheetName(prefix = '', number = 1, padLength = 0) {
    const num = Number(number) || 0;
    const padded = padLength > 0 ? String(num).padStart(padLength, '0') : String(num);
    return `${prefix || ''}${padded}`;
}

/**
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function formatMatchlineLabel(template, values = {}) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

/**
 * @param {object} route
 * @param {Array<{ stationStart: number, stationEnd: number }>} stations
 * @param {object} options
 * @returns {object[]}
 */
export function createSheetFramesAlongRoute(route, stations = [], options = {}) {
    const frames = [];
    const numbering = options.numbering || {};
    const startNumber = Number(numbering.startNumber ?? 1);
    const increment = Number(numbering.increment ?? 1) || 1;
    const prefix = numbering.prefix ?? '';
    const padLength = Number(numbering.padLength ?? 0) || 0;

    stations.forEach((station, index) => {
        const frame = createSheetFrame(route, station.stationStart, station.stationEnd, options);
        if (!frame) return;

        const sheetNo = startNumber + index * increment;
        const sheetName = formatSheetName(prefix, sheetNo, padLength);
        const previousSheet = index > 0 ? frames[index - 1].sheet_name : null;
        const sheetId = sheetName;

        const entry = {
            sheet_id: sheetId,
            sheet_no: sheetNo,
            sheet_name: sheetName,
            sequence: index + 1,
            route_name: options.routeName || '',
            station_start: formatStation(station.stationStart + (options.startStation || 0)),
            station_end: formatStation(station.stationEnd + (options.startStation || 0)),
            station_start_ft: station.stationStart + (options.startStation || 0),
            station_end_ft: station.stationEnd + (options.startStation || 0),
            previous_sheet: previousSheet,
            next_sheet: null,
            rotation_deg: frame.rotationDeg,
            scale: options.scaleLabel || '',
            overlap_distance: options.overlapDistance ?? 0,
            frame_width: options.frameWidthFt,
            frame_height: options.frameHeightFt,
            source_layer_id: options.sourceLayerId || '',
            source_feature_id: options.sourceFeatureId || '',
            geometry: frame.polygon.geometry,
            center: frame.centerPoint.geometry.coordinates
        };

        if (index > 0) {
            frames[index - 1].next_sheet = sheetName;
        }

        frames.push(entry);
    });

    return frames;
}

/**
 * @param {object[]} sheetFrames
 * @param {object} route
 * @param {object} options
 * @returns {object[]}
 */
export function createMatchlines(sheetFrames = [], route, options = {}) {
    const turf = getTurf();
    if (!sheetFrames.length || !route?.geometry || !turf) return [];

    const matchlineOptions = options.matchlines || {};
    if (matchlineOptions.enabled === false) return [];

    const rotationMode = options.rotationMode || ROTATION_MODES.FOLLOW_CENTERLINE;
    const frameHeight = options.frameHeightFt || 100;
    const features = [];

    sheetFrames.forEach((sheet, index) => {
        const aheadSheet = sheetFrames[index + 1] || null;
        const backSheet = sheetFrames[index - 1] || null;

        if (aheadSheet) {
            const station = sheet.station_end_ft - (options.startStation || 0);
            const point = getRoutePointAtStation(route, station);
            const rotation = calculateSheetRotation(route, station - 1, station, rotationMode);
            const halfLen = frameHeight / 2;
            const start = turf.destination(point, halfLen, rotation + 90, { units: 'feet' });
            const end = turf.destination(point, halfLen, rotation - 90, { units: 'feet' });
            const label = formatMatchlineLabel(matchlineOptions.aheadTemplate || 'MATCHLINE - SEE SHEET {nextSheet}', {
                nextSheet: aheadSheet.sheet_name,
                previousSheet: backSheet?.sheet_name || '',
                sheet: sheet.sheet_name
            });

            features.push({
                matchline_id: `${sheet.sheet_id}-ahead`,
                sheet_id: sheet.sheet_id,
                match_type: 'ahead',
                match_to: aheadSheet.sheet_name,
                label,
                station: sheet.station_end,
                sequence: sheet.sequence,
                geometry: {
                    type: 'LineString',
                    coordinates: [start.geometry.coordinates, end.geometry.coordinates]
                }
            });
        }

        if (backSheet) {
            const station = sheet.station_start_ft - (options.startStation || 0);
            const point = getRoutePointAtStation(route, station);
            const rotation = calculateSheetRotation(route, station, station + 1, rotationMode);
            const halfLen = frameHeight / 2;
            const start = turf.destination(point, halfLen, rotation + 90, { units: 'feet' });
            const end = turf.destination(point, halfLen, rotation - 90, { units: 'feet' });
            const label = formatMatchlineLabel(matchlineOptions.backTemplate || 'MATCHLINE - SEE SHEET {previousSheet}', {
                nextSheet: aheadSheet?.sheet_name || '',
                previousSheet: backSheet.sheet_name,
                sheet: sheet.sheet_name
            });

            features.push({
                matchline_id: `${sheet.sheet_id}-back`,
                sheet_id: sheet.sheet_id,
                match_type: 'back',
                match_to: backSheet.sheet_name,
                label,
                station: sheet.station_start,
                sequence: sheet.sequence,
                geometry: {
                    type: 'LineString',
                    coordinates: [start.geometry.coordinates, end.geometry.coordinates]
                }
            });
        }
    });

    return features;
}

/**
 * @param {object[]} sheetFrames
 * @param {object} [options]
 * @returns {object[]}
 */
export function createSheetLabelPoints(sheetFrames = [], options = {}) {
    return sheetFrames.map((sheet) => ({
        sheet_id: sheet.sheet_id,
        sheet_name: sheet.sheet_name,
        sequence: sheet.sequence,
        station_start: sheet.station_start,
        station_end: sheet.station_end,
        rotation_deg: sheet.rotation_deg,
        geometry: {
            type: 'Point',
            coordinates: sheet.center
        }
    }));
}

/**
 * @param {object[]} sheetFrames
 * @param {object} [options]
 * @returns {object[]}
 */
export function createSheetIndexRows(sheetFrames = [], options = {}) {
    return sheetFrames.map((sheet) => ({
        sheet_id: sheet.sheet_id,
        sheet_no: sheet.sheet_no,
        sheet_name: sheet.sheet_name,
        sequence: sheet.sequence,
        route_name: sheet.route_name,
        station_start: sheet.station_start,
        station_end: sheet.station_end,
        previous_sheet: sheet.previous_sheet,
        next_sheet: sheet.next_sheet,
        rotation_deg: sheet.rotation_deg,
        scale: sheet.scale,
        overlap_distance: sheet.overlap_distance,
        frame_width: sheet.frame_width,
        frame_height: sheet.frame_height
    }));
}

/**
 * @param {object} input
 * @returns {{
 *   ok: boolean,
 *   route: object|null,
 *   sheetExtentFeatures: object[],
 *   matchlineFeatures: object[],
 *   sheetLabelFeatures: object[],
 *   sheetIndexRows: object[],
 *   warnings: string[],
 *   errors: string[],
 *   summary: object|null
 * }}
 */
export function runSheetCutter(input) {
    const validation = validateSheetCutterInput(input);
    if (!validation.valid) {
        return {
            ok: false,
            route: null,
            sheetExtentFeatures: [],
            matchlineFeatures: [],
            sheetLabelFeatures: [],
            sheetIndexRows: [],
            warnings: validation.warnings,
            errors: validation.errors,
            summary: null
        };
    }

    const options = input.options || {};
    const sheetOptions = options.sheet || {};
    const { frameWidthFt, frameHeightFt, scaleLabel } = resolveFrameDimensions(sheetOptions);
    const overlap = Number(sheetOptions.overlap ?? 0);
    const startStation = Number(options.startStation ?? 0) || 0;
    const rotationMode = options.rotation?.mode || ROTATION_MODES.FOLLOW_CENTERLINE;
    const warnings = [...validation.warnings];

    const normalized = normalizeCenterlineGeometry(input.centerlineFeatures || [], {
        reverseRoute: Boolean(options.reverseRoute)
    });
    warnings.push(...normalized.warnings);

    if (!normalized.route) {
        return {
            ok: false,
            route: null,
            sheetExtentFeatures: [],
            matchlineFeatures: [],
            sheetLabelFeatures: [],
            sheetIndexRows: [],
            warnings,
            errors: ['Unable to build a route from the selected centerline features.'],
            summary: null
        };
    }

    const routeLength = measureRoute(normalized.route, options.units || 'feet');
    if (routeLength <= 0) {
        return {
            ok: false,
            route: normalized.route,
            sheetExtentFeatures: [],
            matchlineFeatures: [],
            sheetLabelFeatures: [],
            sheetIndexRows: [],
            warnings,
            errors: ['Route length must be greater than zero.'],
            summary: null
        };
    }

    if (routeLength < frameWidthFt) {
        warnings.push('The route is shorter than one sheet. One sheet will be created.');
    }

    const stations = createSheetStations(routeLength, frameWidthFt, overlap);
    if (!stations.length) {
        return {
            ok: false,
            route: normalized.route,
            sheetExtentFeatures: [],
            matchlineFeatures: [],
            sheetLabelFeatures: [],
            sheetIndexRows: [],
            warnings,
            errors: ['No sheet stations could be generated.'],
            summary: null
        };
    }

    if (stations.length >= LARGE_SHEET_COUNT_WARNING) {
        warnings.push(`This will create ${stations.length} sheets. Large outputs may slow the browser.`);
    }

    const routeName = resolveRouteName(input.centerlineFeatures || [], options.routeNameField);

    const frameOptions = {
        frameWidthFt,
        frameHeightFt,
        rotationMode,
        scaleLabel,
        overlapDistance: overlap,
        startStation,
        routeName,
        numbering: options.numbering || {},
        sourceLayerId: options.sourceLayerId || '',
        sourceFeatureId: options.sourceFeatureId || ''
    };

    const sheetFrames = createSheetFramesAlongRoute(normalized.route, stations, frameOptions);

    const matchlineFeatures = createMatchlines(sheetFrames, normalized.route, {
        ...frameOptions,
        matchlines: options.matchlines || {}
    });

    const sheetLabelFeatures = createSheetLabelPoints(sheetFrames);
    const sheetIndexRows = createSheetIndexRows(sheetFrames);

    const sheetExtentFeatures = sheetFrames.map((sheet) => ({
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: sheet.geometry.coordinates
        },
        properties: {
            sheet_id: sheet.sheet_id,
            sheet_no: sheet.sheet_no,
            sheet_name: sheet.sheet_name,
            sequence: sheet.sequence,
            route_name: sheet.route_name,
            station_start: sheet.station_start,
            station_end: sheet.station_end,
            previous_sheet: sheet.previous_sheet,
            next_sheet: sheet.next_sheet,
            rotation_deg: sheet.rotation_deg,
            scale: sheet.scale,
            overlap_distance: sheet.overlap_distance,
            frame_width: sheet.frame_width,
            frame_height: sheet.frame_height,
            source_layer_id: sheet.source_layer_id,
            source_feature_id: sheet.source_feature_id
        }
    }));

    const matchlineGeoFeatures = matchlineFeatures.map((entry) => ({
        type: 'Feature',
        geometry: entry.geometry,
        properties: {
            matchline_id: entry.matchline_id,
            sheet_id: entry.sheet_id,
            match_type: entry.match_type,
            match_to: entry.match_to,
            label: entry.label,
            station: entry.station,
            sequence: entry.sequence
        }
    }));

    const sheetLabelGeoFeatures = sheetLabelFeatures.map((entry) => ({
        type: 'Feature',
        geometry: entry.geometry,
        properties: {
            sheet_id: entry.sheet_id,
            sheet_name: entry.sheet_name,
            sequence: entry.sequence,
            station_start: entry.station_start,
            station_end: entry.station_end,
            rotation_deg: entry.rotation_deg
        }
    }));

    return {
        ok: true,
        route: normalized.route,
        sheetExtentFeatures: sheetExtentFeatures,
        matchlineFeatures: matchlineGeoFeatures,
        sheetLabelFeatures: sheetLabelGeoFeatures,
        sheetIndexRows,
        warnings,
        errors: [],
        summary: {
            routeLengthFt: routeLength,
            sheetCount: sheetFrames.length,
            sheetLengthFt: frameWidthFt,
            overlapFt: overlap,
            firstSheet: sheetFrames[0]?.sheet_name || null,
            lastSheet: sheetFrames[sheetFrames.length - 1]?.sheet_name || null,
            scale: scaleLabel,
            rotationMode
        }
    };
}

/**
 * @param {object[]} features
 * @param {string|null|undefined} routeNameField
 * @returns {string}
 */
function resolveRouteName(features = [], routeNameField = null) {
    if (!routeNameField) return '';
    for (const feature of features) {
        const value = feature?.properties?.[routeNameField];
        if (value != null && String(value).trim()) {
            return String(value).trim();
        }
    }
    return '';
}
