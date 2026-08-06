import { useState } from 'react';
import { CrsPicker } from '../widgets/shared/CrsPicker.jsx';
import { WidgetPanelShell } from '../widgets/shared/WidgetPanelShell.jsx';
import { crsLabel } from '../../js/crs/registry.js';

const MAP_TARGET_CRS = 'EPSG:4326';
const MAP_TARGET_LABEL = 'WGS 84 (EPSG:4326)';

export function ReprojectDialog({
    layerName = '',
    sourceCrs = 'EPSG:4326',
    displayReady = false,
    crsWarning = '',
    sourceCrsError = '',
    onCancel,
    onApply
}) {
    const [fromCrs, setFromCrs] = useState(sourceCrs);
    const [toCrs, setToCrs] = useState(MAP_TARGET_CRS);
    const [outputName, setOutputName] = useState('');

    const canRun = !sourceCrsError;
    const runLabel = displayReady ? 'Reproject to WGS 84' : 'Reproject for map display';

    return (
        <WidgetPanelShell
            status={sourceCrsError || (layerName ? `Layer: ${layerName}` : '')}
            statusTone={sourceCrsError ? 'danger' : 'muted'}
            onCancel={onCancel}
            onRun={() => onApply?.({ fromCrs, toCrs, name: outputName || undefined })}
            runLabel={runLabel}
            disabled={!canRun}
        >
            {displayReady ? (
                <p className="text-sm text-muted mb-8">
                    This layer already uses map-ready coordinates. Reprojection is usually not needed
                    unless you want a different coordinate system — use Advanced options below.
                </p>
            ) : (
                <p className="text-sm text-muted mb-8">
                    Use this when a layer has projected coordinates (UTM, State Plane, etc.) and does not
                    display correctly on the map. Reprojecting creates a new copy in {MAP_TARGET_LABEL}.
                </p>
            )}

            {crsWarning && !displayReady ? (
                <p className="text-xs text-muted mb-8">{crsWarning}</p>
            ) : null}

            <div className="form-group">
                <label>From</label>
                <p className="text-sm" style={{ margin: 0 }}>{crsLabel(fromCrs)}</p>
            </div>
            <div className="form-group">
                <label>To</label>
                <p className="text-sm" style={{ margin: 0 }}>
                    {toCrs === MAP_TARGET_CRS ? MAP_TARGET_LABEL : crsLabel(toCrs)}
                </p>
            </div>

            <details className="mb-8">
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    Advanced options
                </summary>
                <div style={{ marginTop: 12 }}>
                    <CrsPicker
                        label={`Source (${crsLabel(fromCrs)})`}
                        value={fromCrs}
                        onChange={setFromCrs}
                        variant="compact"
                    />
                    <CrsPicker
                        label="Target coordinate system"
                        value={toCrs}
                        onChange={setToCrs}
                        variant="compact"
                    />
                    <div className="form-group">
                        <label>Output layer name (optional)</label>
                        <input
                            type="text"
                            value={outputName}
                            onChange={(e) => setOutputName(e.target.value)}
                            placeholder="Auto-generated"
                        />
                    </div>
                </div>
            </details>
        </WidgetPanelShell>
    );
}
