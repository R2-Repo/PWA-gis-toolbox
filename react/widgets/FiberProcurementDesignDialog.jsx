import { useMemo, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { ProcurementSymbologyLegend } from './shared/ProcurementSymbologyLegend.jsx';
import { DESIGN_STEPS } from '../../js/widgets/fiber-procurement-design/engine.js';

const STEP_HELP = {
    1: 'Create a plan project that links stationing, procurement catalog, design features, and export data.',
    2: 'Optional — link a Project Stationing centerline for mileposts and station labels, or skip and continue without stationing.',
    3: 'Load the sample catalog or import a procurement spreadsheet (.xlsx, .xls, .csv).',
    4: 'Choose an active design assembly. New conduit segments inherit installation method, products, and waste factors from this template.',
    5: 'Draw the overall construction alignment once. Conduit segments will be generated from this route.',
    6: 'Place junction boxes and vaults on the alignment to automatically split conduit segments.',
    7: 'Configure installation method and conduit products for each segment.',
    8: 'Select connected conduit segments, then generate a fiber route along them.',
    9: 'Place splice enclosures on fiber routes, configure splice behavior, and add branch or building-drop cables.',
    10: 'Review calculated procurement quantities, validate readiness, and add non-spatial items.',
    11: 'Export project JSON, quantity CSV, and optional design layers for downstream callout and sheet workflows.'
};

function formatFeet(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value)).toLocaleString()} ft`;
}

function StepHeader({ title, description }) {
    if (!description) return null;
    return (
        <div className="gis-widget__step-header">
            {title ? <p className="gis-widget__step-header-title">{title}</p> : null}
            <p className="gis-widget__step-header-desc">{description}</p>
        </div>
    );
}

export function FiberProcurementDesignDialog({
    stationingLayers = [],
    initialSession,
    structureTypes = [],
    onCancel,
    onCreateProject,
    onSelectStationing,
    onRefreshStationingLayers,
    onOpenProjectStationing,
    onLoadCatalog,
    onImportCatalogFile,
    onDrawAlignment,
    onPlaceStructure,
    onMoveStructure,
    onDeleteStructure,
    onConfigureSegment,
    onGenerateFiber,
    onPlacePointAsset,
    onPlaceSplice,
    onConfigureSplice,
    onAddBranchCable,
    onGetSpliceSchedule,
    spliceModeOptions = [],
    assemblies = [],
    activeAssemblyId: initialActiveAssemblyId = '',
    onSetActiveAssembly,
    onToggleAssemblyFavorite,
    onSaveCustomAssembly,
    onApplyActiveAssembly,
    onBulkUpdateSegments,
    onContinueFromSegment,
    onCopyConduitToSegments,
    onGetSegmentInheritance,
    onAddNonSpatialItem,
    onOverrideQuantity,
    onGetQuantityTraceability,
    nonSpatialCatalogItems = [],
    onExportPackage,
    onAddDesignLayers,
    onValidate,
    onSaveSession,
    onRestoreSession,
    onOpenFullPlanExport
}) {
    const catalogFileRef = useRef(null);
    const restoreFileRef = useRef(null);
    const [step, setStep] = useState(1);
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [stationingLayerOptions, setStationingLayerOptions] = useState(stationingLayers);
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
    const [activeAssemblyId, setActiveAssemblyId] = useState(initialActiveAssemblyId || initialSession?.project?.activeAssemblyId || '');
    const [customAssemblyName, setCustomAssemblyName] = useState('');
    const [bulkSegmentIds, setBulkSegmentIds] = useState([]);
    const [continueSourceSegmentId, setContinueSourceSegmentId] = useState('');
    const [copySourceSegmentId, setCopySourceSegmentId] = useState('');
    const [selectedStructureId, setSelectedStructureId] = useState('');
    const [mergeAdjoiningOnDelete, setMergeAdjoiningOnDelete] = useState(false);
    const [overrideQuantityId, setOverrideQuantityId] = useState('');
    const [overrideQuantityValue, setOverrideQuantityValue] = useState('');
    const [overrideQuantityReason, setOverrideQuantityReason] = useState('');
    const [inheritanceHint, setInheritanceHint] = useState('');
    const [nonSpatialCatalogItemId, setNonSpatialCatalogItemId] = useState('');
    const [nonSpatialQuantity, setNonSpatialQuantity] = useState('1');
    const [nonSpatialReason, setNonSpatialReason] = useState('');
    const [traceability, setTraceability] = useState([]);
    const [busy, setBusy] = useState(false);
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
    const nonSpatialItems = session?.design?.nonSpatialItems || [];
    const catalogCount = session?.catalog?.items?.length || 0;
    const assemblyOptions = assemblies.length ? assemblies : (session?.design?.assemblies || []);

    const syncFormFromSession = (next) => {
        if (!next) return;
        setProjectName(next.project?.projectName || '');
        setStationingLayerId(next.project?.stationingRouteLayerId || '');
        setActiveAssemblyId(next.project?.activeAssemblyId || '');
    };

    const run = async (fn, successMessage = '') => {
        setBusy(true);
        setError('');
        try {
            const next = await fn();
            if (next) {
                setSession(next);
                syncFormFromSession(next);
            }
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

    const toggleBulkSegment = (segmentId) => {
        setBulkSegmentIds((current) =>
            current.includes(segmentId)
                ? current.filter((id) => id !== segmentId)
                : [...current, segmentId]
        );
    };

    const conduitConfig = {
        installationMethod,
        conduitComponents: [{
            productType,
            diameter,
            ductCount: Number(ductCount) || 1,
            lengthMultiplier: 1
        }]
    };

    const renderProjectStep = () => (
        <>
            <div className="form-group">
                <label>Project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
        </>
    );

    const renderStationingStep = () => {
        const hasStationingLayers = stationingLayerOptions.length > 0;

        return (
            <>
                <div className="info-box text-xs">
                    Stationing is optional. You can link a Project Stationing centerline to attach mileposts
                    and station labels to your design, or skip this step and continue without it.
                </div>
                {hasStationingLayers ? (
                    <LayerSelect
                        label="Project Stationing source"
                        layers={stationingLayerOptions}
                        value={stationingLayerId}
                        onChange={setStationingLayerId}
                        emptyLabel="No Project Stationing centerline layers found"
                    />
                ) : (
                    <div className="info-box text-xs">
                        No Project Stationing centerline layers are on the map yet. Open the Project
                        Stationing widget to create one, then refresh the list below.
                    </div>
                )}
                {session?.stationingRoute ? (
                    <div className="info-box text-xs">
                        <div>Route: {session.stationingRoute.routeName}</div>
                        <div>Station range: {session.stationingRoute.profile?.start_station_label} – {session.stationingRoute.profile?.end_station_label}</div>
                    </div>
                ) : null}
                <div className="gis-widget__btn-row">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => onOpenProjectStationing?.()}
                    >
                        Open Project Stationing
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => {
                            const next = onRefreshStationingLayers?.();
                            if (next) setStationingLayerOptions(next);
                        }}
                    >
                        Refresh layer list
                    </button>
                </div>
            </>
        );
    };

    const renderCatalogStep = () => (
        <>
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => run(() => onLoadCatalog?.(), 'Sample catalog loaded.')}
                >
                    Load sample catalog
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => catalogFileRef.current?.click()}
                >
                    Import spreadsheet
                </button>
                <input
                    ref={catalogFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        run(() => onImportCatalogFile?.(file), 'Procurement catalog imported.');
                    }}
                />
            </div>
            {catalogCount ? (
                <div className="info-box text-xs">
                    <strong>{catalogCount}</strong> catalog items loaded.
                </div>
            ) : null}
            <ProcurementSymbologyLegend compact />
        </>
    );

    const renderAssembliesStep = () => (
        <>
            <div className="form-group">
                <label>Active assembly</label>
                <select value={activeAssemblyId} onChange={(e) => setActiveAssemblyId(e.target.value)}>
                    <option value="">- choose assembly -</option>
                    {assemblyOptions.map((assembly) => (
                        <option key={assembly.assemblyId} value={assembly.assemblyId}>
                            {assembly.assemblyName}{assembly.isFavorite ? ' ★' : ''}
                        </option>
                    ))}
                </select>
            </div>
            {activeAssemblyId ? (
                <div className="info-box text-xs">
                    {assemblyOptions.find((assembly) => assembly.assemblyId === activeAssemblyId)?.description}
                </div>
            ) : null}
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !activeAssemblyId}
                    onClick={() => run(() => onSetActiveAssembly?.(activeAssemblyId), 'Active assembly updated.')}
                >
                    Set active assembly
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !activeAssemblyId}
                    onClick={() => run(() => onToggleAssemblyFavorite?.(activeAssemblyId, true), 'Assembly saved to favorites.')}
                >
                    Save favorite
                </button>
            </div>
            <details className="gis-widget__details">
                <summary>Save custom assembly</summary>
                <div className="gis-widget__details-body">
                    <div className="form-group">
                        <label>Assembly name</label>
                        <input value={customAssemblyName} onChange={(e) => setCustomAssemblyName(e.target.value)} placeholder="Assembly name" />
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
                        Uses the currently selected conduit segment configuration (set on the Conduit step).
                    </p>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !customAssemblyName.trim() || !selectedSegmentId}
                        onClick={() => run(() => {
                            const segment = segments.find((entry) => entry.segmentId === selectedSegmentId);
                            return onSaveCustomAssembly?.({
                                assemblyName: customAssemblyName.trim(),
                                installationMethod: segment?.installationMethod,
                                conduitComponents: segment?.conduitComponents,
                                wasteFactor: session?.project?.defaultWasteFactor
                            });
                        }, 'Custom assembly saved.')}
                    >
                        Save custom assembly
                    </button>
                </div>
            </details>
        </>
    );

    const renderAlignmentStep = () => (
        <>
            {alignment ? (
                <div className="info-box text-xs">
                    <div>Alignment: {alignment.alignmentName}</div>
                    <div>Segments generated: {segments.length}</div>
                </div>
            ) : null}
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
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
            <div className="gis-widget__btn-row">
                {structureTypes.map((entry) => (
                    <button
                        key={entry.value}
                        type="button"
                        className="btn btn-secondary btn-sm"
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
                <div className="info-box text-xs">
                    <div><strong>{structures.length}</strong> structures placed</div>
                    <div><strong>{segments.length}</strong> conduit segments</div>
                </div>
            ) : null}
            {structures.length ? (
                <>
                    <div className="form-group">
                        <label>Selected structure</label>
                        <select value={selectedStructureId} onChange={(e) => setSelectedStructureId(e.target.value)}>
                            <option value="">- choose structure -</option>
                            {structures.map((structure, index) => (
                                <option key={structure.structureId} value={structure.structureId}>
                                    {structure.structureName || structure.assetType || `Structure ${index + 1}`}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !selectedStructureId}
                            onClick={() => run(
                                () => onMoveStructure?.(selectedStructureId),
                                'Click on the alignment to move the structure.'
                            )}
                        >
                            Move structure
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !selectedStructureId}
                            onClick={() => run(
                                () => onDeleteStructure?.(selectedStructureId, mergeAdjoiningOnDelete),
                                'Structure removed.'
                            )}
                        >
                            Delete structure
                        </button>
                    </div>
                    <label className="text-xs toggle" style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={mergeAdjoiningOnDelete}
                            onChange={(e) => setMergeAdjoiningOnDelete(e.target.checked)}
                        />
                        <span>Merge adjoining conduit segments when deleting</span>
                    </label>
                </>
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
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !selectedSegmentId}
                    onClick={() => run(() => onConfigureSegment?.(selectedSegmentId, conduitConfig), 'Conduit segment updated.')}
                >
                    Apply conduit configuration
                </button>
                {selectedSegmentId ? (
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => {
                            const summary = onGetSegmentInheritance?.(selectedSegmentId);
                            setInheritanceHint(summary?.installationMethod?.hint || '');
                        }}
                    >
                        Show inheritance
                    </button>
                ) : null}
            </div>
            {inheritanceHint ? (
                <div className="info-box text-xs">{inheritanceHint}</div>
            ) : null}

            <details className="gis-widget__details">
                <summary>Bulk and copy tools</summary>
                <div className="gis-widget__details-body">
                    <div className="form-group">
                        <label>Bulk edit segments</label>
                        <div style={{ display: 'grid', gap: 6 }}>
                            {segments.map((segment, index) => (
                                <label key={segment.segmentId} className="text-xs" style={{ display: 'flex', gap: 8 }}>
                                    <input
                                        type="checkbox"
                                        checked={bulkSegmentIds.includes(segment.segmentId)}
                                        onChange={() => toggleBulkSegment(segment.segmentId)}
                                    />
                                    <span>{segment.displayLabel || `Segment ${index + 1}`}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !bulkSegmentIds.length}
                            onClick={() => run(() => onBulkUpdateSegments?.(bulkSegmentIds, conduitConfig), 'Bulk update applied.')}
                        >
                            Bulk apply configuration
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !bulkSegmentIds.length || !session?.project?.activeAssemblyId}
                            onClick={() => run(() => onApplyActiveAssembly?.(bulkSegmentIds), 'Active assembly applied.')}
                        >
                            Apply active assembly
                        </button>
                    </div>
                    <div className="form-group">
                        <label>Continue from segment</label>
                        <select value={continueSourceSegmentId} onChange={(e) => setContinueSourceSegmentId(e.target.value)}>
                            <option value="">- source segment -</option>
                            {segments.map((segment, index) => (
                                <option key={segment.segmentId} value={segment.segmentId}>
                                    Segment {index + 1}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !continueSourceSegmentId || !selectedSegmentId}
                        onClick={() => run(
                            () => onContinueFromSegment?.(continueSourceSegmentId, selectedSegmentId),
                            'Segment properties copied from source.'
                        )}
                    >
                        Continue from selected source
                    </button>
                    <div className="form-group">
                        <label>Copy conduit to other segments</label>
                        <select value={copySourceSegmentId} onChange={(e) => setCopySourceSegmentId(e.target.value)}>
                            <option value="">- source segment -</option>
                            {segments.map((segment, index) => (
                                <option key={segment.segmentId} value={segment.segmentId}>
                                    Segment {index + 1}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !copySourceSegmentId || !bulkSegmentIds.length}
                        onClick={() => run(
                            () => onCopyConduitToSegments?.(copySourceSegmentId, bulkSegmentIds),
                            'Conduit configuration copied to selected segments.'
                        )}
                    >
                        Copy conduit to selected segments
                    </button>
                </div>
            </details>
        </>
    );

    const renderFiberStep = () => (
        <>
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
                    className="btn btn-secondary btn-sm"
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
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => run(() => onPlacePointAsset?.('Handhole'), 'Click the map to place a point asset.')}
                >
                    Place point asset
                </button>
            </div>
            {fibers.length ? (
                <div className="info-box text-xs">
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
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
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
                    <div className="form-group">
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
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !selectedEnclosureId}
                            onClick={() => run(() => onConfigureSplice?.(selectedEnclosureId, {
                                spliceMode,
                                outgoingStrandCount: Number(outgoingStrandCount) || 0
                            }), 'Splice configuration updated.')}
                        >
                            Apply splice configuration
                        </button>
                    </div>

                    <div className="form-group">
                        <label>Branch / building drop</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <input value={branchStrandCount} onChange={(e) => setBranchStrandCount(e.target.value)} placeholder="Strand count" />
                            <input value={branchCableType} onChange={(e) => setBranchCableType(e.target.value)} placeholder="Cable type" />
                        </div>
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
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
                            className="btn btn-secondary btn-sm"
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

            <div className="info-box text-xs">
                <div><strong>{spliceEnclosures.length}</strong> splice enclosures</div>
                <div><strong>{fiberSections.length}</strong> internal fiber sections</div>
            </div>

            {spliceSchedule.length ? (
                <div className="gis-widget__preview-table">
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
            <div className="gis-widget__section">
                <p className="gis-widget__section-title">Calculated quantities</p>
                <div className="gis-widget__preview-table" style={{ maxHeight: 180 }}>
                    <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th align="left">Description</th>
                                <th align="right">Qty</th>
                                <th align="left">Unit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {quantities.length ? quantities.map((record) => {
                                const catalogItem = session?.catalog?.items?.find((item) => item.catalogItemId === record.catalogItemId);
                                return (
                                    <tr key={record.quantityId}>
                                        <td>{catalogItem?.shortDescription || catalogItem?.description || record.catalogItemId}</td>
                                        <td align="right">{Number(record.finalQuantity).toFixed(2)}</td>
                                        <td>{record.measurementUnit}</td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={3} style={{ color: 'var(--text-muted)' }}>No quantities calculated yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="gis-widget__section">
                <p className="gis-widget__section-title">Non-spatial items</p>
                <div className="form-group">
                    <label>Procurement item</label>
                    <select value={nonSpatialCatalogItemId} onChange={(e) => setNonSpatialCatalogItemId(e.target.value)}>
                        <option value="">- choose item -</option>
                        {nonSpatialCatalogItems.map((item) => (
                            <option key={item.catalogItemId} value={item.catalogItemId}>
                                {item.description}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                    <input value={nonSpatialQuantity} onChange={(e) => setNonSpatialQuantity(e.target.value)} placeholder="Quantity" />
                    <input value={nonSpatialReason} onChange={(e) => setNonSpatialReason(e.target.value)} placeholder="Reason" />
                </div>
                <div className="gis-widget__btn-row">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !nonSpatialCatalogItemId}
                        onClick={() => run(() => onAddNonSpatialItem?.({
                            catalogItemId: nonSpatialCatalogItemId,
                            quantity: Number(nonSpatialQuantity) || 1,
                            reason: nonSpatialReason
                        }), 'Non-spatial item added.')}
                    >
                        Add non-spatial item
                    </button>
                </div>
                {nonSpatialItems.length ? (
                    <div className="info-box text-xs">
                        {nonSpatialItems.map((item) => (
                            <div key={item.itemId}>{item.description}: {item.quantity} {item.unit}</div>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="gis-widget__section">
                <p className="gis-widget__section-title">Readiness check</p>
                <div className="gis-widget__btn-row">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => {
                            const result = onValidate?.();
                            setValidation(result || null);
                        }}
                    >
                        Run readiness check
                    </button>
                </div>
                {validation ? (
                    <div className="text-xs">
                        {validation.errors?.map((entry) => <div key={entry} style={{ color: 'var(--danger)' }}>{entry}</div>)}
                        {validation.warnings?.map((entry) => <div key={entry}>{entry}</div>)}
                        {validation.findings?.map((entry) => (
                            <div key={`${entry.code}-${entry.featureId || entry.message}`}>
                                [{entry.severity}] {entry.message}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            <details className="gis-widget__details">
                <summary>Overrides and traceability</summary>
                <div className="gis-widget__details-body">
                    <div className="form-group">
                        <label>Override calculated quantity</label>
                        <select value={overrideQuantityId} onChange={(e) => setOverrideQuantityId(e.target.value)}>
                            <option value="">- choose quantity -</option>
                            {quantities.map((record) => {
                                const catalogItem = session?.catalog?.items?.find((item) => item.catalogItemId === record.catalogItemId);
                                return (
                                    <option key={record.quantityId} value={record.quantityId}>
                                        {catalogItem?.shortDescription || catalogItem?.description || record.catalogItemId}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                        <input
                            value={overrideQuantityValue}
                            onChange={(e) => setOverrideQuantityValue(e.target.value)}
                            placeholder="Final quantity"
                        />
                        <input
                            value={overrideQuantityReason}
                            onChange={(e) => setOverrideQuantityReason(e.target.value)}
                            placeholder="Override reason"
                        />
                    </div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !overrideQuantityId || overrideQuantityValue === ''}
                            onClick={() => run(() => onOverrideQuantity?.(
                                overrideQuantityId,
                                Number(overrideQuantityValue),
                                overrideQuantityReason
                            ), 'Quantity override applied.')}
                        >
                            Apply quantity override
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => setTraceability(onGetQuantityTraceability?.() || [])}
                        >
                            Show traceability
                        </button>
                    </div>
                    {traceability.length ? (
                        <div className="gis-widget__preview-table text-xs">
                            {traceability.map((entry) => (
                                <div key={entry.quantityId}>
                                    {entry.description}: {entry.finalQuantity} ({entry.linkedFeatures.length} features)
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </details>
        </>
    );

    const renderExportStep = () => (
        <>
            <div className="gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
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
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => restoreFileRef.current?.click()}
                >
                    Restore session
                </button>
                <input
                    ref={restoreFileRef}
                    type="file"
                    accept=".json,.gis-toolbox"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                            try {
                                const bundle = JSON.parse(String(reader.result || '{}'));
                                run(() => onRestoreSession?.(bundle), 'Design session restored.');
                            } catch {
                                setError('Invalid session file.');
                            }
                        };
                        reader.readAsText(file);
                    }}
                />
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
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
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => run(async () => {
                        onExportPackage?.();
                        return session;
                    }, 'Export package downloaded.')}
                >
                    Export package
                </button>
            </div>
            <div className="gis-widget__section" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <p className="gis-widget__step-header-desc" style={{ marginBottom: 8 }}>
                    Link open design, callout, and sheet sessions, run readiness checks, and download a combined procurement or plan set package.
                </p>
                <button
                    type="button"
                    className="gis-widget__primary-btn"
                    disabled={busy}
                    onClick={() => onOpenFullPlanExport?.()}
                >
                    Export full plan package
                </button>
            </div>
        </>
    );

    const stepContent = [
        renderProjectStep,
        renderStationingStep,
        renderCatalogStep,
        renderAssembliesStep,
        renderAlignmentStep,
        renderStructuresStep,
        renderConduitStep,
        renderFiberStep,
        renderSplicingStep,
        renderQuantitiesStep,
        renderExportStep
    ][step - 1]();

    const canApplyStationing = Boolean(stationingLayerId || session?.stationingRoute);

    const canGoNext = !busy && (
        step === 1 ? projectName.trim() :
        step === 3 ? catalogCount > 0 :
        step === 4 ? Boolean(activeAssemblyId || session?.project?.activeAssemblyId) :
        step === 5 ? Boolean(alignment) :
        step === 8 ? fibers.length > 0 :
        true
    );

    const canAdvanceFromStationing = !busy && (step !== 2 || canApplyStationing);

    const handleNext = async () => {
        if (step === 1) {
            await run(() => onCreateProject?.({ projectName }), 'Project created.');
        } else if (step === 2 && stationingLayerId) {
            await run(() => onSelectStationing?.(stationingLayerId), 'Stationing source selected.');
        } else if (step === 3 && !catalogCount) {
            await run(() => onLoadCatalog?.(), 'Sample catalog loaded.');
        } else if (step === 4 && activeAssemblyId) {
            await run(() => onSetActiveAssembly?.(activeAssemblyId), 'Active assembly set.');
        }
        if (canGoNext) setStep((current) => Math.min(current + 1, DESIGN_STEPS.length));
    };

    return (
        <WidgetPanelShell
            status={error}
            statusTone="danger"
            onCancel={onCancel}
            footer={(
                <div className="gis-widget__btn-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || step <= 1}
                        onClick={() => setStep((current) => Math.max(1, current - 1))}
                    >
                        Back
                    </button>
                    <div className="gis-widget__btn-row" style={{ marginBottom: 0 }}>
                        {step === 2 ? (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busy}
                                onClick={() => setStep(3)}
                            >
                                Skip
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="gis-widget__primary-btn"
                            disabled={!canGoNext || !canAdvanceFromStationing || busy || step >= DESIGN_STEPS.length}
                            onClick={handleNext}
                        >
                            {step >= DESIGN_STEPS.length ? 'Done' : 'Next'}
                        </button>
                    </div>
                </div>
            )}
        >
            <WidgetStepWizard steps={DESIGN_STEPS} currentStep={step} variant="compact" />
            <StepHeader description={STEP_HELP[step]} />
            {stepContent}
        </WidgetPanelShell>
    );
}
