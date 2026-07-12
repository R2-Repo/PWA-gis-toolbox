/**
 * Professional plan export package builder.
 */

import { serializePlanProject } from '../../plan-project/serialization.js';
import { SYMBOL_REGISTRY } from '../../plan-project/symbology-registry.js';
import { createRevisionSnapshot } from '../../plan-project/revision-snapshot.js';
import { buildProjectExportPackage } from '../fiber-procurement-design/export-builder.js';
import { buildCalloutExportPackage } from '../plan-set-callouts/export-builder.js';
import { buildSheetExportPackage } from '../sheet-cutting/export-builder.js';
import { buildReadinessReportCsv } from './readiness-engine.js';

export const EXPORT_PROFILES = {
    preview: {
        id: 'preview',
        label: 'Preview package',
        description: 'GeoJSON layers and project bundle for staging review.',
        includeGeoJson: true,
        includeCsv: false,
        includeReadiness: true,
        includeSymbology: false,
        includeRevision: false
    },
    procurement: {
        id: 'procurement',
        label: 'Procurement bid package',
        description: 'Quantities, traceability, splice schedule, and design layers.',
        includeGeoJson: true,
        includeCsv: true,
        includeReadiness: true,
        includeSymbology: true,
        includeRevision: true
    },
    plan_set: {
        id: 'plan_set',
        label: 'Plan set package',
        description: 'Full plan set with sheets, callouts, symbology, and readiness report.',
        includeGeoJson: true,
        includeCsv: true,
        includeReadiness: true,
        includeSymbology: true,
        includeRevision: true,
        requireSheets: true,
        requireCallouts: true
    }
};

/**
 * @param {object} assembly
 * @returns {Set<string>}
 */
export function collectUsedSymbolKeys(assembly = {}) {
    const keys = new Set();

    const addFromGeoJson = (collection) => {
        for (const feature of collection?.features || []) {
            if (feature.properties?.symbol_key) keys.add(feature.properties.symbol_key);
        }
    };

    if (assembly.fiberExport?.geojson) {
        for (const layer of Object.values(assembly.fiberExport.geojson)) {
            addFromGeoJson(layer);
        }
    }

    for (const callout of assembly.calloutSession?.callouts?.definitions || []) {
        if (callout.symbolKey) keys.add(callout.symbolKey);
    }

    return keys;
}

/**
 * @param {Set<string>} usedKeys
 * @returns {object[]}
 */
export function buildSymbologyManifest(usedKeys = new Set()) {
    const keys = usedKeys.size ? [...usedKeys] : Object.keys(SYMBOL_REGISTRY);
    return keys.map((symbolKey) => ({
        symbolKey,
        ...(SYMBOL_REGISTRY[symbolKey] || { kind: 'unknown' })
    }));
}

/**
 * @param {object} assembly
 * @returns {string}
 */
