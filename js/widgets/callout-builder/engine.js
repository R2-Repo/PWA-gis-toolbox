/**
 * Callout Builder — pure engine.
 * Uses globalThis.turf for geometry (same pattern as spatial-analyzer).
 */

export const BOUNDARY_MODES = {
    WHOLE_LAYER: 'whole-layer',
    SELECTED_POLYGON: 'selected-polygon',
    SHEET_LAYER: 'sheet-layer'
};

export const NUMBERING_MODES = {
    PER_BOUNDARY: 'per-boundary',
    GLOBAL: 'global'
};

export const LEGEND_MODES = {
    FIELD_VALUE: 'field-value',
    FIELD_LABEL: 'field-label',
    TEMPLATE: 'template'
};

export const PLACEMENT_MODES = {
    NEAR_FEATURE: 'near-feature'
};

export const HIGH_CALLOUT_WARNING_THRESHOLD = 500;

const DEFAULT_OFFSET_METERS = 25;
const DEFAULT_STACK_SPACING_METERS = 20;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlankValue(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
}

/**
 * @param {object} feature
 * @param {number} [index]
 * @returns {string}
 */
export function getFeatureId(feature, index = 0) {
    const props = feature?.properties || {};
    return String(
        feature?.id
        ?? props.feature_id
        ?? props.id
        ?? props.OBJECTID
        ?? props.FID
        ?? `feature-${index}`
    );
}

/**
 * @param {object} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateCalloutBuilderInput(input = {}) {
    const errors = [];
    const warnings = [];

    const boundaryMode = input.boundary?.mode || BOUNDARY_MODES.WHOLE_LAYER;
    const sourceLayers = Array.isArray(input.sourceLayers) ? input.sourceLayers : [];

    if (!sourceLayers.length) {
        errors.push('Select at least one source layer.');
    }

    let hasCalloutField = false;
    for (const layerConfig of sourceLayers) {
        const fields = (layerConfig.calloutFields || []).filter((entry) => entry?.enabled !== false);
        if (!fields.length) {
            errors.push(`Choose at least one callout field for ${layerConfig.layerName || layerConfig.layerId || 'a source layer'}.`);
            continue;
        }
        hasCalloutField = true;

        const featureCount = layerConfig.features?.length ?? 0;
        if (featureCount === 0) {
            errors.push(`${layerConfig.layerName || layerConfig.layerId} has no features.`);
        }

        const schemaFields = new Set(layerConfig.availableFields || []);
        if (schemaFields.size > 0) {
            for (const fieldConfig of fields) {
                if (!schemaFields.has(fieldConfig.field)) {
                    errors.push(`Field "${fieldConfig.field}" does not exist on ${layerConfig.layerName || layerConfig.layerId}.`);
                }
            }
        }
    }

    if (sourceLayers.length && !hasCalloutField) {
        errors.push('Select at least one callout field.');
    }

    if (boundaryMode === BOUNDARY_MODES.SHEET_LAYER) {
        if (!input.boundary?.sheetLayerId) {
            errors.push('Select a sheet boundary layer.');
        }
        if (!input.boundary?.sheetIdField) {
            errors.push('Select a sheet ID field.');
        }
        const sheetFeatures = input.sheetFeatures || [];
        if (!sheetFeatures.length) {
            errors.push('Sheet boundary layer has no polygon features.');
        }
    }

    if (boundaryMode === BOUNDARY_MODES.SELECTED_POLYGON) {
        if (!input.boundary?.polygonFeature?.geometry) {
            errors.push('Select a polygon feature to use as the boundary.');
        }
    }

    const numberingMode = input.numbering?.mode;
    if (numberingMode && !Object.values(NUMBERING_MODES).includes(numberingMode)) {
        errors.push('Unsupported numbering mode.');
    }

    return { errors, warnings };
}

/**
 * @param {object} boundaryConfig
 * @param {object[]} [sheetFeatures]
 * @returns {object[]}
 */
