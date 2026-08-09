import { useMemo } from 'react';
import { getLayerInfoSummary } from '../../js/core/layer-info.js';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

export function DataPreviewSection({ layer, onShowDataTable }) {
    const rows = useMemo(() => getLayerInfoSummary(layer), [layer]);

    return (
        <CollapsibleSection title="Data Preview" defaultOpen={false}>
            <div className="layer-info-grid">
                {rows.map((row) => (
                    <div key={row.id}>
                        <div className="layer-info-row">
                            <span className="layer-info-label">{row.label}</span>
                            <span className="layer-info-value">{row.value}</span>
                        </div>
                        {row.warning ? (
                            <div className="layer-info-warning text-warning text-xs">{row.warning}</div>
                        ) : null}
                    </div>
                ))}
            </div>
            <hr className="layer-info-divider" />
            <button className="btn btn-sm btn-secondary w-full" onClick={onShowDataTable}>
                Browse attribute table
            </button>
        </CollapsibleSection>
    );
}
