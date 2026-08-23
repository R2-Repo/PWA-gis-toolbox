/**
 * Shared Plan Set Callout look: map preview and PDF overlay use the same
 * solid red leaders/circles, black numbers, and relative sizes.
 */

/** CSS px per PDF point at 96dpi so map paint matches paper size. */
export const CALLOUT_PX_PER_PT = 96 / 72;

export const CALLOUT_STROKE_HEX = '#CC0000';
export const CALLOUT_STROKE_RGB = [204, 0, 0];
export const CALLOUT_TEXT_HEX = '#111111';
export const CALLOUT_TEXT_RGB = [17, 17, 17];
export const CALLOUT_FILL_HEX = '#ffffff';
export const CALLOUT_FILL_RGB = [255, 255, 255];
export const CALLOUT_TABLE_STROKE_RGB = [204, 0, 0];

/** PDF points. Sized to match on-screen MapLibre circles at 96dpi. */
export const CALLOUT_PDF_CIRCLE_R = 7.5;
export const CALLOUT_PDF_LINE_WIDTH = 1.2;
export const CALLOUT_PDF_FONT_SIZE = 7;
export const CALLOUT_PDF_CIRCLE_GAP = CALLOUT_PDF_CIRCLE_R * 2 + 0.8;
export const CALLOUT_PDF_TEXT_DY = 2.7;
export const CALLOUT_PDF_TABLE_TITLE_SIZE = 10;
export const CALLOUT_PDF_TABLE_TEXT_SIZE = 8;
export const CALLOUT_PDF_TABLE_ROW_H = 15;
export const CALLOUT_PDF_TABLE_TITLE_H = 17;
export const CALLOUT_PDF_TABLE_PAD = 8;
export const CALLOUT_PDF_TABLE_LINE_WIDTH = 1.15;
export const CALLOUT_PDF_TABLE_COL_GUTTER = 10;
export const CALLOUT_PDF_TABLE_CUTOUT_GAP = 10;
export const CALLOUT_PDF_TABLE_PAGE_INSET = 8;
export const CALLOUT_PDF_TABLE_MIN_COL_W = 96;
export const CALLOUT_PDF_TABLE_MAX_COL_W = 260;
export const CALLOUT_PDF_TABLE_MAX_COLS = 6;
export const CALLOUT_PDF_TABLE_MIN_W = 128;

export const CALLOUT_MAP_CIRCLE_RADIUS_PX = CALLOUT_PDF_CIRCLE_R * CALLOUT_PX_PER_PT;
export const CALLOUT_MAP_STROKE_PX = CALLOUT_PDF_LINE_WIDTH * CALLOUT_PX_PER_PT;
export const CALLOUT_MAP_LINE_WIDTH_PX = CALLOUT_PDF_LINE_WIDTH * CALLOUT_PX_PER_PT;
export const CALLOUT_MAP_FONT_SIZE_PX = CALLOUT_PDF_FONT_SIZE * CALLOUT_PX_PER_PT;
export const CALLOUT_MAP_CIRCLE_GAP_PX = CALLOUT_PDF_CIRCLE_GAP * CALLOUT_PX_PER_PT;
export const CALLOUT_MAP_MAX_STACK = 8;

/** Keep the numbered circle fully inside the gold sheet polygon. */
export const SHEET_BUBBLE_INSET_FT = 22;