export function normalizeBoundaryInput(boundaryConfig = {}, sheetFeatures = []) {
    const mode = boundaryConfig.mode || BOUNDARY_MODES.WHOLE_LAYER;

    if (mode === BOUNDARY_MODES.WHOLE_LAYER) {
        return [{
            boundaryId: 'global',
            boundaryName: 'All Features',
            sheetId: '',
            sheetName: '',
            sequence: 0,
            geometry: null
        }];
    }

    if (mode === BOUNDARY_MODES.SELECTED_POLYGON) {
        const feature = boundaryConfig.polygonFeature;
        const props = feature?.properties || {};
        const boundaryId = String(
            props.boundary_id
            ?? props.id
            ?? props.name
            ?? 'selected-boundary'
        );
        return [{
            boundaryId,
            boundaryName: String(props.name || props.boundary_name || boundaryId),
            sheetId: boundaryId,
            sheetName: String(props.name || boundaryId),
            sequence: 0,
            geometry: feature?.geometry || null
        }];
    }

    if (mode === BOUNDARY_MODES.SHEET_LAYER) {
        const idField = boundaryConfig.sheetIdField || 'sheet_id';
        const nameField = boundaryConfig.sheetNameField || 'sheet_name';
        const sequenceField = boundaryConfig.sequenceField || 'sequence';

        return sheetFeatures
            .filter((feature) => feature?.geometry)
            .map((feature, index) => {
                const props = feature.properties || {};
                const boundaryId = String(props[idField] ?? `sheet-${index + 1}`);
                const boundaryName = String(props[nameField] ?? boundaryId);
                const sequence = Number(props[sequenceField]);
                return {
                    boundaryId,
                    boundaryName,
                    sheetId: boundaryId,
                    sheetName: boundaryName,
                    sequence: Number.isFinite(sequence) ? sequence : index,
                    geometry: feature.geometry
                };
            })
            .sort((a, b) => a.sequence - b.sequence || String(a.boundaryId).localeCompare(String(b.boundaryId)));
    }

    return [{
        boundaryId: 'global',
        boundaryName: 'All Features',
        sheetId: '',
        sheetName: '',
        sequence: 0,
        geometry: null
    }];
}

/**
 * @param {object} feature
 * @param {object} boundary
 * @returns {boolean}
 */
export function featureIntersectsBoundary(feature, boundary) {
    if (!boundary?.geometry) return true;
    if (!feature?.geometry) return false;

    try {
        const boundaryFeature = turf.feature(boundary.geometry);
        const type = feature.geometry.type;

        if (type === 'Point') {
            return turf.booleanIntersects(feature, boundaryFeature);
        }
        if (type === 'MultiPoint') {
            return feature.geometry.coordinates.some((coord) =>
                turf.booleanIntersects(turf.point(coord), boundaryFeature)
            );
        }
        return turf.booleanIntersects(feature, boundaryFeature);
    } catch {
        try {
            const centroid = turf.centroid(feature);
            return turf.booleanIntersects(centroid, turf.feature(boundary.geometry));
        } catch {
            return false;
        }
    }
}

/**
 * @param {object} boundary
 * @param {object[]} sourceFeatures
 * @param {object} [options]
 * @returns {{ features: object[], skippedOutside: number, invalidGeometry: number }}
 */
export function getFeaturesForBoundary(boundary, sourceFeatures = [], options = {}) {
    const features = [];
    let skippedOutside = 0;
    let invalidGeometry = 0;

    sourceFeatures.forEach((feature, index) => {
        if (!feature?.geometry) {
            invalidGeometry += 1;
            return;
        }

        if (!featureIntersectsBoundary(feature, boundary)) {
            skippedOutside += 1;
            return;
        }

        features.push({ feature, featureIndex: index });
    });

    return { features, skippedOutside, invalidGeometry };
}

/**
 * @param {object} feature
 * @param {number} featureIndex
 * @param {object} layerConfig
 * @param {object} boundary
 * @returns {object[]}
 */
