import { useMemo, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';

export function SpatialAnalyzerDialog({
    layers = [],
    relationOptions = [],
    onCancel,
    onDrawArea,
    onUseLayerArea,
    onRun,
    onAddResults,
    onAddArea
}) {
    const [targetLayerId, setTargetLayerId] = useState('');
    const [areaLayerId, setAreaLayerId] = useState('');
    const [analysisArea, setAnalysisArea] = useState(null);
    const [areaSource, setAreaSource] = useState(null);
    const [spatialRelation, setSpatialRelation] = useState(relationOptions[0]?.value || 'intersects');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const polygonLayers = useMemo(
        () => layers.filter((layer) => layer.hasPolygons),
        [layers]
    );

    const selectedRelationTip = useMemo(
        () => relationOptions.find((entry) => entry.value === spatialRelation)?.tip || '',
        [relationOptions, spatialRelation]
    );

    const drawArea = async (mode) => {
        setError('');
        setMessage('');
        try {
            const payload = await onDrawArea?.(mode);
            if (!payload?.analysisArea) return;
            setAnalysisArea(payload.analysisArea);
            setAreaSource(payload.areaSource || 'draw');
            setResult(null);
            setMessage('Area defined.');
        } catch (err) {
            setError(err?.message || 'Unable to define area.');
        }
    };

    const useLayerArea = async () => {
        setError('');
        setMessage('');
        try {
            const payload = await onUseLayerArea?.(areaLayerId);
            if (!payload?.analysisArea) return;
            setAnalysisArea(payload.analysisArea);
            setAreaSource(payload.areaSource || 'layer');
            setResult(null);
            setMessage('Area created from polygon layer.');
        } catch (err) {
            setError(err?.message || 'Unable to build area from layer.');
        }
    };

    const runAnalysis = async () => {
        setError('');
        setMessage('');
        setRunning(true);
        try {
            const output = await onRun?.({
                targetLayerId,
                analysisArea,
                areaSource,
                spatialRelation
            });
            setResult(output || null);
        } catch (err) {
            setError(err?.message || 'Analysis failed.');
        } finally {
            setRunning(false);
        }
    };

    const reset = () => {
        setResult(null);
        setAnalysisArea(null);
        setAreaSource(null);
        setError('');
        setMessage('');
    };

    if (result) {
        const relationLabel = relationOptions.find((entry) => entry.value === spatialRelation)?.label || spatialRelation;

        return (
            <WidgetPanelShell
                onCancel={onCancel}
                onRun={() => onAddResults?.(result)}
                runLabel="Add Results Layer"
                cancelLabel="Done"
                disabled={!result?.features?.length}
            >
                <div className="form-group">
                    <label>Results</label>
                    <div className="text-xs">
                        <div><strong>{result.matched}</strong> of <strong>{result.total}</strong> features matched</div>
                        <div>Spatial relation: {relationLabel}</div>
                        <div>Points: {result.stats?.points || 0}</div>
                        <div>Lines: {result.stats?.lines || 0}</div>
                        <div>Polygons: {result.stats?.polygons || 0}</div>
                        {result.stats?.totalLength ? <div>Total length: {result.stats.totalLength}</div> : null}
                        {result.stats?.totalArea ? <div>Total area: {result.stats.totalArea}</div> : null}
                    </div>
                </div>
                <div className="gis-widget__btn-row">
                    <button type="button" className="gis-widget__link-btn" onClick={reset}>
                        New search
                    </button>
                    {analysisArea ? (
                        <button
                            type="button"
                            className="gis-widget__link-btn"
                            onClick={() => onAddArea?.({ analysisArea, areaSource })}
                        >
                            Add area as layer
                        </button>
                    ) : null}
                </div>
            </WidgetPanelShell>
        );
    }

    const statusText = error || message || (analysisArea ? `Area ready (${areaSource || 'draw'})` : '');

    return (
        <WidgetPanelShell
            status={statusText}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            onRun={runAnalysis}
            runLabel="Find Features"
            running={running}
            disabled={running || !targetLayerId || !analysisArea}
        >
            <div className="form-group">
                <label>Target layer</label>
                <select value={targetLayerId} onChange={(e) => setTargetLayerId(e.target.value)}>
                    <option value="">- choose a layer -</option>
                    {layers.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                            {layer.name} ({layer.featureCount})
                        </option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label>Define search area</label>
                <div className="gis-widget__btn-row">
                    <button className="btn btn-secondary btn-sm" onClick={() => drawArea('rectangle')}>Draw Rectangle</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => drawArea('polygon')}>Draw Polygon</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => drawArea('circle')}>Draw Circle</button>
                </div>
                <div className="gis-widget__row" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <select value={areaLayerId} onChange={(e) => setAreaLayerId(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                        <option value="">- polygon layer -</option>
                        {polygonLayers.map((layer) => (
                            <option key={`poly-${layer.id}`} value={layer.id}>{layer.name}</option>
                        ))}
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={useLayerArea} disabled={!areaLayerId}>
                        Use Layer
                    </button>
                </div>
            </div>

            <div className="form-group">
                <label>Spatial relationship</label>
                <select value={spatialRelation} onChange={(e) => setSpatialRelation(e.target.value)}>
                    {relationOptions.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                </select>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>{selectedRelationTip}</div>
            </div>
        </WidgetPanelShell>
    );
}
