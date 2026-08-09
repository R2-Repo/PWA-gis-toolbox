import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ATTRIBUTE_TABLE_PAGE_SIZE,
    normalizeAttributeTableQuery,
    rowMatchesAttributeQuery,
    sortAttributeRows
} from '../../js/workspace/attribute-table.js';
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

const FIELD_OPS = [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' }
];

/**
 * Attribute table for in-memory layers (editable) or workspace layers (paged).
 *
 * Workspace mode: `onLoadPage` + optional `onScanMatches` / `onFocusRow`.
 */
export function DataTableDialog({
    layerName,
    fields: initialFields = [],
    rows: initialRows = [],
    totalCount: initialTotalCount = 0,
    coldFields: initialColdFields = [],
    filterFields: filterFieldsProp = null,
    isSpatial = true,
    readOnly = false,
    includeColdDefault = true,
    pageSize = ATTRIBUTE_TABLE_PAGE_SIZE,
    statusNote = null,
    onLoadPage = null,
    onScanMatches = null,
    onFocusRow = null,
    onCellEdit,
    onClose
}) {
    const dirtyRef = useRef(false);
    const scanAbortRef = useRef(null);
    const asyncMode = typeof onLoadPage === 'function';
    const canScan = asyncMode && typeof onScanMatches === 'function';
    const canFocus = typeof onFocusRow === 'function' && isSpatial;

    const [fields, setFields] = useState(initialFields);
    const [rows, setRows] = useState(initialRows);
    const [allMemoryRows] = useState(initialRows);
    const [totalCount, setTotalCount] = useState(initialTotalCount);
    const [coldFields, setColdFields] = useState(initialColdFields);
    const [offset, setOffset] = useState(0);
    const [includeCold, setIncludeCold] = useState(includeColdDefault);
    const [loading, setLoading] = useState(asyncMode);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(null);
    const [error, setError] = useState('');
    const [activeRowIndex, setActiveRowIndex] = useState(null);
    const [focusBusy, setFocusBusy] = useState(false);

    const [searchText, setSearchText] = useState('');
    const [filterField, setFilterField] = useState('');
    const [filterOp, setFilterOp] = useState('contains');
    const [filterValue, setFilterValue] = useState('');
    const [matchIndices, setMatchIndices] = useState(null);
    const [scanTruncated, setScanTruncated] = useState(false);
    const [sortField, setSortField] = useState(null);
    const [sortDir, setSortDir] = useState('asc');

    const coldSet = new Set(coldFields || []);
    const filterFieldOptions = useMemo(() => {
        if (Array.isArray(filterFieldsProp) && filterFieldsProp.length) return filterFieldsProp;
        return (fields || []).filter((f) => !isIdentityField(f));
    }, [filterFieldsProp, fields]);

    useEffect(() => {
        return () => {
            scanAbortRef.current?.abort?.();
            if (dirtyRef.current) onClose?.({ dirty: true });
            else onClose?.({ dirty: false });
        };
    }, [onClose]);

    const loadPage = useCallback(async ({
        nextOffset = 0,
        nextIncludeCold = includeCold,
        nextMatches = matchIndices,
        nextSortField = sortField,
        nextSortDir = sortDir
    } = {}) => {
        if (!asyncMode) return;
        setLoading(true);
        setError('');
        try {
            const page = await onLoadPage({
                offset: nextOffset,
                limit: pageSize,
                includeCold: nextIncludeCold,
                matchIndices: nextMatches,
                sortField: nextSortField,
                sortDir: nextSortDir
            });
            setRows(page?.rows || []);
            setFields(page?.fields || []);
            setTotalCount(page?.totalCount ?? 0);
            setColdFields(page?.coldFields || []);
            setOffset(page?.offset ?? nextOffset);
            setIncludeCold(page?.includeCold ?? nextIncludeCold);
            if (page?.sortField != null) setSortField(page.sortField);
            if (page?.sortDir) setSortDir(page.sortDir);
        } catch (e) {
            if (e?.name === 'AbortError') return;
            setError(e?.message || 'Could not load attribute page.');
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [asyncMode, onLoadPage, pageSize, includeCold, matchIndices, sortField, sortDir]);

    useEffect(() => {
        if (!asyncMode) return;
        void loadPage({ nextOffset: 0, nextIncludeCold: includeColdDefault, nextMatches: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asyncMode, onLoadPage]);

    const applyMemoryView = useCallback((text, field, op, value, fieldSort, dir) => {
        const query = normalizeAttributeTableQuery({
            text,
            field: field || null,
            fieldValue: value,
            fieldOp: op
        });
        let next = allMemoryRows;
        if (query.active) {
            next = allMemoryRows.filter((row) => rowMatchesAttributeQuery(row, query));
        }
        if (fieldSort) next = sortAttributeRows(next, fieldSort, dir);
        setRows(next);
        setTotalCount(next.length);
        setOffset(0);
        setMatchIndices(query.active ? next.map((r, i) => r._featureIndex ?? i) : null);
    }, [allMemoryRows]);

    const runSearch = async () => {
        setError('');
        setActiveRowIndex(null);
        const query = {
            text: searchText,
            field: filterField || null,
            fieldValue: filterValue,
            fieldOp: filterOp
        };
        const normalized = normalizeAttributeTableQuery(query);

        if (!asyncMode) {
            applyMemoryView(searchText, filterField, filterOp, filterValue, sortField, sortDir);
            return;
        }

        if (!normalized.active) {
            setMatchIndices(null);
            setScanTruncated(false);
            setScanProgress(null);
            await loadPage({
                nextOffset: 0,
                nextIncludeCold: includeCold,
                nextMatches: null
            });
            return;
        }

        if (!canScan) {
            setError('Search is not available for this layer.');
            return;
        }

        scanAbortRef.current?.abort?.();
        const controller = new AbortController();
        scanAbortRef.current = controller;
        setScanning(true);
        setScanProgress({ scanned: 0, total: 0, matches: 0 });
        try {
            const result = await onScanMatches({
                ...query,
                includeCold,
                signal: controller.signal,
                onProgress: (p) => setScanProgress(p)
            });
            const matches = result?.matchIndices || [];
            setMatchIndices(matches);
            setScanTruncated(!!result?.truncated);
            setTotalCount(matches.length);
            await loadPage({
                nextOffset: 0,
                nextIncludeCold: includeCold,
                nextMatches: matches
            });
        } catch (e) {
            if (e?.name === 'AbortError') return;
            setError(e?.message || 'Search failed.');
        } finally {
            setScanning(false);
        }
    };

    const clearSearch = async () => {
        scanAbortRef.current?.abort?.();
        setSearchText('');
        setFilterField('');
        setFilterOp('contains');
        setFilterValue('');
        setMatchIndices(null);
        setScanTruncated(false);
        setScanProgress(null);
        setActiveRowIndex(null);
        if (!asyncMode) {
            applyMemoryView('', '', 'contains', '', sortField, sortDir);
            return;
        }
        await loadPage({
            nextOffset: 0,
            nextIncludeCold: includeCold,
            nextMatches: null
        });
    };

    const toggleSort = (field) => {
        if (!field) return;
        const nextDir = sortField === field && sortDir === 'asc' ? 'desc' : 'asc';
        const nextField = sortField === field && sortDir === 'desc' ? null : field;
        const dir = nextField ? nextDir : 'asc';
        setSortField(nextField);
        setSortDir(dir);
        if (!asyncMode) {
            applyMemoryView(searchText, filterField, filterOp, filterValue, nextField, dir);
            return;
        }
        void loadPage({
            nextOffset: offset,
            nextIncludeCold: includeCold,
            nextMatches: matchIndices,
            nextSortField: nextField,
            nextSortDir: dir
        });
    };

    const handleBlur = (rowIndex, field, newVal, oldVal) => {
        if (readOnly || asyncMode) return;
        const coerced = (oldVal === null || oldVal === undefined) ? newVal
            : typeof oldVal === 'number' ? (Number.isNaN(Number(newVal)) ? newVal : Number(newVal))
                : typeof oldVal === 'boolean' ? (newVal === 'true')
                    : newVal;
        if (String(oldVal) !== String(coerced)) {
            const isFirstEdit = !dirtyRef.current;
            dirtyRef.current = true;
            onCellEdit?.(rowIndex, field, coerced, isFirstEdit, rows[rowIndex]);
        }
    };

    const focusRow = async (row) => {
        if (!canFocus || focusBusy) return;
        const featureIndex = Number(row?._featureIndex);
        if (!Number.isFinite(featureIndex)) {
            setError('This row has no feature index to zoom to.');
            return;
        }
        setFocusBusy(true);
        setActiveRowIndex(featureIndex);
        setError('');
        try {
            await onFocusRow({ featureIndex, row });
        } catch (e) {
            setError(e?.message || 'Could not zoom to feature.');
        } finally {
            setFocusBusy(false);
        }
    };

    const from = totalCount === 0 ? 0 : offset + 1;
    const to = Math.min(offset + rows.length, totalCount);
    const canPrev = asyncMode && offset > 0 && !loading && !scanning;
    const canNext = asyncMode && offset + rows.length < totalCount && !loading && !scanning;
    const filtered = matchIndices != null;

    const defaultNote = asyncMode
        ? 'Stored workspace attributes — includes features not currently drawn on the map. Double-click a row (or use Zoom) to highlight it on the map. Column headers sort the current page.'
        : (canFocus
            ? 'Double-click a row (or use Zoom) to highlight it on the map.'
            : null);
    const note = statusNote || defaultNote;
    const needsFilterValue = filterOp !== 'is_empty' && filterOp !== 'is_not_empty';

    return (
        <div className="data-table-dialog">
            <div className="text-xs text-muted mb-8">
                {asyncMode ? (
                    <>
                        Showing {from.toLocaleString()}–{to.toLocaleString()} of {totalCount.toLocaleString()}
                        {filtered ? ' matching' : ''} rows
                        {readOnly ? ' · read-only' : ''}
                        {scanTruncated ? ' · match list capped' : ''}.
                    </>
                ) : (
                    <>
                        Showing {rows.length} of {initialTotalCount} rows
                        {filtered ? ' (filtered)' : ''}
                        {!readOnly ? (
                            <> · <strong>Click a cell to edit</strong>. Changes are saved when you click away.</>
                        ) : null}
                    </>
                )}
            </div>

            {note ? (
                <div className="data-table-note text-xs text-muted mb-8">{note}</div>
            ) : null}

            <div className="data-table-search-bar">
                <input
                    type="search"
                    className="data-table-search-input"
                    placeholder="Search all attributes…"
                    value={searchText}
                    disabled={loading || scanning}
                    onChange={(e) => setSearchText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            void runSearch();
                        }
                    }}
                />
                <select
                    className="data-table-filter-select"
                    value={filterField}
                    disabled={loading || scanning}
                    onChange={(e) => setFilterField(e.target.value)}
                    title="Filter by field"
                >
                    <option value="">Any field</option>
                    {filterFieldOptions.map((f) => (
                        <option key={f} value={f}>{f}</option>
                    ))}
                </select>
                <select
                    className="data-table-filter-select"
                    value={filterOp}
                    disabled={loading || scanning || !filterField}
                    onChange={(e) => setFilterOp(e.target.value)}
                >
                    {FIELD_OPS.map((op) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                </select>
                <input
                    type="text"
                    className="data-table-search-input data-table-filter-value"
                    placeholder="Field value…"
                    value={filterValue}
                    disabled={loading || scanning || !filterField || !needsFilterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            void runSearch();
                        }
                    }}
                />
                <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={loading || scanning}
                    onClick={() => void runSearch()}
                >
                    {scanning ? 'Searching…' : 'Search'}
                </button>
                <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    disabled={loading || scanning}
                    onClick={() => void clearSearch()}
                >
                    Clear
                </button>
            </div>

            {scanProgress && scanning ? (
                <div className="text-xs text-muted mb-8">
                    Scanned {scanProgress.scanned.toLocaleString()}
                    {scanProgress.total ? ` / ${scanProgress.total.toLocaleString()}` : ''}
                    {' · '}
                    {scanProgress.matches.toLocaleString()} matches
                </div>
            ) : null}

            {asyncMode ? (
                <div className="data-table-toolbar">
                    <label className="data-table-cold-toggle">
                        <input
                            type="checkbox"
                            checked={includeCold}
                            disabled={loading || scanning}
                            onChange={(e) => {
                                const next = e.target.checked;
                                setIncludeCold(next);
                                void loadPage({
                                    nextOffset: offset,
                                    nextIncludeCold: next,
                                    nextMatches: matchIndices
                                });
                            }}
                        />
                        Include cold / detached fields
                    </label>
                    <div className="data-table-pager">
                        <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            disabled={!canPrev}
                            onClick={() => void loadPage({
                                nextOffset: Math.max(0, offset - pageSize),
                                nextIncludeCold: includeCold,
                                nextMatches: matchIndices
                            })}
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
                            onClick={() => void loadPage({
                                nextOffset: offset + pageSize,
                                nextIncludeCold: includeCold,
                                nextMatches: matchIndices
                            })}
                        >
                            Next
                        </button>
                    </div>
                </div>
            ) : null}

            {error ? <div className="text-danger text-xs mb-8">{error}</div> : null}
            {loading && !scanning ? <div className="text-muted text-xs mb-8">Loading attributes…</div> : null}

            <div className="data-table-wrap" style={{ maxHeight: 450 }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            {canFocus ? <th style={{ width: 52 }}>Map</th> : null}
                            <th style={{ width: 40 }}>#</th>
                            {fields.map((f) => {
                                const sorted = sortField === f;
                                return (
                                    <th
                                        key={f}
                                        className={[
                                            'data-table-sortable',
                                            coldSet.has(f) ? 'data-table-cold-col' : '',
                                            isIdentityField(f) ? 'data-table-identity-col' : '',
                                            sorted ? 'data-table-sorted' : ''
                                        ].filter(Boolean).join(' ')}
                                        title={coldSet.has(f)
                                            ? 'Cold / detached field — click to sort this page'
                                            : 'Click to sort this page'}
                                        onClick={() => toggleSort(f)}
                                    >
                                        {f}
                                        {coldSet.has(f) ? <span className="data-table-cold-tag"> cold</span> : null}
                                        {sorted ? (
                                            <span className="data-table-sort-ind">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                                        ) : null}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={Math.max(1, fields.length + 1 + (canFocus ? 1 : 0))}
                                    className="text-muted text-xs"
                                >
                                    No attribute rows{filtered ? ' match this search' : ' in this page'}.
                                </td>
                            </tr>
                        ) : null}
                        {rows.map((row, rowIndex) => {
                            const absIndex = row?._featureIndex ?? (offset + rowIndex);
                            const isActive = activeRowIndex === absIndex;
                            return (
                                <tr
                                    key={`${absIndex}-${rowIndex}`}
                                    className={isActive ? 'data-table-row-active' : undefined}
                                    onDoubleClick={() => void focusRow(row)}
                                >
                                    {canFocus ? (
                                        <td>
                                            <button
                                                type="button"
                                                className="btn btn-sm btn-secondary data-table-zoom-btn"
                                                disabled={focusBusy}
                                                title="Zoom to and highlight on map"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void focusRow(row);
                                                }}
                                            >
                                                Zoom
                                            </button>
                                        </td>
                                    ) : null}
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
                    {canFocus ? ' · double-click row to focus on map' : ''}
                </div>
            ) : null}
        </div>
    );
}
