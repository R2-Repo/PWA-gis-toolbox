/**
 * UDOT Fiber callout note text + stable per-layer numbering.
 */

export const FIBER_CALLOUT_PROFILE = 'udot-fiber-v1';

export const AUTO_POINT_KEYS = Object.freeze(['boxes', 'splices']);
export const AUTO_LINE_KEYS = Object.freeze(['conduit', 'fiber']);
export const SKIP_AUTO_KEYS = Object.freeze(['cabinets', 'building']);

export const CALLOUT_PREFIX_BY_KEY = Object.freeze({
    fiber: 'F',
    boxes: 'B',
    conduit: 'D',
    splices: 'S'
});

const CALLOUT_SORT_ORDER = Object.freeze({
    fiber: 0,
    boxes: 1,
    conduit: 2,
    splices: 3
});

const TEXT_FIELDS = {
    boxes: ['BOXLABELS', 'DT_RSCENCLOSURE_NAME', 'NAME'],
    splices: ['NAME', 'MODEL'],
    conduit: ['CustNameRight', 'CUSTNAME', 'DT_RSCBUNDLE_CUSTNAME', 'CONDUIT_SYM'],
    fiber: ['Fiber_Label', 'MODEL', 'CUSTNAME', 'OWNER']
};

const FALLBACK_TEXT = {
    boxes: 'Box',
    splices: 'Splice',
    conduit: 'Conduit',
    fiber: 'Fiber'
};

/**
 * @param {object} [feature]
 * @returns {string}
 */
