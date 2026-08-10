/**
 * CSV typing policy — preserve identifier strings by default.
 * Only coerce fields that are explicitly known as coordinates / measurements.
 */
import { looksProjected } from '../crs/detect.js';

const COORD_NAME_RE = /^(lat|latitude|lon|lng|long|longitude|x|y|easting|northing|z|elev|elevation|alt|altitude)$/i;

/**
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isCsvCoordinateFieldName(fieldName) {
    return COORD_NAME_RE.test(String(fieldName || '').trim());
}

/**
 * PapaParse `dynamicTyping` callback — type only coordinate-like columns.
 * Everything else stays a string (leading zeros, big integers preserved).
 * @param {string} field
 * @returns {boolean}
 */
export function csvDynamicTypingForField(field) {
    return isCsvCoordinateFieldName(field);
}

/**
 * Sample rows for projected-looking coordinate values (when headers are vague).
 * @param {object[]} rows
 * @param {string[]} fields
 * @returns {boolean}
 */
export function csvSampleLooksProjected(rows, fields) {
    const list = Array.isArray(rows) ? rows : [];
    const names = Array.isArray(fields) ? fields : [];
    const candidates = names.filter(isCsvCoordinateFieldName);
    if (!candidates.length) return false;
    for (const row of list.slice(0, 20)) {
        const nums = candidates
            .map((f) => Number(row?.[f]))
            .filter((n) => Number.isFinite(n));
        if (nums.length >= 2 && looksProjected(nums[0], nums[1])) return true;
    }
    return false;
}

export default {
    isCsvCoordinateFieldName,
    csvDynamicTypingForField,
    csvSampleLooksProjected
};