export function extractCalloutItemsFromFeature(feature, featureIndex, layerConfig, boundary) {
    const items = [];
    const props = feature.properties || {};
    const featureId = getFeatureId(feature, featureIndex);
    const groupId = `${boundary.boundaryId}:${layerConfig.layerId}:${featureId}`;
    const category = layerConfig.categoryField ? props[layerConfig.categoryField] : '';
    const priority = layerConfig.priorityField ? props[layerConfig.priorityField] : '';

    const calloutFields = (layerConfig.calloutFields || []).filter((entry) => entry?.enabled !== false);

    calloutFields.forEach((fieldConfig, fieldOrder) => {
        const value = props[fieldConfig.field];
        if (isBlankValue(value)) return;

        items.push({
            calloutItemId: `${groupId}:${fieldConfig.field}`,
            boundaryId: boundary.boundaryId,
            boundaryName: boundary.boundaryName,
            sheetId: boundary.sheetId || boundary.boundaryId,
            sheetName: boundary.sheetName || boundary.boundaryName,
            boundarySequence: boundary.sequence ?? 0,
            sourceLayerId: layerConfig.layerId,
            sourceLayerName: layerConfig.layerName || layerConfig.layerId,
            sourceFeatureId: featureId,
            sourceFeatureIndex: featureIndex,
            sourceField: fieldConfig.field,
            sourceFieldLabel: fieldConfig.label || fieldConfig.field,
            sourceValue: String(value),
            category: category == null ? '' : String(category),
            priority: priority == null ? '' : String(priority),
            groupId,
            layerOrder: layerConfig.layerOrder ?? 0,
            featureOrder: featureIndex,
            fieldOrder
        });
    });

    return items;
}

/**
 * @param {object} boundary
 * @param {object[]} matchedFeatures
 * @param {object[]} layerConfigs
 * @returns {{ items: object[], blankFieldSkips: number }}
 */
export function extractCalloutItemsForBoundary(boundary, matchedFeatures, layerConfigs) {
    const items = [];
    let blankFieldSkips = 0;

    for (const layerConfig of layerConfigs) {
        const layerMatches = matchedFeatures.filter((entry) => entry.layerId === layerConfig.layerId);

        for (const match of layerMatches) {
            const extracted = extractCalloutItemsFromFeature(
                match.feature,
                match.featureIndex,
                layerConfig,
                boundary
            );

            const enabledFieldCount = (layerConfig.calloutFields || []).filter((entry) => entry?.enabled !== false).length;
            if (!extracted.length && enabledFieldCount > 0) {
                blankFieldSkips += 1;
            }

            items.push(...extracted);
        }
    }

    return { items, blankFieldSkips };
}

/**
 * @param {object} item
 * @param {object} legendConfig
 * @returns {string}
 */
export function buildLegendText(item, legendConfig = {}) {
    const mode = legendConfig.mode || LEGEND_MODES.FIELD_VALUE;
    const value = item.sourceValue;
    const fieldLabel = item.sourceFieldLabel || item.sourceField;

    if (mode === LEGEND_MODES.FIELD_LABEL) {
        return `${fieldLabel}: ${value}`;
    }

    if (mode === LEGEND_MODES.TEMPLATE) {
        const template = legendConfig.template || '{value}';
        return template
            .replace(/\{value\}/g, value)
            .replace(/\{fieldLabel\}/g, fieldLabel)
            .replace(/\{sourceLayer\}/g, item.sourceLayerName || '')
            .replace(/\{sourceField\}/g, item.sourceField || '');
    }

    let text = value;
    if (legendConfig.includeSourceField) {
        text = `${fieldLabel}: ${text}`;
    }
    if (legendConfig.includeSourceLayer && item.sourceLayerName) {
        text = `${item.sourceLayerName} - ${text}`;
    }
    return text;
}

/**
 * @param {object[]} calloutItems
 * @returns {object[]}
 */