export function buildSymbologyManifestCsv(assembly = {}) {
    const manifest = buildSymbologyManifest(collectUsedSymbolKeys(assembly));
    const rows = [['symbol_key', 'kind', 'color', 'shape', 'label_template']];
    for (const entry of manifest) {
        rows.push([
            entry.symbolKey,
            entry.kind || '',
            entry.color || '',
            entry.shape || '',
            entry.labelTemplate || ''
        ]);
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object} assembly
 * @returns {string}
 */
export function buildLayerManifestCsv(assembly = {}) {
    const rows = [['layer_name', 'feature_type', 'feature_count', 'source_widget']];
    const fiber = assembly.fiberExport?.geojson || {};
    for (const [layerName, collection] of Object.entries(fiber)) {
        rows.push([layerName, 'design', String(collection?.features?.length || 0), 'fiber-procurement-design']);
    }

    const calloutMarkers = assembly.calloutExport?.geojson?.calloutMarkers;
    if (calloutMarkers?.features?.length) {
        rows.push(['callout_markers', 'callout_marker', String(calloutMarkers.features.length), 'plan-set-callouts']);
    }

    const sheetFrames = assembly.sheetExport?.layers?.sheetFrames;
    if (sheetFrames?.features?.length) {
        rows.push(['sheet_frames', 'sheet_frame', String(sheetFrames.features.length), 'sheet-cutting']);
    }

    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object} assembly
 * @param {string} [profileId]
 * @returns {{ files: object[], manifest: object, revision: object|null }}
 */
export function buildProfessionalPlanExport(assembly = {}, profileId = 'procurement') {
    const profile = EXPORT_PROFILES[profileId] || EXPORT_PROFILES.procurement;
    const projectName = assembly.project?.projectName || 'plan_production';
    const safeName = projectName.replace(/[^\w.-]+/g, '_');
    const files = [];

    if (profile.requireSheets && !assembly.sheetSession) {
        throw new Error('Plan set profile requires a Sheet Cutter session.');
    }
    if (profile.requireCallouts && !assembly.calloutSession) {
        throw new Error('Plan set profile requires a Plan Set Callouts session.');
    }

    const masterBundle = serializePlanProject(assembly.project, {
        design: assembly.fiberSession?.design || {},
        callouts: assembly.calloutSession?.callouts || {},
        sheets: assembly.sheetSession?.sheets || {},
        quantities: assembly.fiberSession?.design?.quantities || {},
        metadata: {
            exportProfile: profile.id,
            readinessScore: assembly.readiness?.score ?? null,
            assembledAt: new Date().toISOString(),
            widgetsLinked: assembly.sources || {}
        }
    });

    files.push({
        filename: `${safeName}_project_bundle.json`,
        content: JSON.stringify(masterBundle, null, 2),
        mimeType: 'application/json',
        category: 'bundle'
    });

    if (profile.includeReadiness && assembly.readiness) {
        files.push({
            filename: `${safeName}_readiness_report.csv`,
            content: buildReadinessReportCsv(assembly.readiness.findings || []),
            mimeType: 'text/csv',
            category: 'report'
        });
        files.push({
            filename: `${safeName}_readiness_summary.json`,
            content: JSON.stringify({
                score: assembly.readiness.score,
                valid: assembly.readiness.valid,
                summary: assembly.readiness.summary
            }, null, 2),
            mimeType: 'application/json',
            category: 'report'
        });
    }

    if (profile.includeGeoJson && assembly.fiberExport?.geojson) {
        for (const [layerName, geojson] of Object.entries(assembly.fiberExport.geojson)) {
            if (!geojson?.features?.length) continue;
            files.push({
                filename: `${safeName}_${layerName}.geojson`,
                content: JSON.stringify(geojson, null, 2),
                mimeType: 'application/geo+json',
                category: 'geojson'
            });
        }
    }

    if (profile.includeCsv && assembly.fiberExport) {
        const csvMap = {
            quantity_summary: assembly.fiberExport.quantitySummaryCsv,
            quantity_traceability: assembly.fiberExport.quantityTraceabilityCsv,
            non_spatial_items: assembly.fiberExport.nonSpatialItemsCsv,
            splice_schedule: assembly.fiberExport.spliceScheduleCsv
        };
        for (const [name, content] of Object.entries(csvMap)) {
            if (!content) continue;
            files.push({
                filename: `${safeName}_${name}.csv`,
                content,
                mimeType: 'text/csv',
                category: 'csv'
            });
        }
    }

    if (profile.includeCsv && assembly.calloutExport?.csv) {
        for (const [name, content] of Object.entries(assembly.calloutExport.csv)) {
            if (!content) continue;
            files.push({
                filename: `${safeName}_callouts_${name}.csv`,
                content,
                mimeType: 'text/csv',
                category: 'csv'
            });
        }
    }

    if (profile.includeSymbology) {
        files.push({
            filename: `${safeName}_symbology_manifest.csv`,
            content: buildSymbologyManifestCsv(assembly),
            mimeType: 'text/csv',
            category: 'manifest'
        });
        files.push({
            filename: `${safeName}_layer_manifest.csv`,
            content: buildLayerManifestCsv(assembly),
            mimeType: 'text/csv',
            category: 'manifest'
        });
    }

    if (profile.includeGeoJson && assembly.calloutExport?.geojson) {
        for (const [layerName, geojson] of Object.entries(assembly.calloutExport.geojson)) {
            if (!geojson?.features?.length) continue;
            files.push({
                filename: `${safeName}_callouts_${layerName}.geojson`,
                content: JSON.stringify(geojson, null, 2),
                mimeType: 'application/geo+json',
                category: 'geojson'
            });
        }
    }

    if (profile.includeGeoJson && assembly.sheetExport?.layers) {
        for (const [layerName, geojson] of Object.entries({
            route: assembly.sheetExport.layers.route,
            sheet_frames: assembly.sheetExport.layers.sheetFrames,
            overview: assembly.sheetExport.layers.overview
        })) {
            if (!geojson?.features?.length) continue;
            files.push({
                filename: `${safeName}_sheets_${layerName}.geojson`,
                content: JSON.stringify(geojson, null, 2),
                mimeType: 'application/geo+json',
                category: 'geojson'
            });
        }

        for (const sheetLayer of assembly.sheetExport.layers.perSheet || []) {
            if (!sheetLayer.contents?.features?.length) continue;
            const sheetLabel = String(sheetLayer.sheetNumber).padStart(2, '0');
            files.push({
                filename: `${safeName}_sheet_${sheetLabel}.geojson`,
                content: JSON.stringify(sheetLayer.contents, null, 2),
                mimeType: 'application/geo+json',
                category: 'geojson'
            });
        }
    }

    let revision = null;
    if (profile.includeRevision && assembly.project) {
        revision = createRevisionSnapshot({
            project: assembly.project,
            design: assembly.fiberSession?.design || {},
            callouts: assembly.calloutSession?.callouts || {},
            sheets: assembly.sheetSession?.sheets || {},
            quantities: assembly.fiberSession?.design?.quantities || {},
            label: `${profile.label} export`,
            notes: `Readiness score: ${assembly.readiness?.score ?? 'n/a'}`
        });
        files.push({
            filename: `${safeName}_revision_snapshot.json`,
            content: JSON.stringify(revision, null, 2),
            mimeType: 'application/json',
            category: 'revision'
        });
    }

    return {
        files,
        manifest: {
            profile: profile.id,
            profileLabel: profile.label,
            fileCount: files.length,
            projectName,
            exportedAt: new Date().toISOString()
        },
        revision
    };
}

/**
 * @param {object} assembly
 * @returns {object}
 */
export function enrichAssemblyForExport(assembly = {}) {
    const fiberSession = assembly.fiberSession;
    const calloutSession = assembly.calloutSession;
    const sheetSession = assembly.sheetSession;

    return {
        ...assembly,
        fiberExport: fiberSession
            ? buildProjectExportPackage(
                fiberSession.project,
                fiberSession.design,
                fiberSession.catalog?.items || []
            )
            : null,
        calloutExport: calloutSession
            ? buildCalloutExportPackage(calloutSession)
            : null,
        sheetExport: sheetSession
            ? buildSheetExportPackage(sheetSession)
            : null
    };
}
