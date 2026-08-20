/**
 * UDOT Splices enclosure types live on MODEL (alias also "MODEL").
 * ArcGIS drawingInfo styles MODEL_1 (ButtSplice / RingCut) — that is not
 * the enclosure symbol the CAD map uses.
 */

export const UDOT_SPLICE_CLASS_FIELD = 'MODEL';

/** @typedef {'circle'|'ring'|'square-x'|'bowtie'|'dashed-box'|'diamond'|'vee-circle'} UdotGlyphKind */

/**
 * @type {ReadonlyArray<{ value: string, label: string, color: string, glyph: UdotGlyphKind }>}
 */
export const UDOT_SPLICE_ENCLOSURES = Object.freeze([
    { value: 'Telco Handoff', label: 'Telco Handoff', color: '#ff0000', glyph: 'bowtie' },
    { value: 'Endpoint', label: 'Endpoint', color: '#ff0000', glyph: 'bowtie' },
    { value: 'Others', label: 'Others', color: '#ff0000', glyph: 'bowtie' },
    { value: 'UDOT SPEC Full', label: 'UDOT SPEC Full', color: '#ff0000', glyph: 'bowtie' },
    { value: 'UDOT SPEC Mid-Sheath', label: 'UDOT SPEC Mid-Sheath', color: '#ff0000', glyph: 'bowtie' },
    { value: 'Non-SPEC Full', label: 'Non-SPEC Full', color: '#ff0000', glyph: 'bowtie' },
    { value: 'Non-SPEC Mid-Sheath', label: 'Non-SPEC Mid-Sheath', color: '#ff0000', glyph: 'bowtie' },
    { value: 'Needs Verify Full', label: 'Needs Verify Full', color: '#ff0000', glyph: 'bowtie' },
    { value: 'Needs Verify Mid-Sheath', label: 'Needs Verify Mid-Sheath', color: '#ff0000', glyph: 'bowtie' }
]);

const BY_VALUE = new Map(
    UDOT_SPLICE_ENCLOSURES.map((row) => [row.value.trim().toLowerCase(), row])
);

/**
 * @param {Record<string, unknown>} [props]
 * @returns {{ value: string, label: string, color: string, glyph: UdotGlyphKind }|null}
 */
export function resolveSpliceEnclosure(props = {}) {
    const raw = props[UDOT_SPLICE_CLASS_FIELD];
    if (raw == null || raw === '') return null;
    return BY_VALUE.get(String(raw).trim().toLowerCase()) || null;
}
