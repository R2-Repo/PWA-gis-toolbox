import { useMemo, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';

function severityColor(severity) {
    if (severity === 'error') return 'var(--danger)';
    if (severity === 'warning') return '#d97706';
    return 'var(--text-muted)';
}

export function PlanProductionExportDialog({
    steps = [],
    linkableWidgets = [],
    exportProfiles = [],
    getLinkedWidgetEntries,
    initialSession,
    onCancel,
    onCreateProject,
    onLinkWidgetSessions,
    onRunReadinessCheck,
    onSetExportProfile,
    onBuildExport,
    onDownloadExport,
    onAddExportLayers,
    onSaveSession
}) {
    const [step, setStep] = useState(1);
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [projectNumber, setProjectNumber] = useState(initialSession?.project?.projectNumber || '');
    const [exportProfileId, setExportProfileId] = useState(initialSession?.exportProfileId || 'procurement');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const linkedEntries = useMemo(
        () => getLinkedWidgetEntries?.() || [],
        [getLinkedWidgetEntries, session]
    );

    const sources = session?.assembly?.sources || {};
    const readiness = session?.readiness;
    const lastExport = session?.lastExport;

    const run = async (fn, successMessage = '') => {
        setBusy(true);
        setError('');
        try {
            const next = await fn();
            if (next && next.project) setSession(next);
            else if (next) setSession((current) => ({ ...current, lastExport: next }));
            if (successMessage) setMessage(successMessage);
        } catch (err) {
            setError(err?.message || 'Operation failed.');
        } finally {
            setBusy(false);
        }
    };

    const renderProjectStep = () => (
        <>
            <div className="form-group">
                <label>Export project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Project number</label>
                <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Assemble linked widget sessions into a professional plan export package with readiness validation.
            </p>
        </>
    );

    const renderLinkStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Link open widget sessions from Fiber Procurement Design, Plan Set Callouts, and Sheet Cutter.
            </p>
            <div className="text-xs" style={{ marginTop: 12 }}>
                {linkableWidgets.map((widget) => (
                    <div key={widget.id} style={{ marginBottom: 6 }}>
                        <strong>{widget.label}</strong>: {sources[widget.id] ? 'linked' : 'not linked'}
                        {linkedEntries.some((entry) => entry.type === widget.id && entry.open)
                            ? ' (session available)'
                            : ''}
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                disabled={busy}
                onClick={() => run(() => onLinkWidgetSessions?.(), 'Widget sessions linked.')}
            >
                Link widget sessions
            </button>
        </>
    );

    const renderReadinessStep = () => (
        <>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => run(() => onRunReadinessCheck?.(), 'Readiness check complete.')}
            >
                Run plan readiness check
            </button>
            {readiness ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                        {readiness.score}%
                    </div>
                    <div>{readiness.summary?.errorCount || 0} errors · {readiness.summary?.warningCount || 0} warnings · {readiness.summary?.infoCount || 0} info</div>
                    <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 12 }}>
                        {(readiness.findings || []).map((finding, index) => (
                            <div key={`${finding.code}-${index}`} style={{ marginBottom: 6, color: severityColor(finding.severity) }}>
                                <strong>{finding.widgetLabel || finding.widget}</strong> — {finding.message}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </>
    );

    const renderProfileStep = () => (
        <>
            <div className="form-group">
                <label>Export profile</label>
                <select value={exportProfileId} onChange={(e) => setExportProfileId(e.target.value)}>
                    {exportProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.label}</option>
                    ))}
                </select>
            </div>
            {exportProfiles.find((profile) => profile.id === exportProfileId)?.description ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {exportProfiles.find((profile) => profile.id === exportProfileId).description}
                </p>
            ) : null}
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                disabled={busy}
                onClick={() => run(() => onSetExportProfile?.(exportProfileId), 'Export profile selected.')}
            >
                Save profile
            </button>
        </>
    );

    const renderExportStep = () => (
        <>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => run(() => onBuildExport?.(), 'Export package built.')}
            >
                Build export package
            </button>
            {lastExport ? (
                <div className="text-xs" style={{ marginTop: 12 }}>
                    <div><strong>{lastExport.manifest?.fileCount || 0}</strong> files in {lastExport.manifest?.profileLabel}</div>
                    <ul style={{ marginTop: 8, maxHeight: 160, overflow: 'auto' }}>
                        {(lastExport.files || []).map((file) => (
                            <li key={file.filename}>{file.filename}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            <div className="gis-widget__btn-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onDownloadExport?.()}>
                    Download all files
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAddExportLayers?.()}>
                    Add GeoJSON layers to map
                </button>
                <button type="button" className="gis-widget__link-btn" disabled={busy} onClick={() => onSaveSession?.()}>
                    Save session JSON
                </button>
            </div>
        </>
    );

    const stepContent = [
        renderProjectStep,
        renderLinkStep,
        renderReadinessStep,
        renderProfileStep,
        renderExportStep
    ][step - 1]();

    const canGoNext = !busy && (
        step === 1 ? projectName.trim() :
        step === 2 ? Object.values(sources).some(Boolean) :
        step === 3 ? Boolean(readiness) :
        step === 4 ? Boolean(exportProfileId) :
        true
    );

    const handleNext = async () => {
        if (step === 1) {
            await run(() => onCreateProject?.({ projectName, projectNumber }), 'Project created.');
        } else if (step === 2 && !Object.values(sources).some(Boolean)) {
            await run(() => onLinkWidgetSessions?.(), 'Sessions linked.');
        } else if (step === 3 && !readiness) {
            await run(() => onRunReadinessCheck?.(), 'Readiness check complete.');
        } else if (step === 4) {
            await run(() => onSetExportProfile?.(exportProfileId), 'Profile saved.');
        }
        if (canGoNext) setStep((current) => Math.min(current + 1, steps.length));
    };

    return (
        <WidgetPanelShell
            status={error || message}
            statusTone={error ? 'danger' : 'muted'}
            onCancel={onCancel}
            footer={(
                <div className="gis-widget__btn-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <button type="button" className="gis-widget__link-btn" disabled={busy || step <= 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>
                        Back
                    </button>
                    <button type="button" className="gis-widget__primary-btn" disabled={!canGoNext || busy || step >= steps.length} onClick={handleNext}>
                        {step >= steps.length ? 'Done' : 'Next'}
                    </button>
                </div>
            )}
        >
            <WidgetStepWizard steps={steps} currentStep={step} />
            {stepContent}
        </WidgetPanelShell>
    );
}
