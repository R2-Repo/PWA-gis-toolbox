import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTRIBUTE_TABLE_PAGE_SIZE } from '../../js/workspace/attribute-table.js';
import { LGID_PROP } from '../../js/workspace/feature-identity.js';

function formatCell(val) {
    if (val && typeof val === 'object' && val._att) {
        const icon = val.type?.startsWith('image/') ? '🖼️' : '📎';
        return `${icon} ${val.name || 'attachment'}`;
    }
    if (val != null && typeof val === 'object') return JSON.stringify(val);
    return val ?? '';
}

function isAttachment(val) {
    return val && typeof val === 'object' && val._att;
}

function isIdentityField(field) {
    return field === '_featureIndex' || field === LGID_PROP;
}

/**
 * Attribute table for in-memory layers (editable) or workspace layers (paged, read-only).
 *
 * Workspace mode: pass `onLoadPage` — dialog pages IndexedDB attributes (incl. cold)
 * even when features are not drawn on the map.
 */
export function DataTableDialog({
    layerName,
    fields: initialFields = [],
    rows: initialRows = [],
    totalCount: initialTotalCount = 0,
    coldFields: initialColdFields = [],
    isSpatial = true,
    readOnly = false,
    includeColdDefault = true,
    pageSize = ATTRIBUTE_TABLE_PAGE_SIZE,
    statusNote = null,
    onLoadPage = null,
    onCellEdit,
    onClose
}) {
    const dirtyRef = useRef(false);
    const asyncMode = typeof onLoadPage === 'function';

    const [fields, setFields] = useState(initialFields);
    const [rows, setRows] = useState(initialRows);
    const [totalCount, setTotalCount] = useState(initialTotalCount);
    const [coldFields, setColdFields] = useState(initialColdFields);
    const [offset, setOffset] = useState(0);
    const [includeCold, setIncludeCold] = useState(includeColdDefault);
    const [loading, setLoading] = useState(asyncMode);
    const [error, setError] = useState('');

    const coldSet = new Set(coldFields || []);

    useEffect(() => {
        return () => {
            if (dirtyRef.current) onClose?.({ dirty: true });
            else onClose?.({ dirty: false });
        };
    }, [onClose]);

    const loadPage = useCallback(async (nextOffset, nextIncludeCold) => {
        if (!asyncMode) return;
        setLoading(true);
        setError('');
        try {
            const page = await onLoadPage({
                offset: nextOffset,
                limit: pageSize,
                includeCold: nextIncludeCold
            });
            setRows(page?.rows || []);
            setFields(page?.fields || []);
            setTotalCount(page?.totalCount ?? 0);
            setColdFields(page?.coldFields || []);
            setOffset(page?.offset ?? nextOffset);
            setIncludeCold(page?.includeCold ?? nextIncludeCold);
        } catch (e) {
            setError(e?.message || 'Could not load attribute page.');
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [asyncMode, onLoadPage, pageSize]);

    useEffect(() => {
        if (!asyncMode) return;
        void loadPage(0, includeColdDefault);
        // Initial load only when async loader identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asyncMode, onLoadPage]);

    const handleBlur = (rowIndex, field, newVal, oldVal) => {
        if (readOnly || asyncMode) return;
        const coerced = (oldVal === null || oldVal === undefined) ? newVal
            : typeof oldVal === 'number' ? (Number.isNaN(Number(newVal)) ? newVal : Number(newVal))
                : typeof oldVal === 'boolean' ? (newVal === 'true')
                    : newVal;
        if (String(oldVal) !== String(coerced)) {
            const isFirstEdit = !dirtyRef.current;
            dirtyRef.current = true;
            onCellEdit?.(rowIndex, field, coerced, isFirstEdit);
        }
    };

    const from = totalCount === 0 ? 0 : offset + 1;
    const to = Math.min(offset + rows.length, totalCount);
    const canPrev = asyncMode && offset > 0 && !loading;
    const canNext = asyncMode && offset + rows.length < totalCount && !loading;

    const defaultNote = asyncMode
        ? 'Stored workspace attributes — includes features not currently drawn on the map. Cold/detached fields are highlighted.'
        : null;
    const note = statusNote || defaultNote;

    return (
        <div className="data-table-dialog">
            <div className="text-xs text-muted mb-8">
                {asyncMode ? (
                    <>
                        Showing {from.toLocaleString()}–{to.toLocaleString()} of {totalCount.toLocaleString()} rows
                        {readOnly ? ' · read-only' : ''}.
                    </>
                ) : (
                    <>
                        Showing {rows.length} of {totalCount} rows
                        {!readOnly ? (
                            <> · <strong>Click a cell to edit</strong>. Changes are saved when you click away.</>
                        ) : null}
                    </>
                )}
            </div>

            {note ? (
                <div className="data-table-note text-xs text-muted mb-8">{note}</div>
            ) : null}

            {asyncMode ? (
                <div className="data-table-toolbar">
                    <label className="data-table-cold-toggle">
                        <input
                            type="checkbox"
                            checked={includeCold}
                            disabled={loading}
                            onChange={(e) => {
                                const next = e.target.checked;
                                setIncludeCold(next);
                                void loadPage(offset, next);
                            }}
                        />
                        Include cold / detached fields
                    </label>
                    <div className="data-table-pager">
                        <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            disabled={!canPrev}
                            onClick={() => void loadPage(Math.max(0, offset - pageSize), includeCold)}
                        >
                            Previous
                        </button>
                        <span className="data-table-page-label text-xs text-muted">
                            Page {totalCount === 0 ? 0 : Math.floor(offset / pageSize) + 1}
                            {' / '}
                            {totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize)}
                        </span>
                        <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            disabled={!canNext}
                            onClick={() => void loadPage(offset + pageSize, includeCold)}
                        >
                            Next
                        </button>
                    </div>
                </div>
            ) : null}

            {error ? <div className="text-danger text-xs mb-8">{error}</div> : null}
            {loading ? <div className="text-muted text-xs mb-8">Loading attributes…</div> : null}

            <div className="data-table-wrap" style={{ maxHeight: 450 }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 40 }}>#</th>
                            {fields.map((f) => (
                                <th
                                    key={f}
                                    className={[
                                        coldSet.has(f) ? 'data-table-cold-col' : '',
                                        isIdentityField(f) ? 'data-table-identity-col' : ''
                                    ].filter(Boolean).join(' ') || undefined}
                                    title={coldSet.has(f)
                                        ? 'Cold / detached field (not used for map display)'
                                        : isIdentityField(f)
                                            ? 'Internal feature identity'
                                            : undefined}
                                >
                                    {f}
                                    {coldSet.has(f) ? <span className="data-table-cold-tag"> cold</span> : null}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && rows.length === 0 ? (
                            <tr>
                                <td colSpan={Math.max(1, fields.length + 1)} className="text-muted text-xs">
                                    No attribute rows in this page.
                                </td>
                            </tr>
                        ) : null}
                        {rows.map((row, rowIndex) => {
                            const absIndex = row?._featureIndex ?? (offset + rowIndex);
                            return (
                                <tr key={`${absIndex}-${rowIndex}`}>
                                    <td style={{ color: 'var(--text-muted)', fontSize: 10, textAlign: 'center' }}>
                                        {Number.isFinite(absIndex) ? absIndex + 1 : rowIndex + 1}
                                    </td>
                                    {fields.map((field) => {
                                        const val = row?.[field];
                                        const cold = coldSet.has(field);
                                        if (isAttachment(val) || readOnly || asyncMode || isIdentityField(field)) {
                                            return (
                                                <td
                                                    key={field}
                                                    className={[
                                                        isAttachment(val) ? 'att-cell' : '',
                                                        cold ? 'data-table-cold-cell' : '',
                                                        isIdentityField(field) ? 'data-table-identity-cell' : ''
                                                    ].filter(Boolean).join(' ') || undefined}
                                                    style={isAttachment(val) ? {
                                                        cursor: 'default',
                                                        color: 'var(--text-muted)',
                                                        fontStyle: 'italic'
                                                    } : undefined}
                                                    title={isAttachment(val) ? (val.name || 'attachment') : undefined}
                                                >
                                                    {formatCell(val)}
                                                </td>
                                            );
                                        }
                                        return (
                                            <td
                                                key={field}
                                                className={cold ? 'data-table-cold-cell' : undefined}
                                                contentEditable
                                                suppressContentEditableWarning
                                                onFocus={(e) => {
                                                    e.currentTarget.style.outline = '2px solid var(--primary)';
                                                    e.currentTarget.style.background = 'var(--bg-surface)';
                                                }}
                                                onBlur={(e) => {
                                                    e.currentTarget.style.outline = '';
                                                    e.currentTarget.style.background = '';
                                                    handleBlur(rowIndex, field, e.currentTarget.textContent, val);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                                                    if (e.key === 'Escape') e.currentTarget.blur();
                                                    if (e.key === 'Tab') {
                                                        e.preventDefault();
                                                        const next = e.shiftKey
                                                            ? e.currentTarget.previousElementSibling
                                                            : e.currentTarget.nextElementSibling;
                                                        if (next?.contentEditable === 'true') next.focus();
                                                    }
                                                }}
                                            >
                                                {formatCell(val)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {layerName ? (
                <div className="text-xs text-muted mt-8" style={{ marginTop: 8 }}>
                    Layer: {layerName}{isSpatial ? '' : ' (table)'}
                </div>
            ) : null}
        </div>
    );
}
