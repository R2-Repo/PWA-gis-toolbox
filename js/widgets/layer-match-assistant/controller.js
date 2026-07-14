import { createTableDataset } from '../../core/data-model.js';
import { representativePoint } from '../../tools/feature-distance.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    MATCH_STATUS,
    STRICTNESS_OPTIONS,
    SPATIAL_TOLERANCE_PRESETS,
    buildLayerMatchPreview,
    parseCoordinate,
    runLayerMatch,
    tolerancePresetToFeet,
    validateLayerMatchInput
} from './engine.js';

const OUTPUT_KEYS = {
    confirmed: 'confirmed',
    likely: 'likely',
    possible: 'possible',
    unmatchedA: 'unmatchedA',
    unmatchedB: 'unmatchedB',
    conflicts: 'conflicts',
    reviewTable: 'reviewTable'
};

const STATUS_STYLES = {
    [MATCH_STATUS.CONFIRMED]: { strokeColor: '#22c55e', fillColor: '#22c55e' },
    [MATCH_STATUS.LIKELY]: { strokeColor: '#84cc16', fillColor: '#84cc16' },
    [MATCH_STATUS.POSSIBLE]: { strokeColor: '#eab308', fillColor: '#eab308' },
    [MATCH_STATUS.CONFLICT]: { strokeColor: '#ef4444', fillColor: '#ef4444' },
    [MATCH_STATUS.NO_MATCH]: { strokeColor: '#94a3b8', fillColor: '#94a3b8' }
};

function getLayerById(ctx, layerId) {
    return ctx.getLayers().find((layer) => layer.id === layerId) || null;
}

function buildMatchRecords(layer, config, side) {
    const features = layer?.geojson?.features || [];
    const useGeometry = side === 'a' ? config.layerAUseGeometry : config.layerBUseGeometry;
    const latField = side === 'a' ? config.layerALatField : config.layerBLatField;
    const lonField = side === 'a' ? config.layerALonField : config.layerBLonField;
    const nameField = side === 'a' ? config.layerANameField : config.layerBNameField;

    return features.map((feature, featureIndex) => {
        const props = feature?.properties || {};
        let lat = null;
        let lon = null;

        if (useGeometry !== false && feature?.geometry) {
            const coords = representativePoint(feature, 'centroid');
            if (coords) {
                lon = coords[0];
                lat = coords[1];
            }
        } else {
            lat = parseCoordinate(props[latField]);
            lon = parseCoordinate(props[lonField]);
        }

        const fields = {};
        (config.optionalFieldPairs || []).forEach((pair) => {
            const key = side === 'a' ? pair.fieldA : pair.fieldB;
            if (key) fields[key] = props[key];
        });

        return {
            uid: `${layer.id}:${featureIndex}`,
            lat,
            lon,
            name: nameField ? props[nameField] : '',
            featureIndex,
            fields,
            properties: props,
            feature
        };
    });
}

function buildRunInput(ctx, config) {
    const layerA = getLayerById(ctx, config.layerAId);
    const layerB = getLayerById(ctx, config.layerBId);
    if (!layerA || !layerB) {
        throw new Error('Choose two valid layers.');
    }
    if (layerA.id === layerB.id) {
        throw new Error('Layer A and Layer B must be different.');
    }

    const toleranceFeet = tolerancePresetToFeet(config.tolerancePreset, config.customToleranceFeet);
    const layerARecords = buildMatchRecords(layerA, config, 'a');
    const layerBRecords = buildMatchRecords(layerB, config, 'b');
    const options = {
        toleranceFeet,
        strictness: config.strictness || 'balanced',
        textOnly: config.textOnly === true,
        nameFieldsSelected: Boolean(config.layerANameField && config.layerBNameField),
        optionalFieldPairs: config.optionalFieldPairs || [],
        weights: config.weights
    };

    const validation = validateLayerMatchInput({
        layerA: layerARecords,
        layerB: layerBRecords,
        options
    });
    if (validation.errors.length) {
        throw new Error(validation.errors[0]);
    }

    return {
        recordsA: layerARecords,
        recordsB: layerBRecords,
        options,
        validation,
        sourceLayerA: layerA,
        sourceLayerB: layerB
    };
}

