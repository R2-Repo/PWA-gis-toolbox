import { useEffect, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { PoleSectorOptimizerPanel } from './wireless-site-planning/PoleSectorOptimizerPanel.jsx';

const TOOLS = [
    {
        id: 'pole-sector-optimizer',
        label: 'Pole / Sector Coverage Optimizer',
        tip: 'Find the best pole locations and antenna sectors to cover client locations.'
    }
];

function LauncherView({ onSelectTool, onCancel }) {
    return (
        <WidgetPanelShell onCancel={onCancel} showRun={false}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {TOOLS.map((tool) => (
                    <span key={tool.id} className="geo-tool-btn">
                        <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => onSelectTool(tool.id)}
                        >
                            {tool.label}
                        </button>
                        <span className="geo-tip">{tool.tip}</span>
                    </span>
                ))}
            </div>
        </WidgetPanelShell>
    );
}

export function WirelessSitePlanningDialog({
    layers = [],
    unitOptions = [],
    closeWidget,
    onCancel,
    onCleanup,
    onValidateLocations,
    onStartDrawClientPoints,
    onStartDrawPolePoints,
    onStopPointDraw,
    onDownloadLocationsTemplate,
    onUpdateDrawPreview,
    onRun,
    onCreateOutputs
}) {
    const [activeTool, setActiveTool] = useState(null);
    const activeToolRef = useRef(null);
    const containerRef = useRef(null);
    activeToolRef.current = activeTool;

    useEffect(() => () => onCleanup?.(), [onCleanup]);

    useEffect(() => {
        const overlay = containerRef.current?.closest('.modal-overlay');
        if (!overlay) return undefined;

        overlay._interceptClose = () => {
            if (activeToolRef.current) {
                onCleanup?.();
                setActiveTool(null);
                return true;
            }
            return false;
        };

        return () => {
            delete overlay._interceptClose;
        };
    }, [onCleanup]);

    return (
        <div ref={containerRef}>
            {activeTool === 'pole-sector-optimizer' ? (
                <PoleSectorOptimizerPanel
                    layers={layers}
                    unitOptions={unitOptions}
                    onCancel={() => closeWidget?.() ?? onCancel?.()}
                    onValidateLocations={onValidateLocations}
                    onStartDrawClientPoints={onStartDrawClientPoints}
                    onStartDrawPolePoints={onStartDrawPolePoints}
                    onStopPointDraw={onStopPointDraw}
                    onDownloadLocationsTemplate={onDownloadLocationsTemplate}
                    onUpdateDrawPreview={onUpdateDrawPreview}
                    onRun={onRun}
                    onCreateOutputs={onCreateOutputs}
                />
            ) : (
                <LauncherView
                    onSelectTool={setActiveTool}
                    onCancel={() => closeWidget?.() ?? onCancel?.()}
                />
            )}
        </div>
    );
}
