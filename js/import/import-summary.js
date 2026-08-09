/**
 * Build user-facing import result summary.
 */

/**
 * @param {{
 *   expanded: object[],
 *   totalFiltered?: number,
 *   featureFiltered?: number,
 *   errors: Array<{ file: string, error: Error }>,
 *   fenceBbox?: unknown,
 *   importGroups?: object[]
 * }} input
 */
export function buildImportSummary(input) {
    const {
        expanded = [],
        totalFiltered = 0,
        featureFiltered = 0,
        errors = [],
        fenceBbox = null,
        importGroups = []
    } = input;
    const warnings = expanded
        .filter((ds) => ds._importWarning)
        .map((ds) => ({ layer: ds.name, message: ds._importWarning }));

    const featureCount = expanded.reduce(
        (sum, ds) => sum + (ds.type === 'spatial' ? ds.geojson?.features?.length || 0 : ds.rows?.length || 0),
        0
    );

    const lines = [];
    const groupCount = importGroups.length;
    const layerCount = expanded.length;
    if (groupCount > 0 && layerCount > groupCount) {
        const groupedLayers = importGroups.reduce((n, g) => n + (g.childLayerIds?.length || 0), 0);
        const ungrouped = layerCount - groupedLayers;
        lines.push(
            `Imported ${groupCount} file group${groupCount !== 1 ? 's' : ''} (${groupedLayers} layers)`
            + (ungrouped > 0 ? ` and ${ungrouped} standalone layer${ungrouped !== 1 ? 's' : ''}` : '')
            + `, ${featureCount} feature(s)/row(s).`
        );
    } else {
        lines.push(`Imported ${layerCount} layer(s), ${featureCount} feature(s)/row(s).`);
    }
    if (fenceBbox && totalFiltered > 0) {
        lines.push(`${totalFiltered} feature(s) excluded by import fence.`);
    }
    if (featureFiltered > 0) {
        lines.push(`${featureFiltered} feature(s) excluded by pre-import filter.`);
    }
    if (warnings.length) {
        lines.push(`${warnings.length} layer warning(s).`);
    }
    if (errors.length) {
        lines.push(`${errors.length} file(s) failed.`);
    }

    return {
        lines,
        warnings,
        errors: errors.map((e) => ({ file: e.file, message: e.error?.message || String(e.error) })),
        featureCount,
        layerCount: expanded.length
    };
}

export function formatImportSummaryToast(summary) {
    return summary.lines.join(' ');
}

export default { buildImportSummary, formatImportSummaryToast };
