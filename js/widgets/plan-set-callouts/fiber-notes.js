/**
 * UDOT Fiber callout note text + stable project-wide numbering.
 */

export const FIBER_CALLOUT_PROFILE = 'udot-fiber-v1';

export const AUTO_POINT_KEYS = Object.freeze(['boxes', 'splices']);
export const AUTO_LINE_KEYS = Object.freeze(['conduit', 'fiber']);
export const SKIP_AUTO_KEYS = Object.freeze(['cabinets', 'building']);

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
 * Keep existing numbers for the same text; assign the next integers to new texts.
 * @param {object[]} [existingNotes]
 * @param {string[]} [textsInOrder]
 * @returns {object[]}
 */
export function assignStableNoteNumbers(existingNotes = [], textsInOrder = []) {
    const notes = [];
    const byText = new Map();
    let maxNumber = 0;

    for (const note of existingNotes) {
        const text = normalizeNoteText(note.text);
        const number = Number(note.number);
        if (!text || !Number.isFinite(number) || number <= 0) continue;
        if (byText.has(text)) continue;
        const entry = {
            noteId: note.noteId || `note-${number}`,
            number,
            text,
            source: note.source || 'auto'
        };
        byText.set(text, entry);
        notes.push(entry);
        if (number > maxNumber) maxNumber = number;
    }

    for (const raw of textsInOrder) {
        const text = normalizeNoteText(raw);
        if (!text || byText.has(text)) continue;
        maxNumber += 1;
        const entry = {
            noteId: `note-${maxNumber}`,
            number: maxNumber,
            text,
            source: 'auto'
        };
        byText.set(text, entry);
        notes.push(entry);
    }

    return notes.sort((a, b) => a.number - b.number);
}

/**
 * @param {object[]} notes
 * @param {string} text
 * @returns {object|null}
 */
export function findNoteByText(notes = [], text) {
    const needle = normalizeNoteText(text);
    return notes.find((note) => note.text === needle) || null;
}