export function sortCalloutItems(calloutItems = []) {
    return [...calloutItems].sort((a, b) => {
        if (a.boundarySequence !== b.boundarySequence) {
            return a.boundarySequence - b.boundarySequence;
        }
        if (a.layerOrder !== b.layerOrder) {
            return a.layerOrder - b.layerOrder;
        }
        if (a.featureOrder !== b.featureOrder) {
            return a.featureOrder - b.featureOrder;
        }
        return a.fieldOrder - b.fieldOrder;
    });
}

/**
 * @param {object[]} calloutItems
 * @param {object} numberingConfig
 * @param {string} [numberingScope]
 * @returns {object[]}
 */
export function assignCalloutNumbers(calloutItems = [], numberingConfig = {}, numberingScope = 'per-boundary') {
    const sorted = sortCalloutItems(calloutItems);
    const startNumber = Number(numberingConfig.startNumber ?? 1);
    const increment = Number(numberingConfig.increment ?? 1) || 1;
    const mode = numberingConfig.mode || NUMBERING_MODES.PER_BOUNDARY;

    let currentNumber = startNumber;
    let currentBoundary = null;

    return sorted.map((item) => {
        if (mode === NUMBERING_MODES.GLOBAL || numberingScope === 'global') {
            if (currentBoundary === null) {
                currentBoundary = '__global__';
                currentNumber = startNumber;
            }
        } else if (item.boundaryId !== currentBoundary) {
            currentBoundary = item.boundaryId;
            currentNumber = startNumber;
        }

        const calloutNo = currentNumber;
        currentNumber += increment;

        const calloutLabel = String(calloutNo);
        const calloutId = item.boundaryId && item.boundaryId !== 'global'
            ? `${item.boundaryId}-${calloutNo}`
            : `callout-${calloutNo}`;

        return {
            ...item,
            calloutNo,
            calloutLabel,
            calloutId
        };
    });
}

/**
 * @param {object[]} calloutItems
 * @returns {Map<string, object[]>}
 */
