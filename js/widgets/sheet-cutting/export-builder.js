/**
 * Export builder for sheet cutting.
 */

/**
 * @param {object} sheet
 * @param {object} routeLine
 * @returns {object|null}
 */
export function buildSheetFramePolygon(sheet, routeLine) {
    if (!routeLine?.geometry || typeof turf === 'undefined') return null;

    const centerDistance = sheet.centerDistanceFt ?? 0;
    const centerPoint = turf.along(routeLine, centerDistance, { units: 'feet' });
    const lookAhead = Math.min(centerDistance + 10, turf.length(routeLine, { units: 'feet' }));
    const lookBehind = Math.max(centerDistance - 10, 0);
    const ahead = turf.along(routeLine, lookAhead, { units: 'feet' });
    const behind = turf.along(routeLine, lookBehind, { units: 'feet' });
    const bearing = turf.bearing(behind, ahead);

    const halfWidthFt = (sheet.mapFrameWidthFt || 100) / 2;
    const halfHeightFt = (sheet.mapFrameHeightFt || 75) / 2;
    const corners = [
        turf.destination(centerPoint, Math.hypot(halfWidthFt, halfHeightFt), bearing - 45, { units: 'feet' }),
        turf.destination(centerPoint, Math.hypot(halfWidthFt, halfHeightFt), bearing + 45, { units: 'feet' }),
        turf.destination(centerPoint, Math.hypot(halfWidthFt, halfHeightFt), bearing + 135, { units: 'feet' }),
        turf.destination(centerPoint, Math.hypot(halfWidthFt, halfHeightFt), bearing - 135, { units: 'feet' }),
        turf.destination(centerPoint, Math.hypot(halfWidthFt, halfHeightFt), bearing - 45, { units: 'feet' })
    ];

    return {
        type: 'Feature',
        properties: {
            feature_type: 'sheet_frame',
            sheet_id: sheet.sheetId,
            sheet_number: sheet.sheetNumber,
            sheet_type: sheet.sheetType || 'detail',
            center_distance_ft: centerDistance,
            rotation_deg: sheet.rotationDeg ?? bearing,
            start_distance_ft: sheet.startDistanceFt,
            end_distance_ft: sheet.endDistanceFt
        },
        geometry: {
            type: 'Polygon',
            coordinates: [corners.map((point) => point.geometry.coordinates)]
        }
    };
}

/**
 * @param {object[]} sheets
 * @param {object} routeLine
 * @returns {object}
 */
export function buildSheetFramesGeoJson(sheets = [], routeLine = null) {
    const features = sheets
        .filter((sheet) => sheet.sheetType !== 'overview')
        .map((sheet) => buildSheetFramePolygon(sheet, routeLine))
        .filter(Boolean);

    return { type: 'FeatureCollection', features };
}

/**
 * @param {object} overviewSheet
 * @param {object} routeLine
 * @returns {object}
 */
export function buildOverviewGeoJson(overviewSheet, routeLine = null) {
    const features = [];

    if (routeLine?.geometry) {
        features.push({
            type: 'Feature',
            properties: {
                feature_type: 'overview_route',
                sheet_number: 0
            },
            geometry: routeLine.geometry
        });
    }

    for (const box of overviewSheet?.sheetBoxes || []) {
        features.push({
            type: 'Feature',
            properties: {
                feature_type: 'overview_sheet_box',
                sheet_id: box.sheetId,
                sheet_number: box.sheetNumber,
                center_distance_ft: box.centerDistanceFt
            },
            geometry: {
                type: 'Point',
                coordinates: routeLine?.geometry
                    ? turf.along(routeLine, box.centerDistanceFt || 0, { units: 'feet' }).geometry.coordinates
                    : [0, 0]
            }
        });
    }

    return { type: 'FeatureCollection', features };
}

/**
 * @param {object[]} matchLines
 * @returns {string}
 */
export function buildMatchLineCsv(matchLines = []) {
    const rows = [['sheet_id', 'match_line_station', 'adjacent_sheet_number', 'label']];
    for (const line of matchLines) {
        rows.push([
            line.sheetId || '',
            String(line.matchLineStation ?? ''),
            String(line.adjacentSheetNumber ?? ''),
            line.label || ''
        ]);
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object[]} sheets
 * @returns {string}
 */
export function buildSheetIndexCsv(sheets = []) {
    const rows = [['sheet_number', 'sheet_id', 'sheet_type', 'start_distance_ft', 'end_distance_ft', 'center_distance_ft']];
    for (const sheet of sheets) {
        rows.push([
            String(sheet.sheetNumber ?? ''),
            sheet.sheetId || '',
            sheet.sheetType || 'detail',
            String(sheet.startDistanceFt ?? ''),
            String(sheet.endDistanceFt ?? ''),
            String(sheet.centerDistanceFt ?? '')
        ]);
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildSheetExportPackage(session) {
    const sheetSet = session.sheets || {};
    const detailSheets = (sheetSet.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');

    return {
        projectName: session.project?.projectName || 'Sheet Cutter',
        sheetCount: detailSheets.length,
        csv: {
            sheetIndex: buildSheetIndexCsv(detailSheets),
            matchLines: buildMatchLineCsv(sheetSet.matchLines || [])
        },
        geojson: {
            route: session.routeLine?.geometry
                ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { feature_type: 'route' }, geometry: session.routeLine.geometry }] }
                : { type: 'FeatureCollection', features: [] },
            sheetFrames: buildSheetFramesGeoJson(detailSheets, session.routeLine),
            overview: buildOverviewGeoJson(sheetSet.overviewSheet, session.routeLine)
        }
    };
}
