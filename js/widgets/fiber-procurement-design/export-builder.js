/**
 * Export builder for fiber procurement design.
 */

import { buildFeatureLabel } from '../../plan-project/symbology-registry.js';

/**
 * @param {object} design
 * @returns {object}
 */
export function buildAlignmentGeoJson(design) {
    return {
        type: 'FeatureCollection',
        features: (design.alignments || []).map((alignment) => ({
            type: 'Feature',
            properties: {
                feature_type: 'alignment',
                alignment_id: alignment.alignmentId,
                alignment_name: alignment.alignmentName,
                route_name: alignment.routeName,
                symbol_key: alignment.symbolKey,
                label: buildFeatureLabel(alignment.symbolKey, alignment)
            },
            geometry: alignment.geometry
        }))
    };
}

/**
 * @param {object} design
 * @returns {object}
 */
export function buildConduitGeoJson(design) {
    return {
        type: 'FeatureCollection',
        features: (design.conduitSegments || []).map((segment) => ({
            type: 'Feature',
            properties: {
                feature_type: 'conduit_segment',
                segment_id: segment.segmentId,
                measured_length_ft: segment.measuredLength,
                installation_method: segment.installationMethod,
                existing_or_proposed: segment.existingOrProposed,
                start_station_label: segment.startStation != null ? String(segment.startStation) : '',
                end_station_label: segment.endStation != null ? String(segment.endStation) : '',
                symbol_key: segment.symbolKey,
                component_count: (segment.conduitComponents || []).length,
                label: (segment.conduitComponents || []).map((component) =>
                    `${component.ductCount} × ${component.diameter} ${component.productType}`
                ).join(', ')
            },
            geometry: segment.geometry
        }))
    };
}

/**
 * @param {object} design
 * @returns {object}
 */
export function buildFiberGeoJson(design) {
    return {
        type: 'FeatureCollection',
        features: (design.fibers || []).map((fiber) => ({
            type: 'Feature',
            properties: {
                feature_type: 'fiber',
                fiber_id: fiber.fiberId,
                cable_name: fiber.cableName,
                strand_count: fiber.strandCount,
                cable_type: fiber.cableType,
                measured_route_length_ft: fiber.measuredRouteLength,
                calculated_length_ft: fiber.calculatedLength,
                symbol_key: fiber.symbolKey,
                label: buildFeatureLabel(fiber.symbolKey, fiber)
            },
            geometry: fiber.geometry
        }))
    };
}

/**
 * @param {object} design
 * @returns {object}
 */
export function buildPointAssetGeoJson(design) {
    const structureFeatures = (design.structures || []).map((structure) => ({
        type: 'Feature',
        properties: {
            feature_type: 'structure',
            structure_id: structure.structureId,
            asset_type: structure.assetType,
            structure_name: structure.structureName,
            station_label: structure.station != null ? String(structure.station) : '',
            symbol_key: structure.symbolKey,
            label: buildFeatureLabel(structure.symbolKey, structure)
        },
        geometry: structure.geometry
    }));

    const pointAssets = (design.pointAssets || []).map((asset) => ({
        type: 'Feature',
        properties: {
            feature_type: 'point_asset',
            item_id: asset.itemId,
            asset_name: asset.assetName,
            symbol_key: asset.symbolKey || 'structure-junction-box'
        },
        geometry: asset.geometry
    }));

    return {
        type: 'FeatureCollection',
        features: [...structureFeatures, ...pointAssets]
    };
}

/**
 * @param {object[]} quantities
 * @param {object[]} catalogItems
 * @returns {string}
 */
export function buildQuantitySummaryCsv(quantities = [], catalogItems = []) {
    const header = [
        'quantity_id',
        'catalog_item_id',
        'contract_item_number',
        'description',
        'calculation_type',
        'measured_value',
        'final_quantity',
        'unit',
        'calculation_explanation',
        'manually_overridden',
        'design_feature_ids'
    ];

    const rows = quantities.map((record) => {
        const catalogItem = catalogItems.find((item) => item.catalogItemId === record.catalogItemId);
        return [
            record.quantityId,
            record.catalogItemId,
            catalogItem?.contractItemNumber || '',
            catalogItem?.description || '',
            record.calculationType,
            record.measuredValue,
            record.finalQuantity,
            record.measurementUnit,
            record.calculationExplanation,
            record.manuallyOverridden ? 'yes' : 'no',
            (record.designFeatureIds || []).join(';')
        ];
    });

    return [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
}

/**
 * @param {object} project
 * @param {object} design
 * @param {object[]} catalogItems
 * @returns {object}
 */
export function buildProjectExportPackage(project, design, catalogItems = []) {
    return {
        project,
        design,
        catalog: {
            catalogId: project.procurementCatalogId,
            version: project.procurementCatalogVersion,
            items: catalogItems
        },
        geojson: {
            alignments: buildAlignmentGeoJson(design),
            conduit: buildConduitGeoJson(design),
            fiber: buildFiberGeoJson(design),
            points: buildPointAssetGeoJson(design)
        },
        quantitySummaryCsv: buildQuantitySummaryCsv(design.quantities || [], catalogItems)
    };
}