export function groupCalloutsBySourceFeature(calloutItems = []) {
    const groups = new Map();
    for (const item of calloutItems) {
        const key = item.groupId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    for (const group of groups.values()) {
        group.sort((a, b) => a.fieldOrder - b.fieldOrder);
    }
    return groups;
}

/**
 * @param {object} feature
 * @returns {{ point: number[], targetType: string } | null}
 */
export function calculateFeatureAnchor(feature) {
    if (!feature?.geometry) return null;

    try {
        const type = feature.geometry.type;
        if (type === 'Point') {
            return { point: [...feature.geometry.coordinates], targetType: 'point' };
        }
        if (type === 'MultiPoint' && feature.geometry.coordinates.length) {
            return { point: [...feature.geometry.coordinates[0]], targetType: 'point' };
        }
        if (type === 'LineString' || type === 'MultiLineString') {
            const center = turf.center(feature);
            return { point: center.geometry.coordinates, targetType: 'line-midpoint' };
        }
        if (type === 'Polygon' || type === 'MultiPolygon') {
            try {
                const pointOnSurface = turf.pointOnFeature(feature);
                return { point: pointOnSurface.geometry.coordinates, targetType: 'polygon-surface' };
            } catch {
                const centroid = turf.centroid(feature);
                return { point: centroid.geometry.coordinates, targetType: 'polygon-centroid' };
            }
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * @param {object[]} calloutGroup
 * @param {object} sourceFeature
 * @param {object} boundary
 * @param {object} placementConfig
 * @returns {object[]}
 */
export function placeCalloutGroup(calloutGroup, sourceFeature, boundary, placementConfig = {}) {
    const anchor = calculateFeatureAnchor(sourceFeature);
    if (!anchor) return [];

    const stack = placementConfig.stackMultipleFromSameFeature !== false;
    const spacingMeters = Number(placementConfig.bubbleSpacing ?? DEFAULT_STACK_SPACING_METERS) || DEFAULT_STACK_SPACING_METERS;
    const baseOffsetMeters = Number(placementConfig.baseOffsetMeters ?? DEFAULT_OFFSET_METERS) || DEFAULT_OFFSET_METERS;
    const anchorPoint = turf.point(anchor.point);

    const placed = [];
    const groupSize = calloutGroup.length;

    calloutGroup.forEach((item, index) => {
        let bubblePoint = anchorPoint;

        if (groupSize === 1 || !stack) {
            bubblePoint = turf.destination(anchorPoint, baseOffsetMeters, 45, { units: 'meters' });
        } else {
            const stackOffset = baseOffsetMeters + (index * spacingMeters);
            bubblePoint = turf.destination(anchorPoint, stackOffset, 45, { units: 'meters' });
        }

        placed.push({
            ...item,
            anchorPoint: anchor.point,
            leaderTargetType: anchor.targetType,
            bubbleCoordinates: bubblePoint.geometry.coordinates
        });
    });

    return placed;
}

/**
 * @param {object[]} placedCallouts
 * @returns {object[]}
 */
export function createLeaderLines(placedCallouts = []) {
    return placedCallouts
        .filter((item) => item.anchorPoint && item.bubbleCoordinates)
        .map((item) => ({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [item.bubbleCoordinates, item.anchorPoint]
            },
            properties: {
                callout_id: item.calloutId,
                callout_no: item.calloutNo,
                boundary_id: item.boundaryId,
                sheet_id: item.sheetId,
                source_layer_id: item.sourceLayerId,
                source_feature_id: item.sourceFeatureId,
                group_id: item.groupId,
                leader_target_type: item.leaderTargetType || 'feature-anchor'
            }
        }));
}

/**
 * @param {object[]} numberedCallouts
 * @param {object} legendConfig
 * @returns {object[]}
 */
export function createLegendRows(numberedCallouts = [], legendConfig = {}) {
    return numberedCallouts.map((item) => ({
        boundary_id: item.boundaryId,
        boundary_name: item.boundaryName,
        sheet_id: item.sheetId,
        sheet_name: item.sheetName,
        callout_no: item.calloutNo,
        callout_label: item.calloutLabel,
        legend_text: item.legendText || buildLegendText(item, legendConfig),
        source_layer_name: item.sourceLayerName,
        source_feature_id: item.sourceFeatureId,
        source_field: item.sourceField,
        category: item.category,
        priority: item.priority,
        sequence: item.calloutNo
    }));
}

/**
 * @param {object[]} placedCallouts
 * @param {object} legendConfig
 * @returns {object[]}
 */
export function createCalloutBubbleFeatures(placedCallouts = [], legendConfig = {}) {
    return placedCallouts.map((item) => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: item.bubbleCoordinates
        },
        properties: {
            callout_id: item.calloutId,
            callout_no: item.calloutNo,
            callout_label: item.calloutLabel,
            boundary_id: item.boundaryId,
            boundary_name: item.boundaryName,
            sheet_id: item.sheetId,
            sheet_name: item.sheetName,
            source_layer_id: item.sourceLayerId,
            source_layer_name: item.sourceLayerName,
            source_feature_id: item.sourceFeatureId,
            source_field: item.sourceField,
            source_field_label: item.sourceFieldLabel,
            legend_text: item.legendText || buildLegendText(item, legendConfig),
            category: item.category,
            priority: item.priority,
            sequence: item.calloutNo,
            group_id: item.groupId
        }
    }));
}

/**
 * @param {object} input
 * @returns {object}
 */