function pointFeature(lon, lat, properties = {}) {
    if (lon == null || lat == null) return null;
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties
    };
}

function lineFeature(aLon, aLat, bLon, bLat, properties = {}) {
    if ([aLon, aLat, bLon, bLat].some((value) => value == null)) return null;
    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: [[aLon, aLat], [bLon, bLat]]
        },
        properties
    };
}

function buildMatchPreviewGeojson(results, layerAName, layerBName) {
    const features = [];
    (results.matches || []).forEach((match, idx) => {
        const style = STATUS_STYLES[match.match_status] || STATUS_STYLES[MATCH_STATUS.POSSIBLE];
        const line = lineFeature(match.a_lon, match.a_lat, match.b_lon, match.b_lat, {
            match_index: idx,
            match_status: match.match_status,
            final_score: match.final_score,
            match_reason: match.match_reason,
            layer_a: layerAName,
            layer_b: layerBName,
            ...style
        });
        if (line) features.push(line);
    });
    return { type: 'FeatureCollection', features };
}

function buildFocusedPreviewGeojson(match, layerAName, layerBName) {
    if (!match) return null;
    const features = [];
    const aPoint = pointFeature(match.a_lon, match.a_lat, {
        label: match.a_name || 'Layer A',
        side: 'A',
        layer: layerAName
    });
    const bPoint = pointFeature(match.b_lon, match.b_lat, {
        label: match.b_name || 'Layer B',
        side: 'B',
        layer: layerBName
    });
    const line = lineFeature(match.a_lon, match.a_lat, match.b_lon, match.b_lat, {
        match_status: match.match_status,
        distance_feet: match.distance_feet,
        final_score: match.final_score,
        match_reason: match.match_reason
    });
    if (aPoint) features.push(aPoint);
    if (bPoint) features.push(bPoint);
    if (line) features.push(line);
    return { type: 'FeatureCollection', features };
}

function effectiveStatus(match) {
    if (match.user_decision === 'approved') return MATCH_STATUS.APPROVED;
    if (match.user_decision === 'rejected') return MATCH_STATUS.REJECTED;
    return match.match_status;
}

function filterMatchesForOutput(matches = []) {
    return matches.filter((match) => match.user_decision !== 'rejected');
}

function addDerivedLayer(ctx, name, fc, options = {}) {
    const dataset = ctx.createSpatialDataset(name, fc, {
        format: 'derived',
        widget: 'layer-match-assistant',
        ...(options.source || {})
    });
    ctx.addLayer(dataset);
    const index = ctx.getLayers().indexOf(dataset);
    if (options.style) {
        ctx.mapService.setLayerStyle?.(dataset.id, options.style);
    }
    ctx.mapService.addLayer(dataset, index, { fit: options.fit ?? false });
    return dataset;
}

function matchRowsToFeatures(matches = [], prefix = 'match') {
    return matches.flatMap((match) => {
        const props = {
            source_a_uid: match.source_a_uid,
            source_b_uid: match.source_b_uid,
            a_name: match.a_name,
            b_name: match.b_name,
            distance_feet: match.distance_feet,
            spatial_score: match.spatial_score,
            name_score: match.name_score,
            optional_field_score: match.optional_field_score,
            final_score: match.final_score,
            match_status: effectiveStatus(match),
            match_reason: match.match_reason,
            user_decision: match.user_decision
        };
        const features = [];
        const aPoint = pointFeature(match.a_lon, match.a_lat, { ...props, side: 'A' });
        const bPoint = pointFeature(match.b_lon, match.b_lat, { ...props, side: 'B' });
        const line = lineFeature(match.a_lon, match.a_lat, match.b_lon, match.b_lat, props);
        if (aPoint) features.push(aPoint);
        if (bPoint) features.push(bPoint);
        if (line) features.push(line);
        return features;
    });
}

