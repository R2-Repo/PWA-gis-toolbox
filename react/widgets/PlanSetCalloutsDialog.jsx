import { useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { WidgetStepWizard } from './shared/WidgetStepWizard.jsx';
import {
    canAdvanceCalloutStep,
    isCalloutPrimaryActionDisabled
} from '../../js/widgets/plan-set-callouts/wizard-state.js';

export function PlanSetCalloutsDialog({
    steps = [],
    initialSession,
    hasSheetSession = false,
    onCancel,
    onCreateProject,
    onGenerate,
    onSelectSheet,
    onSuppressLeader,
    onAddNote,
    onDone
}) {
    const [step, setStep] = useState(1);
    const [session, setSession] = useState(initialSession);
    const [projectName, setProjectName] = useState(initialSession?.project?.projectName || '');
    const [projectNumber, setProjectNumber] = useState(initialSession?.project?.projectNumber || '');
    const [selectedSheetId, setSelectedSheetId] = useState(initialSession?.selectedSheetId || '');
    const [extraNote, setExtraNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const sheets = session?.sheets || [];
    const selectedSheet = sheets.find((sheet) => sheet.sheetId === selectedSheetId) || sheets[0];
    const leaders = (session?.leaders || []).filter((leader) => (
        !leader.suppressed && (!selectedSheet || leader.sheetId === selectedSheet.sheetId)
    ));
    const notesById = new Map((session?.notes || []).map((note) => [note.noteId, note]));
    const tableNotes = [];
    const seenNotes = new Set();
    for (const leader of leaders) {
        for (const noteId of leader.noteIds || []) {
            const note = notesById.get(noteId);
            if (!note || seenNotes.has(note.noteId)) continue;
            seenNotes.add(note.noteId);
            tableNotes.push(note);
        }
    }
    tableNotes.sort((a, b) => a.number - b.number);

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
                    ? 'Sheet Cutter session found.'
                    : 'Generate sheets in Sheet Cutter before continuing.'}
            </p>
        </>
    );

    const renderGenerateStep = () => (
        <>
            <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
                Auto-places a leader on every box and splice, and one leader per conduit/fiber span
                (lines that share the same box-to-box run). Cabinets and buildings are skipped.
                Right-click the map to remove or add callouts.
            </p>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !hasSheetSession}
                onClick={() => run(() => onGenerate?.(), 'Callouts generated. Review the per-sheet table next.')}
            >
                Generate callouts
            </button>
            {session?.leaders?.length ? (
                <p className="text-xs" style={{ marginTop: 8 }}>
                    {(session.leaders || []).filter((leader) => !leader.suppressed).length} leader(s),{' '}
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
                Table is not drawn on the map. It is added to each corridor PDF. Leaders stay on the map for editing.
            </p>
            <div className="text-xs" style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}>
                <strong>PROJECT KEY NOTES</strong>
                {tableNotes.length ? tableNotes.map((note) => (
                    <div key={note.noteId}>{note.number} — {note.text}</div>
                )) : <div>No notes on this sheet.</div>}
            </div>
            <div className="text-xs" style={{ marginTop: 10, maxHeight: 120, overflow: 'auto' }}>
                <strong>Leaders ({leaders.length})</strong>
                {leaders.map((leader) => (
                    <div key={leader.leaderKey} style={{ marginTop: 4 }}>
                        {(leader.noteIds || []).map((id) => notesById.get(id)?.number).filter(Boolean).join(', ') || '—'}
                        {' '}
                        <button
                            type="button"
                            className="gis-widget__link-btn"
                            disabled={busy}
                            onClick={() => run(() => onSuppressLeader?.(leader.leaderKey), 'Callout removed.')}
                        >
                            Remove
                        </button>
                    </div>
                ))}
            </div>
            <div className="form-group" style={{ marginTop: 12 }}>
                <label>Add number to first leader on this sheet</label>
                <div className="gis-widget__row" style={{ gap: 8 }}>
                    <input
                        value={extraNote}
                        onChange={(e) => setExtraNote(e.target.value)}
                        placeholder="Note text"
                    />
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy || !extraNote.trim() || !leaders.length}
                        onClick={() => run(async () => {
                            const next = await onAddNote?.(leaders[0].leaderKey, extraNote.trim());
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
        hasLeaders: (session?.leaders || []).some((leader) => !leader.suppressed)
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
            await run(() => onGenerate?.(), 'Callouts generated.');
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
