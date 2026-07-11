import { useMemo, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { DESIGN_STEPS, STRUCTURE_TYPES } from '../../js/widgets/fiber-procurement-design/engine.js';

function formatFeet(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value)).toLocaleString()} ft`;
}

export function FiberProcurementDesignDialog({
    stationingLayers = [],
    initialSession,
    structureTypes = [],
    onCancel,
    onCreateProject,
    onSelectStationing,
    onLoadCatalog,
    onDrawAlignment,
    onPlaceStructure,
    onConfigureSegment,
    onGenerateFiber,
    onPlacePointAsset,
    onPlaceSplice,
    onConfigureSplice,
    onAddBranchCable,
    onGetSpliceSchedule,
    spliceModeOptions = [],
    onExportPackage,
    onAddDesignLayers,
    onValidate,
    onSaveSession
}) {
    const [step, setStep] = useState(1);
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [projectNumber, setProjectNumber] = useState(initialSession?.project?.projectNumber || '');
    const [stationingLayerId, setStationingLayerId] = useState(initialSession?.project?.stationingRouteLayerId || '');
    const [selectedSegmentId, setSelectedSegmentId] = useState('');
    const [installationMethod, setInstallationMethod] = useState('directional_bore');
    const [ductCount, setDuctCount] = useState('2');
    const [diameter, setDiameter] = useState('2-inch');
    const [productType, setProductType] = useState('HDPE');
    const [fiberSegmentIds, setFiberSegmentIds] = useState([]);
    const [strandCount, setStrandCount] = useState('144');
    const [cableType, setCableType] = useState('SM');
    const [selectedFiberId, setSelectedFiberId] = useState('');
    const [selectedEnclosureId, setSelectedEnclosureId] = useState('');
    const [spliceMode, setSpliceMode] = useState('pass_through');
    const [outgoingStrandCount, setOutgoingStrandCount] = useState('144');
    const [branchStrandCount, setBranchStrandCount] = useState('12');
    const [branchCableType, setBranchCableType] = useState('SM');
    const [spliceSchedule, setSpliceSchedule] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [validation, setValidation] = useState(null);

    const alignment = useMemo(
        () => session?.design?.alignments?.[0] || null,
        [session]
    );

    const segments = session?.design?.conduitSegments || [];
    const structures = session?.design?.structures || [];
    const fibers = session?.design?.fibers || [];
    const spliceEnclosures = session?.design?.spliceEnclosures || [];
    const fiberSections = session?.design?.fiberSections || [];
    const quantities = session?.design?.quantities || [];
    const catalogCount = session?.catalog?.items?.length || 0;

    const run = async (fn, successMessage = '') => {
        setBusy(true);
        setError('');
        try {
            const next = await fn();
            if (next) setSession(next);
            if (successMessage) setMessage(successMessage);
        } catch (err) {
            setError(err?.message || 'Operation failed.');
        } finally {
            setBusy(false);
        }
    };

    const toggleFiberSegment = (segmentId) => {
        setFiberSegmentIds((current) =>
            current.includes(segmentId)
                ? current.filter((id) => id !== segmentId)
                : [...current, segmentId]
        );
    };

    const renderProjectStep = () => (
        <>
            <div className="form-group">
                <label>Project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Project number</label>
                <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Create a plan project that links stationing, procurement catalog, design features, and export data.
            </p>
        </>
    );

    const renderStationingStep = () => (
        <>
            <LayerSelect
                label="Project Stationing source"
                layers={stationingLayers}
                value={stationingLayerId}
                onChange={setStationingLayerId}
                emptyLabel="No Project Stationing centerline layers found"
            />
            {session?.stationingRoute ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    <div>Route: {session.stationingRoute.routeName}</div>
                    <div>Station range: {session.stationingRoute.profile?.start_station_label} – {session.stationingRoute.profile?.end_station_label}</div>
                </div>
            ) : null}
        </>
    );

    const renderCatalogStep = () => (
        <>
            <p className="text-xs">
                Load the sample procurement catalog for Phase 1 design and quantity review.
            </p>
            {catalogCount ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    <strong>{catalogCount}</strong> catalog items loaded.
                </div>
            ) : null}
        </>
    );

    const renderAlignmentStep = () => (
        <>
            <p className="text-xs">
                Draw the overall construction alignment once. Conduit segments will be generated from this route.
            </p>
            {alignment ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    <div>Alignment: {alignment.alignmentName}</div>
                    <div>Segments generated: {segments.length}</div>
                </div>
            ) : null}
            <div className="gis-widget__btn-row" style={{ marginTop: 12 }}>
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy}
                    onClick={() => run(
                        () => onDrawAlignment?.({ alignmentName: 'Planning alignment', routeName: session?.stationingRoute?.routeName }),
                        'Planning alignment drawn.'
                    )}
                >
                    Draw alignment
                </button>
            </div>
        </>
    );

    const renderStructuresStep = () => (
        <>
            <p className="text-xs">
                Place junction boxes and vaults on the alignment to automatically split conduit segments.
            </p>
            <div className="gis-widget__btn-row" style={{ marginTop: 12 }}>
                {structureTypes.map((entry) => (
                    <button
                        key={entry.value}
                        type="button"
                        className="gis-widget__link-btn"
                        disabled={busy || !alignment}
                        onClick={() => run(
                            () => onPlaceStructure?.(entry.value),
                            `${entry.label} placement started — click the alignment on the map.`
                        )}
                    >
                        Place {entry.label}
                    </button>
                ))}
            </div>
            {structures.length ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    <div><strong>{structures.length}</strong> structures placed</div>
                    <div><strong>{segments.length}</strong> conduit segments</div>
                </div>
            ) : null}
        </>
    );

    const renderConduitStep = () => (
        <>
            <div className="form-group">
                <label>Conduit segment</label>
                <select value={selectedSegmentId} onChange={(e) => setSelectedSegmentId(e.target.value)}>
                    <option value="">- choose segment -</option>
                    {segments.map((segment, index) => (
                        <option key={segment.segmentId} value={segment.segmentId}>
                            Segment {index + 1} ({formatFeet(segment.measuredLength)})
                        </option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label>Installation method</label>
                <select value={installationMethod} onChange={(e) => setInstallationMethod(e.target.value)}>
                    <option value="directional_bore">Directional bore</option>
                    <option value="open_trench">Open trench</option>
                    <option value="existing_conduit">Existing conduit</option>
                </select>
            </div>
            <div className="form-group">
                <label>Conduit product</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <input value={ductCount} onChange={(e) => setDuctCount(e.target.value)} placeholder="Duct count" />
                    <input value={diameter} onChange={(e) => setDiameter(e.target.value)} placeholder="Diameter" />
                    <input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="Product type" />
                </div>
            </div>
            <button
                type="button"
                className="gis-widget__link-btn"
                disabled={busy || !selectedSegmentId}
                onClick={() => run(() => onConfigureSegment?.(selectedSegmentId, {
                    installationMethod,
                    conduitComponents: [{
                        productType,
                        diameter,
                        ductCount: Number(ductCount) || 1,
                        lengthMultiplier: 1
                    }]
                }), 'Conduit segment updated.')}
            >
                Apply conduit configuration
            </button>
        </>
    );

    const renderFiberStep = () => (
        <>
            <p className="text-xs">Select connected conduit segments, then generate a fiber route along them.</p>
            <div className="form-group">
                <label>Conduit segments</label>
                <div style={{ display: 'grid', gap: 6 }}>
                    {segments.map((segment, index) => (
                        <label key={segment.segmentId} className="text-xs" style={{ display: 'flex', gap: 8 }}>
                            <input
                                type="checkbox"
                                checked={fiberSegmentIds.includes(segment.segmentId)}
                                onChange={() => toggleFiberSegment(segment.segmentId)}
                            />
                            <span>Segment {index + 1} ({formatFeet(segment.measuredLength)})</span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="form-group">
                <label>Strand count</label>
                <input value={strandCount} onChange={(e) => setStrandCount(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Cable type</label>
                <input value={cableType} onChange={(e) => setCableType(e.target.value)} />
            </div>
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy || !fiberSegmentIds.length}
                    onClick={() => run(() => onGenerateFiber?.({
                        segmentIds: fiberSegmentIds,
                        strandCount: Number(strandCount) || 144,
                        cableType
                    }), 'Fiber route generated.')}
                >
                    Generate fiber route
                </button>
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy}
                    onClick={() => run(() => onPlacePointAsset?.('Handhole'), 'Click the map to place a point asset.')}
                >
                    Place point asset
                </button>
            </div>
            {fibers.length ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    {fibers.map((fiber) => (
                        <div key={fiber.fiberId}>
                            {fiber.cableName}: {formatFeet(fiber.calculatedLength || fiber.measuredRouteLength)}
                        </div>
                    ))}
                </div>
            ) : null}
        </>
    );

    const renderSplicingStep = () => (
        <>
            <p className="text-xs">
                Place splice enclosures on fiber routes, configure splice behavior, and add branch or building-drop cables.
            </p>
            <div className="form-group">
                <label>Fiber route</label>
                <select value={selectedFiberId} onChange={(e) => setSelectedFiberId(e.target.value)}>
                    <option value="">- choose fiber -</option>
                    {fibers.map((fiber) => (
                        <option key={fiber.fiberId} value={fiber.fiberId}>
                            {fiber.cableName} ({fiber.strandCount}F)
                        </option>
                    ))}
                </select>
            </div>
            <div className="gis-widget__btn-row" style={{ marginTop: 8 }}>
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy || !fibers.length}
                    onClick={() => run(
                        () => onPlaceSplice?.(selectedFiberId || undefined),
                        'Click on or near the selected fiber to place a splice enclosure.'
                    )}
                >
                    Place splice enclosure
                </button>
            </div>

            {spliceEnclosures.length ? (
                <>
                    <div className="form-group" style={{ marginTop: 12 }}>
                        <label>Splice enclosure</label>
                        <select value={selectedEnclosureId} onChange={(e) => setSelectedEnclosureId(e.target.value)}>
                            <option value="">- choose enclosure -</option>
                            {spliceEnclosures.map((enclosure, index) => (
                                <option key={enclosure.enclosureId} value={enclosure.enclosureId}>
                                    Splice {index + 1} ({enclosure.spliceMode || 'unconfigured'})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Splice mode</label>
                        <select value={spliceMode} onChange={(e) => setSpliceMode(e.target.value)}>
                            {spliceModeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Outgoing strand count</label>
                        <input value={outgoingStrandCount} onChange={(e) => setOutgoingStrandCount(e.target.value)} />
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="gis-widget__link-btn"
                            disabled={busy || !selectedEnclosureId}
                            onClick={() => run(() => onConfigureSplice?.(selectedEnclosureId, {
                                spliceMode,
                                outgoingStrandCount: Number(outgoingStrandCount) || 0
                            }), 'Splice configuration updated.')}
                        >
                            Apply splice configuration
                        </button>
                    </div>

                    <div className="form-group" style={{ marginTop: 12 }}>
                        <label>Branch / building drop</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <input value={branchStrandCount} onChange={(e) => setBranchStrandCount(e.target.value)} placeholder="Strand count" />
                            <input value={branchCableType} onChange={(e) => setBranchCableType(e.target.value)} placeholder="Cable type" />
                        </div>
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="gis-widget__link-btn"
                            disabled={busy || !selectedEnclosureId}
                            onClick={() => run(() => onAddBranchCable?.(selectedEnclosureId, {
                                strandCount: Number(branchStrandCount) || 12,
                                cableType: branchCableType,
                                buildingDrop: spliceMode === 'building_drop',
                                spliceMode: spliceMode === 'building_drop' ? 'building_drop' : 'branch'
                            }), 'Click the map to set the branch cable endpoint.')}
                        >
                            Add branch cable
                        </button>
                        <button
                            type="button"
                            className="gis-widget__link-btn"
                            disabled={busy}
                            onClick={() => {
                                const schedule = onGetSpliceSchedule?.() || [];
                                setSpliceSchedule(schedule);
                            }}
                        >
                            Refresh splice schedule
                        </button>
                    </div>
                </>
            ) : null}

            <div className="text-xs" style={{ marginTop: 8 }}>
                <div><strong>{spliceEnclosures.length}</strong> splice enclosures</div>
                <div><strong>{fiberSections.length}</strong> internal fiber sections</div>
            </div>

            {spliceSchedule.length ? (
                <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 8 }}>
                    <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th align="left">Mode</th>
                                <th align="right">Fusion splices</th>
                                <th align="right">Pass-through</th>
                            </tr>
                        </thead>
                        <tbody>
                            {spliceSchedule.map((entry) => (
                                <tr key={entry.enclosureId}>
                                    <td>{entry.spliceMode}</td>
                                    <td align="right">{entry.fusionSpliceCount}</td>
                                    <td align="right">{entry.passThroughStrandCount}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </>
    );

    const renderQuantitiesStep = () => (
        <>
            <p className="text-xs">Review calculated procurement quantities. Manual overrides are preserved on recalculation.</p>
            <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th align="left">Description</th>
                            <th align="right">Qty</th>
                            <th align="left">Unit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {quantities.map((record) => {
                            const catalogItem = session?.catalog?.items?.find((item) => item.catalogItemId === record.catalogItemId);
                            return (
                                <tr key={record.quantityId}>
                                    <td>{catalogItem?.shortDescription || catalogItem?.description || record.catalogItemId}</td>
                                    <td align="right">{Number(record.finalQuantity).toFixed(2)}</td>
                                    <td>{record.measurementUnit}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <button
                type="button"
                className="gis-widget__link-btn"
                style={{ marginTop: 12 }}
                disabled={busy}
                onClick={() => {
                    const result = onValidate?.();
                    setValidation(result || null);
                }}
            >
                Run design validation
            </button>
            {validation ? (
                <div className="text-xs" style={{ marginTop: 8 }}>
                    {validation.errors?.map((entry) => <div key={entry} style={{ color: 'var(--danger)' }}>{entry}</div>)}
                    {validation.warnings?.map((entry) => <div key={entry}>{entry}</div>)}
                </div>
            ) : null}
        </>
    );

    const renderExportStep = () => (
        <>
            <p className="text-xs">
                Export project JSON, quantity CSV, and optional design layers for downstream callout and sheet workflows.
            </p>
            <div className="gis-widget__btn-row" style={{ marginTop: 12 }}>
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy}
                    onClick={() => run(async () => {
                        onSaveSession?.();
                        return session;
                    }, 'Session saved.')}
                >
                    Save session
                </button>
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy}
                    onClick={() => run(async () => {
                        onAddDesignLayers?.();
                        return session;
                    }, 'Design layers added to the map.')}
                >
                    Add design layers
                </button>
                <button
                    type="button"
                    className="gis-widget__link-btn"
                    disabled={busy}
                    onClick={() => run(async () => {
                        onExportPackage?.();
                        return session;
                    }, 'Export package downloaded.')}
                >
                    Export package
                </button>
            </div>
        </>
    );

    const stepContent = [
        renderProjectStep,
        renderStationingStep,
        renderCatalogStep,
        renderAlignmentStep,
        renderStructuresStep,
        renderConduitStep,
        renderFiberStep,
        renderSplicingStep,
        renderQuantitiesStep,
        renderExportStep
    ][step - 1]();

    const canGoNext = !busy && (
        step === 1 ? projectName.trim() :
        step === 2 ? Boolean(stationingLayerId || session?.stationingRoute) :
        step === 3 ? catalogCount > 0 :
        step === 4 ? Boolean(alignment) :
        step === 7 ? fibers.length > 0 :
        true
    );

    const handleNext = async () => {
        if (step === 1) {
            await run(() => onCreateProject?.({ projectName, projectNumber }), 'Project created.');
        } else if (step === 2 && stationingLayerId) {
            await run(() => onSelectStationing?.(stationingLayerId), 'Stationing source selected.');
        } else if (step === 3 && !catalogCount) {
            await run(() => onLoadCatalog?.(), 'Sample catalog loaded.');
        }
        if (canGoNext) setStep((current) => Math.min(current + 1, DESIGN_STEPS.length));
    };

    return (
        <WidgetPanelShell
            status={error || message}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            footer={(
                <div className="gis-widget__btn-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <button
                        type="button"
                        className="gis-widget__link-btn"
                        disabled={busy || step <= 1}
                        onClick={() => setStep((current) => Math.max(1, current - 1))}
                    >
                        Back
                    </button>
                    <button
                        type="button"
                        className="gis-widget__primary-btn"
                        disabled={!canGoNext || busy || step >= DESIGN_STEPS.length}
                        onClick={handleNext}
                    >
                        {step >= DESIGN_STEPS.length ? 'Done' : 'Next'}
                    </button>
                </div>
            )}
        >
            <WidgetStepWizard steps={DESIGN_STEPS} currentStep={step} />
            {stepContent}
        </WidgetPanelShell>
    );
}