export function runCalloutBuilder(input = {}) {
    const validation = validateCalloutBuilderInput(input);
    if (validation.errors.length) {
        return {
            calloutBubbleFeatures: [],
            leaderLineFeatures: [],
            legendRows: [],
            auditRows: [],
            warnings: validation.warnings,
            errors: validation.errors,
            summary: null
        };
    }

    const warnings = [...validation.warnings];
    const auditRows = [];
    const boundaryMode = input.boundary?.mode || BOUNDARY_MODES.WHOLE_LAYER;
    const boundaries = normalizeBoundaryInput(input.boundary, input.sheetFeatures || []);
    const layerConfigs = (input.sourceLayers || []).map((layer, index) => ({
        ...layer,
        layerOrder: index
    }));

    const numberingConfig = {
        mode: input.numbering?.mode
            || (boundaryMode === BOUNDARY_MODES.WHOLE_LAYER
                ? NUMBERING_MODES.GLOBAL
                : NUMBERING_MODES.PER_BOUNDARY),
        startNumber: input.numbering?.startNumber ?? 1,
        increment: input.numbering?.increment ?? 1
    };

    const legendConfig = input.legend || { mode: LEGEND_MODES.FIELD_VALUE };
    const placementConfig = input.placement || { mode: PLACEMENT_MODES.NEAR_FEATURE };
    const includeLeaders = input.placement?.leaderLines !== false;

    const allCalloutItems = [];
    let sourceFeaturesScanned = 0;
    let blankFieldSkips = 0;
    let invalidGeometry = 0;
    let skippedOutside = 0;
    const multiBoundaryFeatures = new Set();

    for (const boundary of boundaries) {
        const boundaryMatches = [];

        for (const layerConfig of layerConfigs) {
            const features = layerConfig.features || [];
            sourceFeaturesScanned += features.length;

            const { features: matched, skippedOutside: outsideCount, invalidGeometry: invalidCount } =
                getFeaturesForBoundary(boundary, features);

            skippedOutside += outsideCount;
            invalidGeometry += invalidCount;

            for (const entry of matched) {
                boundaryMatches.push({
                    ...entry,
                    layerId: layerConfig.layerId
                });

                if (boundaryMode === BOUNDARY_MODES.SHEET_LAYER) {
                    const featureKey = `${layerConfig.layerId}:${getFeatureId(entry.feature, entry.featureIndex)}`;
                    const boundaryKey = `${featureKey}:${boundary.boundaryId}`;
                    if (multiBoundaryFeatures.has(featureKey) && !multiBoundaryFeatures.has(boundaryKey)) {
                        // tracked below after all boundaries processed
                    }
                    multiBoundaryFeatures.add(boundaryKey);
                }
            }

            for (const entry of features) {
                if (!entry?.geometry) {
                    auditRows.push({
                        source_layer_name: layerConfig.layerName,
                        source_feature_id: getFeatureId(entry, 0),
                        status: 'skipped_invalid_geometry',
                        reason: 'Feature has no geometry.',
                        callout_count: 0,
                        boundary_id: boundary.boundaryId
                    });
                }
            }
        }

        const extracted = extractCalloutItemsForBoundary(boundary, boundaryMatches, layerConfigs);
        blankFieldSkips += extracted.blankFieldSkips;
        allCalloutItems.push(...extracted.items);
    }

  // Detect features appearing on multiple sheets
    if (boundaryMode === BOUNDARY_MODES.SHEET_LAYER) {
        const featureSheetCounts = new Map();
        for (const item of allCalloutItems) {
            const key = `${item.sourceLayerId}:${item.sourceFeatureId}`;
            const sheets = featureSheetCounts.get(key) || new Set();
            sheets.add(item.boundaryId);
            featureSheetCounts.set(key, sheets);
        }
        let multiSheetCount = 0;
        for (const sheets of featureSheetCounts.values()) {
            if (sheets.size > 1) multiSheetCount += 1;
        }
        if (multiSheetCount > 0) {
            warnings.push(`${multiSheetCount} feature${multiSheetCount === 1 ? '' : 's'} intersect multiple sheets. They will be called out on each intersecting sheet.`);
        }
    }

    const numberedItems = assignCalloutNumbers(allCalloutItems, numberingConfig);
    const numberedWithLegend = numberedItems.map((item) => ({
        ...item,
        legendText: buildLegendText(item, legendConfig)
    }));

    const groups = groupCalloutsBySourceFeature(numberedWithLegend);
    const featureLookup = new Map();

    for (const boundary of boundaries) {
        for (const layerConfig of layerConfigs) {
            const { features: matched } = getFeaturesForBoundary(boundary, layerConfig.features || []);
            for (const entry of matched) {
                const featureId = getFeatureId(entry.feature, entry.featureIndex);
                const key = `${boundary.boundaryId}:${layerConfig.layerId}:${featureId}`;
                featureLookup.set(key, entry.feature);
            }
        }
    }

    const placedCallouts = [];
    for (const [groupId, groupItems] of groups.entries()) {
        const sample = groupItems[0];
        const sourceFeature = featureLookup.get(groupId);
        if (!sourceFeature) continue;

        const boundary = boundaries.find((entry) => entry.boundaryId === sample.boundaryId) || boundaries[0];
        placedCallouts.push(...placeCalloutGroup(groupItems, sourceFeature, boundary, placementConfig));
    }

    const sortedPlaced = sortCalloutItems(placedCallouts).map((item, index) => {
        const numbered = numberedWithLegend.find((entry) => entry.calloutItemId === item.calloutItemId);
        return numbered ? { ...item, ...numbered } : item;
    });

    if (!sortedPlaced.length) {
        warnings.push('No callouts were created. Check that selected fields contain values.');
    }

    if (sortedPlaced.length >= HIGH_CALLOUT_WARNING_THRESHOLD) {
        warnings.push(`This will create ${sortedPlaced.length.toLocaleString()} callouts. Large callout layers may slow the browser.`);
    }

    if (invalidGeometry > 0) {
        warnings.push(`${invalidGeometry} source feature${invalidGeometry === 1 ? '' : 's'} had invalid geometry and were skipped.`);
    }

    warnings.push('Automatic placement is a first draft. Review and adjust bubbles as needed.');

    const calloutBubbleFeatures = createCalloutBubbleFeatures(sortedPlaced, legendConfig);
    const leaderLineFeatures = includeLeaders ? createLeaderLines(sortedPlaced) : [];
    const legendRows = createLegendRows(sortedPlaced, legendConfig);

    for (const layerConfig of layerConfigs) {
        const layerItems = sortedPlaced.filter((item) => item.sourceLayerId === layerConfig.layerId);
        const includedFeatures = new Set(layerItems.map((item) => item.sourceFeatureId));

        (layerConfig.features || []).forEach((feature, index) => {
            const featureId = getFeatureId(feature, index);
            const itemCount = layerItems.filter((item) => item.sourceFeatureId === featureId).length;
            if (itemCount > 0) {
                auditRows.push({
                    source_layer_name: layerConfig.layerName,
                    source_feature_id: featureId,
                    status: 'included',
                    reason: '',
                    callout_count: itemCount,
                    boundary_id: layerItems.find((item) => item.sourceFeatureId === featureId)?.boundaryId || ''
                });
            } else if (!includedFeatures.has(featureId)) {
                auditRows.push({
                    source_layer_name: layerConfig.layerName,
                    source_feature_id: featureId,
                    status: skippedOutside > 0 ? 'skipped_outside_boundary' : 'skipped_blank_fields',
                    reason: skippedOutside > 0 ? 'Feature is outside the selected boundary.' : 'No non-empty selected callout fields.',
                    callout_count: 0,
                    boundary_id: ''
                });
            }
        });
    }

    return {
        calloutBubbleFeatures,
        leaderLineFeatures,
        legendRows,
        auditRows,
        warnings: [...new Set(warnings)],
        errors: [],
        summary: {
            boundaryCount: boundaries.length,
            sourceLayerCount: layerConfigs.length,
            sourceFeaturesScanned,
            calloutCount: sortedPlaced.length,
            blankFieldSkips,
            skippedOutside,
            invalidGeometry,
            perBoundaryCounts: boundaries.map((boundary) => ({
                boundaryId: boundary.boundaryId,
                boundaryName: boundary.boundaryName,
                calloutCount: sortedPlaced.filter((item) => item.boundaryId === boundary.boundaryId).length
            }))
        }
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function buildCalloutBuilderPreview(input = {}) {
    return runCalloutBuilder(input);
}