export function fiberFeatureId(feature) {
    const props = feature?.properties || {};
    const raw = feature?.id
        ?? props.OBJECTID
        ?? props.objectid
        ?? props.FID
        ?? props.fid
        ?? props.feature_id;
    if (raw != null && raw !== '') return String(raw);
    return '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeNoteText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} [fiberKey]
 * @param {object} [feature]
 * @returns {string}
 */
export function noteTextForFeature(fiberKey, feature) {
    const fields = TEXT_FIELDS[fiberKey] || [];
    const props = feature?.properties || {};
    for (const field of fields) {
        const text = normalizeNoteText(props[field]);
        if (text) return text;
    }
    return FALLBACK_TEXT[fiberKey] || 'Callout';
}

/**
 * @param {string} fiberKey
 * @param {string} featureId
 * @returns {string}
 */
export function pointTargetKey(fiberKey, featureId) {
    return `${fiberKey}:${featureId}`;
}

/**
 * @param {string} [fiberKey]
 * @returns {string}
 */
export function normalizeCalloutFiberKey(fiberKey) {
    return CALLOUT_PREFIX_BY_KEY[fiberKey] ? fiberKey : '';
}

/**
 * @param {unknown} raw
 * @returns {{ text: string, fiberKey: string }}
 */
export function parseCalloutNoteItem(raw) {
    if (typeof raw === 'string') {
        return { text: normalizeNoteText(raw), fiberKey: '' };
    }
    return {
        text: normalizeNoteText(raw?.text),
        fiberKey: normalizeCalloutFiberKey(raw?.fiberKey)
    };
}

function noteIdentityKey(fiberKey, text) {
    return `${normalizeCalloutFiberKey(fiberKey)}::${normalizeNoteText(text)}`;
}

function defaultNoteId(fiberKey, number) {
    const prefix = CALLOUT_PREFIX_BY_KEY[fiberKey];
    return prefix ? `note-${prefix}${number}` : `note-${number}`;
}

/**
 * @param {object} [note]
 * @returns {string}
 */
export function formatCalloutLabel(note) {
    const number = Number(note?.number);
    if (!Number.isFinite(number) || number <= 0) return '';
    const prefix = CALLOUT_PREFIX_BY_KEY[normalizeCalloutFiberKey(note?.fiberKey)];
    return prefix ? `${prefix}${number}` : String(number);
}

/**
 * Fiber, Box, Conduit, Splice, then plain numbers.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareCalloutNotes(a, b) {
    const ao = CALLOUT_SORT_ORDER[normalizeCalloutFiberKey(a?.fiberKey)] ?? 4;
    const bo = CALLOUT_SORT_ORDER[normalizeCalloutFiberKey(b?.fiberKey)] ?? 4;
    if (ao !== bo) return ao - bo;
    return Number(a?.number || 0) - Number(b?.number || 0);
}

function buildNoteEntry({ noteId, number, text, source, fiberKey }) {
    const entry = { noteId, number, text, source };
    const key = normalizeCalloutFiberKey(fiberKey);
    if (key) entry.fiberKey = key;
    return entry;
}

/**
 * Keep existing numbers for the same (fiberKey, text); assign the next integer per prefix.
 * Plain strings are unprefixed. Unprefixed auto notes remint when the same text returns with a fiberKey.
 * @param {object[]} [existingNotes]
 * @param {Array<string|{ text?: string, fiberKey?: string }>} [itemsInOrder]
 * @returns {object[]}
 */
export function assignStableNoteNumbers(existingNotes = [], itemsInOrder = []) {
    const notes = [];
    const byKey = new Map();
    const maxByPrefix = { '': 0 };
    for (const key of Object.keys(CALLOUT_PREFIX_BY_KEY)) maxByPrefix[key] = 0;

    const unprefixedRequested = new Set();
    const prefixedTexts = new Set();
    for (const raw of itemsInOrder) {
        const item = parseCalloutNoteItem(raw);
        if (!item.text) continue;
        if (item.fiberKey) prefixedTexts.add(item.text);
        else unprefixedRequested.add(item.text);
    }

    for (const note of existingNotes) {
        const text = normalizeNoteText(note.text);
        const number = Number(note.number);
        if (!text || !Number.isFinite(number) || number <= 0) continue;
        const fiberKey = normalizeCalloutFiberKey(note.fiberKey);
        const source = note.source || 'auto';
        if (!fiberKey && prefixedTexts.has(text)) continue;
        if (!fiberKey && source === 'auto' && !unprefixedRequested.has(text)) continue;
        const identity = noteIdentityKey(fiberKey, text);
        if (byKey.has(identity)) continue;
        const entry = buildNoteEntry({
            noteId: note.noteId || defaultNoteId(fiberKey, number),
            number,
            text,
            source,
            fiberKey
        });
        byKey.set(identity, entry);
        notes.push(entry);
        if (number > maxByPrefix[fiberKey]) maxByPrefix[fiberKey] = number;
    }

    for (const raw of itemsInOrder) {
        const { text, fiberKey } = parseCalloutNoteItem(raw);
        if (!text) continue;
        if (!fiberKey && prefixedTexts.has(text)) continue;
        const identity = noteIdentityKey(fiberKey, text);
        if (byKey.has(identity)) continue;
        maxByPrefix[fiberKey] += 1;
        const number = maxByPrefix[fiberKey];
        const entry = buildNoteEntry({
            noteId: defaultNoteId(fiberKey, number),
            number,
            text,
            source: fiberKey ? 'auto' : 'manual',
            fiberKey
        });
        byKey.set(identity, entry);
        notes.push(entry);
    }

    return notes.sort(compareCalloutNotes);
}

/**
 * @param {object[]} notes
 * @param {string} text
 * @param {string} [fiberKey]
 * @returns {object|null}
 */
export function findNoteByKeyAndText(notes = [], text, fiberKey = '') {
    const needle = normalizeNoteText(text);
    const key = normalizeCalloutFiberKey(fiberKey);
    return notes.find((note) => (
        note.text === needle && normalizeCalloutFiberKey(note.fiberKey) === key
    )) || null;
}

/**
 * Unprefixed lookup (manual / extra notes).
 * @param {object[]} notes
 * @param {string} text
 * @returns {object|null}
 */
export function findNoteByText(notes = [], text) {
    return findNoteByKeyAndText(notes, text, '');
}

/**
 * Exact (fiberKey, text), then unprefixed, then any same text (manual reuse of a typed note).
 * @param {object[]} notes
 * @param {string} text
 * @param {string} [fiberKey]
 * @returns {object|null}
 */
export function findReusableCalloutNote(notes = [], text, fiberKey = '') {
    const keyed = findNoteByKeyAndText(notes, text, fiberKey);
    if (keyed) return keyed;
    if (normalizeCalloutFiberKey(fiberKey)) return null;
    const unprefixed = findNoteByText(notes, text);
    if (unprefixed) return unprefixed;
    const needle = normalizeNoteText(text);
    return [...notes]
        .filter((note) => note.text === needle)
        .sort(compareCalloutNotes)[0] || null;
}
