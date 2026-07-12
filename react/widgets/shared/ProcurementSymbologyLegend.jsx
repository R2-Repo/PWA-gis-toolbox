import { useMemo } from 'react';
import { getSymbologyCatalogGrouped } from '../../../js/widgets/fiber-procurement-design/procurement-symbology.js';
import { getSymbolDefinition } from '../../../js/plan-project/symbology-registry.js';
import { renderProcurementIcon } from '../../../js/plan-project/symbol-icons.js';

function LineSwatch({ symbolKey, label }) {
    const def = getSymbolDefinition(symbolKey);
    if (!def || def.kind !== 'line') {
        return (
            <div className="proc-symbology__item">
                <span className="proc-symbology__label">{label}</span>
            </div>
        );
    }

    const width = Math.max(2, def.width || 2);
    const dash = def.dash?.length ? def.dash.join(',') : '';
    const casingWidth = def.casing ? width + 2 : width;

    return (
        <div className="proc-symbology__item">
            <svg className="proc-symbology__line-swatch" viewBox="0 0 72 16" aria-hidden="true">
                {def.casing ? (
                    <line
                        x1="4"
                        y1="8"
                        x2="68"
                        y2="8"
                        stroke={def.casing.color}
                        strokeWidth={casingWidth}
                        strokeLinecap="round"
                    />
                ) : null}
                <line
                    x1="4"
                    y1="8"
                    x2="68"
                    y2="8"
                    stroke={def.color}
                    strokeWidth={width}
                    strokeDasharray={dash || undefined}
                    strokeLinecap="round"
                />
            </svg>
            <span className="proc-symbology__label">{label}</span>
        </div>
    );
}

function PointSwatch({ symbolKey, label }) {
    const def = getSymbolDefinition(symbolKey);
    const iconId = def?.icon || symbolKey;
    const svgMarkup = renderProcurementIcon(iconId, {
        stroke: def?.accentColor || '#334155',
        fill: def?.accentColor || '#64748b'
    });

    return (
        <div className="proc-symbology__item">
            {svgMarkup ? (
                <span
                    className="proc-symbology__point-swatch"
                    dangerouslySetInnerHTML={{ __html: svgMarkup }}
                />
            ) : (
                <span className="proc-symbology__point-fallback" />
            )}
            <span className="proc-symbology__label">{label}</span>
        </div>
    );
}

function SymbologyItem({ item }) {
    if (item.geometryKind === 'line') {
        return <LineSwatch symbolKey={item.symbolKey} label={item.label} />;
    }
    return <PointSwatch symbolKey={item.symbolKey} label={item.label} />;
}

/**
 * Reference legend for procurement design symbology by category.
 */
export function ProcurementSymbologyLegend({ compact = false }) {
    const groups = useMemo(() => getSymbologyCatalogGrouped(), []);

    return (
        <div className={`proc-symbology${compact ? ' proc-symbology--compact' : ''}`}>
            <div className="proc-symbology__header">
                <strong>Design symbology</strong>
                <span className="proc-symbology__subtitle">
                    Placeholder catalog — labels may change when the official CSV is loaded.
                </span>
            </div>
            {groups.map((group) => (
                <section key={group.id} className="proc-symbology__group">
                    <h4 className="proc-symbology__group-title">{group.label}</h4>
                    <div className="proc-symbology__grid">
                        {group.items.map((item) => (
                            <SymbologyItem key={item.itemId} item={item} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
