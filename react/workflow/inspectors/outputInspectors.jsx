import React, { useCallback, useMemo } from 'react';
import { getAvailableFormats } from '../../../js/export/exporter.js';
import { pickDefaultExportFormatKey } from '../../../js/workflow/export-node-utils.js';
import {
    HintText,
    InspectorInput,
    InspectorLabel,
    InspectorSelect
} from './shared.jsx';

export function PreviewInspector({ config, onConfigChange }) {
    return (
        <>
            <InspectorLabel>Max Preview Rows</InspectorLabel>
            <InspectorInput
                type="number"
                value={config.maxRows ?? 500}
                min={10}
                max={10000}
                step={10}
                onChange={(value) => onConfigChange({
                    maxRows: parseInt(value, 10) || 500
                })}
            />
            <HintText>Data appears in the bottom preview panel after running.</HintText>
        </>
    );
}

export function AddToMapInspector({ config, onConfigChange }) {
    return (
        <>
            <InspectorLabel>Layer Name</InspectorLabel>
            <InspectorInput
                value={config.layerName ?? ''}
                placeholder="Auto-generated if blank"
                onChange={(value) => onConfigChange({ layerName: value })}
            />
            <HintText>Updates the existing layer on re-run, or creates a new one.</HintText>
        </>
    );
}

export function ExportInspector({ node, config, onConfigChange, engine, getLayers }) {
    const layersFn = useCallback(() => getLayers?.() || [], [getLayers]);

    const upstream = useMemo(() => {
        if (!engine || !node) return null;
        return engine.getUpstreamOutputForPort(node.id, 'in', { getLayers: layersFn })
            || engine.getUpstreamOutput(node.id, { getLayers: layersFn });
    }, [engine, node, layersFn]);

    const formats = useMemo(
        () => (upstream ? getAvailableFormats(upstream) : getAvailableFormats({
            type: 'spatial',
            schema: { geometryType: 'Point' }
        })),
        [upstream]
    );

    const formatKeys = formats.map((f) => f.key);
    const currentFormat = formatKeys.includes(config.format)
        ? config.format
        : (upstream ? pickDefaultExportFormatKey(upstream) : (config.format || 'geojson'));

    const onFormatChange = (format) => {
        onConfigChange({ format });
    };

    return (
        <>
            <InspectorLabel>Export Format</InspectorLabel>
            <InspectorSelect
                value={currentFormat}
                onChange={onFormatChange}
            >
                {formats.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                ))}
            </InspectorSelect>
            {!upstream && (
                <HintText>Connect input data to see formats for your dataset type.</HintText>
            )}

            <InspectorLabel>File Name</InspectorLabel>
            <InspectorInput
                value={config.filename ?? ''}
                placeholder={upstream?.name ? upstream.name.replace(/\.[^./\\]+$/, '') : 'Uses layer name if blank'}
                onChange={(value) => onConfigChange({ filename: value })}
            />
            <HintText>Extension is added automatically for the chosen format.</HintText>

            {currentFormat === 'shapefile' && (
                <>
                    <InspectorLabel>Shapefile CRS</InspectorLabel>
                    <InspectorInput
                        value={config.targetCrs ?? ''}
                        placeholder={upstream?.schema?.crs || 'EPSG:4326'}
                        onChange={(value) => onConfigChange({ targetCrs: value })}
                    />
                    <HintText>Target coordinate system for the .shp output (default EPSG:4326).</HintText>
                </>
            )}
        </>
    );
}

export const INSPECTORS = {
    preview: PreviewInspector,
    'add-to-map': AddToMapInspector,
    export: ExportInspector
};