function recordToPointFeature(record, side) {
    return pointFeature(record.lon, record.lat, {
        uid: record.uid,
        name: record.name,
        side,
        ...(record.properties || {})
    });
}

function buildReviewTableRows(results) {
    return (results.matches || []).map((match) => ({
        source_a_uid: match.source_a_uid,
        source_b_uid: match.source_b_uid,
        a_name: match.a_name,
        b_name: match.b_name,
        distance_feet: match.distance_feet,
        spatial_score: match.spatial_score,
        name_score: match.name_score,
        optional_field_score: match.optional_field_score,
        final_score: match.final_score,
        match_status: match.match_status,
        match_reason: match.match_reason,
        user_decision: match.user_decision
    }));
}

export async function openLayerMatchAssistant(ctx) {
    let previewHandle = null;

    await openReactIsland({
        title: 'Layer Match Assistant',
        width: '580px',
        mountPath: '../../../react/widgets/mountLayerMatchAssistantDialog.jsx',
        mountExport: 'mountLayerMatchAssistantDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            strictnessOptions: STRICTNESS_OPTIONS,
            tolerancePresets: SPATIAL_TOLERANCE_PRESETS,
            onCancel: () => {
                previewHandle?.clear?.();
                close();
            },
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onPreview: async (config) => {
                const input = buildRunInput(ctx, config);
                return buildLayerMatchPreview({
                    layerA: input.recordsA,
                    layerB: input.recordsB,
                    options: input.options
                });
            },
            onValidate: async (config) => {
                const input = buildRunInput(ctx, config);
                return {
                    warnings: input.validation.warnings,
                    summary: {
                        layerAName: input.sourceLayerA.name,
                        layerBName: input.sourceLayerB.name,
                        layerACount: input.recordsA.length,
                        layerBCount: input.recordsB.length
                    }
                };
            },
            onRun: async (config, handlers = {}) => {
                const input = buildRunInput(ctx, config);
                const result = await runLayerMatch(
                    {
                        layerA: input.recordsA,
                        layerB: input.recordsB,
                        options: input.options
                    },
                    handlers
                );
                if (result.cancelled) {
                    ctx.showToast?.('Layer matching cancelled', 'warning');
                    return result;
                }

                previewHandle = {
                    clear: () => ctx.mapService.showTempFeature?.(null, 0)
                };

                const previewGeojson = buildMatchPreviewGeojson(
                    result,
                    input.sourceLayerA.name,
                    input.sourceLayerB.name
                );
                ctx.mapService.showTempFeature?.(previewGeojson, 0);

                return {
                    ...result,
                    layerAName: input.sourceLayerA.name,
                    layerBName: input.sourceLayerB.name,
                    layerAId: input.sourceLayerA.id,
                    layerBId: input.sourceLayerB.id,
                    warnings: [...(input.validation.warnings || []), ...(result.warnings || [])]
                };
            },
            onRowFocus: (match, meta = {}) => {
                if (!match) return;
                const focused = buildFocusedPreviewGeojson(
                    match,
                    meta.layerAName,
                    meta.layerBName
                );
                if (focused) {
                    ctx.mapService.showTempFeature?.(focused, 0);
                }
            },
            onAddOutputs: (results, selectedOutputs = {}, config = {}) => {
                const selected = selectedOutputs || {};
                const baseName = `${results.layerAName}_vs_${results.layerBName}`;
                const matches = results.matches || [];
                const approvedMatches = filterMatchesForOutput(matches);
                let created = 0;

                const pick = (key) => selected[key] !== false;

                if (pick(OUTPUT_KEYS.confirmed)) {
                    const rows = approvedMatches.filter((match) => {
                        const status = effectiveStatus(match);
                        return status === MATCH_STATUS.CONFIRMED
                            || status === MATCH_STATUS.APPROVED
                            || (match.user_decision === 'approved' && match.match_status !== MATCH_STATUS.CONFLICT);
                    });
                    if (rows.length) {
                        addDerivedLayer(ctx, `${baseName} Confirmed Matches`, {
                            type: 'FeatureCollection',
                            features: matchRowsToFeatures(rows)
                        }, { fit: created === 0, style: { mode: 'simple', ...STATUS_STYLES[MATCH_STATUS.CONFIRMED], strokeWidth: 2 } });
                        created++;
                    }
                }

                if (pick(OUTPUT_KEYS.likely)) {
                    const rows = approvedMatches.filter((match) => match.match_status === MATCH_STATUS.LIKELY);
                    if (rows.length) {
                        addDerivedLayer(ctx, `${baseName} Likely Matches`, {
                            type: 'FeatureCollection',
                            features: matchRowsToFeatures(rows)
                        }, { fit: created === 0, style: { mode: 'simple', ...STATUS_STYLES[MATCH_STATUS.LIKELY], strokeWidth: 2 } });
                        created++;
                    }
                }

                if (pick(OUTPUT_KEYS.possible)) {
                    const rows = approvedMatches.filter((match) => match.match_status === MATCH_STATUS.POSSIBLE);
                    if (rows.length) {
                        addDerivedLayer(ctx, `${baseName} Possible Matches`, {
                            type: 'FeatureCollection',
                            features: matchRowsToFeatures(rows)
                        }, { fit: created === 0, style: { mode: 'simple', ...STATUS_STYLES[MATCH_STATUS.POSSIBLE], strokeWidth: 2 } });
                        created++;
                    }
                }

                if (pick(OUTPUT_KEYS.unmatchedA)) {
                    const features = (results.unmatchedA || [])
                        .map((record) => recordToPointFeature(record, 'A'))
                        .filter(Boolean);
                    if (features.length) {
                        addDerivedLayer(ctx, `${baseName} Unmatched A`, {
                            type: 'FeatureCollection',
                            features
                        }, { fit: created === 0, style: { mode: 'simple', strokeColor: '#64748b', fillColor: '#64748b' } });
                        created++;
                    }
                }

                if (pick(OUTPUT_KEYS.unmatchedB)) {
                    const features = (results.unmatchedB || [])
                        .map((record) => recordToPointFeature(record, 'B'))
                        .filter(Boolean);
                    if (features.length) {
                        addDerivedLayer(ctx, `${baseName} Unmatched B`, {
                            type: 'FeatureCollection',
                            features
                        }, { fit: created === 0, style: { mode: 'simple', strokeColor: '#475569', fillColor: '#475569' } });
                        created++;
                    }
                }

                if (pick(OUTPUT_KEYS.conflicts)) {
                    const rows = matches.filter((match) => match.match_status === MATCH_STATUS.CONFLICT);
                    if (rows.length) {
                        addDerivedLayer(ctx, `${baseName} Conflicts`, {
                            type: 'FeatureCollection',
                            features: matchRowsToFeatures(rows)
                        }, { fit: created === 0, style: { mode: 'simple', ...STATUS_STYLES[MATCH_STATUS.CONFLICT], strokeWidth: 2 } });
                        created++;
                    }
                }

                if (pick(OUTPUT_KEYS.reviewTable)) {
                    const table = createTableDataset(
                        `${baseName} Match Review`,
                        buildReviewTableRows(results),
                        null,
                        { format: 'layer-match-review', widget: 'layer-match-assistant' }
                    );
                    ctx.addLayer(table);
                    created++;
                }

                ctx.refreshUI?.();
                ctx.showToast?.(
                    created > 0
                        ? `Added ${created} match output${created === 1 ? '' : 's'}.`
                        : 'No outputs selected or no rows matched the selected categories.',
                    created > 0 ? 'success' : 'info'
                );
                previewHandle?.clear?.();
            }
        })
    });
}

export { OUTPUT_KEYS };
