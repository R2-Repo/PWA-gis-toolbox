import { useEffect, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import { findCoveringInset, notesUsedOnSheet } from '../../js/widgets/plan-set-callouts/leader-placement.js';
import {
    canAdvanceCalloutStep,
    isCalloutPrimaryActionDisabled
} from '../../js/widgets/plan-set-callouts/wizard-state.js';

function isOn(leader) {
    return leader && !leader.suppressed && leader.enabled !== false;
}

export function PlanSetCalloutsDialog({
    steps = [],
    initialSession,
    initialStep = 1,
    hasSheetSession = false,
    insetViews = [],
    fromSheetCutter = false,
    onCancel,
    onDone,
    onCreateProject,
    onGenerate,
    onSelectSheet,
    onToggleLeader,
    onSuppressLeader,
    onAddNote,
    onSubscribeSession
}) {
    const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), steps.length || 1));
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [projectNumber, setProjectNumber] = useState(initialSession?.project?.projectNumber || '');
    const [selectedSheetId, setSelectedSheetId] = useState(initialSession?.selectedSheetId || '');
    const [extraNote, setExtraNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        setSession(initialSession);
        if (initialSession?.selectedSheetId) setSelectedSheetId(initialSession.selectedSheetId);
    }, [initialSession]);

    useEffect(() => onSubscribeSession?.((next) => {
        if (next) {
            setSession(next);
            if (next.selectedSheetId) setSelectedSheetId(next.selectedSheetId);
        }
    }), [onSubscribeSession]);

    const sheets = session?.sheets || [];
    const selectedSheet = sheets.find((sheet) => sheet.sheetId === selectedSheetId) || sheets[0];
    const sheetLeaders = (session?.leaders || []).filter((leader) => (
        !selectedSheet || leader.sheetId === selectedSheet.sheetId
    ));
    const notesById = new Map((session?.notes || []).map((note) => [note.noteId, note]));
    const onLeaders = sheetLeaders.filter(isOn);
    const tableNotes = notesUsedOnSheet(session, selectedSheet?.sheetId, {
        insetViews,
        page: 'corridor'
    });

    const run = async (fn, successMessage = '') => {
        setBusy(true);
        setError('');
        try {
            const next = await fn();
            if (next) {
                setSession(next);
                if (next.selectedSheetId) setSelectedSheetId(next.selectedSheetId);
            }
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
                <label>Project name</label>
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </div>
            <div className="form-group">
                <label>Project number</label>
                <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Numbered circle leaders and a per-sheet key notes table for UDOT Fiber on Sheet Cutter PDFs.
                Numbers stay stable across the plan set.
            </p>
            <p className="text-xs" style={{ color: hasSheetSession ? 'var(--text-muted)' : 'var(--danger)' }}>
                {hasSheetSession
                    ? (fromSheetCutter
                        ? 'Using the current Sheet Cutter sheets. After Done, Sheet Cutter reopens so you can export PDFs.'
                        : 'Sheet Cutter session found. After Done, callouts stay on the map.')
                    : 'Generate sheets in Sheet Cutter, then open callouts from that widget.'}
            </p>
        </>
    );

    const renderGenerateStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
                Discovers a leader for every box and splice, and one per conduit/fiber span.
                Cabinets and buildings are skipped. All callouts start off — turn on only the ones you need
                in Review or by right-clicking a feature.
            </p>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !hasSheetSession}
                onClick={() => run(() => onGenerate?.(), 'Candidates generated. Turn on callouts in Review.')}
            >
                Generate callouts
            </button>
            {session?.leaders?.length ? (
                <p className="text-xs" style={{ marginTop: 8 }}>
                    {session.leaders.filter(isOn).length} on / {session.leaders.length} discovered,{' '}
                    {(session.notes || []).length} unique note(s).
                </p>
            ) : null}
            {(session?.warnings || []).length ? (
                <ul className="text-xs" style={{ marginTop: 8 }}>
                    {session.warnings.map((entry) => <li key={entry}>{entry}</li>)}
                </ul>
            ) : null}
        </>
    );

    const renderReviewStep = () => (
        <>
            <div className="form-group">
                <label>Sheet</label>
                <select
                    value={selectedSheet?.sheetId || ''}
                    onChange={(e) => {
                        const sheetId = e.target.value;
                        setSelectedSheetId(sheetId);
                        run(() => onSelectSheet?.(sheetId));
                    }}
                >
                    {sheets.map((sheet) => (
                        <option key={sheet.sheetId} value={sheet.sheetId}>
                            Sheet {sheet.sheetNumber}
                        </option>
                    ))}
                </select>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Key notes tables only list callouts that are on. Drag a numbered circle on the map to move
                the leader; the feature anchor stays put. After Done you can keep editing on the map
                {fromSheetCutter ? ' or use Add Fiber callouts in Sheet Cutter to continue.' : '.'}
            </p>
            <div className="text-xs" style={{ marginTop: 8, maxHeight: 140, overflow: 'auto' }}>
                <strong>PROJECT KEY NOTES (this sheet)</strong>
                {tableNotes.length ? tableNotes.map((note) => (
                    <div key={note.noteId}>{note.number} — {note.text}</div>
                )) : <div>No callouts turned on for this sheet.</div>}
            </div>
            <div className="text-xs" style={{ marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
                <strong>Callouts ({onLeaders.length} on / {sheetLeaders.length})</strong>
                {sheetLeaders.map((leader) => {
                    const numbers = (leader.noteIds || []).map((id) => notesById.get(id)?.number).filter(Boolean).join(', ') || '—';
                    const covering = findCoveringInset(leader, insetViews);
                    return (
                        <div key={leader.leaderKey} style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                                <input
                                    type="checkbox"
                                    checked={isOn(leader)}
                                    disabled={busy}
                                    onChange={(e) => run(
                                        () => (onToggleLeader || onSuppressLeader)?.(leader.leaderKey, e.target.checked),
                                        e.target.checked ? 'Callout on.' : 'Callout off.'
                                    )}
                                />
                                <span>{numbers}</span>
                            </label>
                            {covering ? (
                                <span style={{ color: 'var(--text-muted)' }}>DETAILS {covering.label || ''} only</span>
                            ) : null}
                        </div>
                    );
                })}
                {!sheetLeaders.length ? <div>Generate callouts first.</div> : null}
            </div>
            <div className="form-group" style={{ marginTop: 12 }}>
                <label>Add number to first on callout on this sheet</label>
                <div className="gis-widget__row" style={{ gap: 8 }}>
                    <input
                        value={extraNote}
                        onChange={(e) => setExtraNote(e.target.value)}
                        placeholder="Note text"
                    />
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !extraNote.trim() || !onLeaders.length}
                        onClick={() => run(async () => {
                            const next = await onAddNote?.(onLeaders[0].leaderKey, extraNote.trim());
                            setExtraNote('');
                            return next;
                        }, 'Note added.')}
                    >
                        Add
                    </button>
                </div>
            </div>
        </>
    );

    const stepContent = [renderProjectStep, renderGenerateStep, renderReviewStep][step - 1]();
    const isLastStep = step >= steps.length;
    const canGoNext = canAdvanceCalloutStep(step, {
        projectName,
        hasSheetSession,
        hasLeaders: (session?.leaders || []).length > 0
    });
    const primaryDisabled = isCalloutPrimaryActionDisabled({ busy, canAdvance: canGoNext });

    const handleNext = async () => {
        if (isLastStep) {
            (onDone || onCancel)?.();
            return;
        }
        if (step === 1) {
            await run(() => onCreateProject?.({ projectName, projectNumber }), 'Project ready.');
        } else if (step === 2 && !(session?.leaders || []).length) {
            await run(() => onGenerate?.(), 'Candidates generated.');
        }
        setStep((current) => Math.min(current + 1, steps.length));
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
                    <button type="button" className="gis-widget__primary-btn" disabled={primaryDisabled} onClick={handleNext}>
                        {isLastStep ? 'Done' : 'Next'}
                    </button>
                </div>
            )}
        >
            <WidgetStepWizard steps={steps} currentStep={step} />
            {stepContent}
        </WidgetPanelShell>
    );
}
