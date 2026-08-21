/**
 * jsPDF drawing for UDOT Fiber lookalike glyphs and line stacks.
 */

function parseHexColor(hex) {
    const raw = String(hex || '#000000').replace('#', '').trim();
    if (raw.length === 3) {
        return {
            r: parseInt(raw[0] + raw[0], 16),
            g: parseInt(raw[1] + raw[1], 16),
            b: parseInt(raw[2] + raw[2], 16)
        };
    }
    return {
        r: parseInt(raw.slice(0, 2), 16) || 0,
        g: parseInt(raw.slice(2, 4), 16) || 0,
        b: parseInt(raw.slice(4, 6), 16) || 0
    };
}

function applyStroke(doc, hex) {
    const { r, g, b } = parseHexColor(hex);
    doc.setDrawColor(r, g, b);
}

function applyFill(doc, hex) {
    const { r, g, b } = parseHexColor(hex);
    doc.setFillColor(r, g, b);
}

function mixHex(a, b, t) {
    const A = parseHexColor(a);
    const B = parseHexColor(b);
    const byte = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${byte(A.r + (B.r - A.r) * t)}${byte(A.g + (B.g - A.g) * t)}${byte(A.b + (B.b - A.b) * t)}`;
}

function rotatePoint(x, y, cx, cy, deg) {
    const rad = ((Number(deg) || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - cx;
    const dy = y - cy;
    return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos
    };
}

function fillPolygon(doc, points) {
    if (points.length < 3) return;
    if (typeof doc.lines === 'function') {
        const rel = [];
        for (let i = 1; i < points.length; i++) {
            rel.push([points[i].x - points[i - 1].x, points[i].y - points[i - 1].y]);
        }
        doc.lines(rel, points[0].x, points[0].y, [1, 1], 'FD', true);
        return;
    }
    for (let i = 1; i < points.length; i++) {
        doc.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    }
    doc.line(points[points.length - 1].x, points[points.length - 1].y, points[0].x, points[0].y);
}

/**
 * Draw a lookalike Fiber glyph at a PDF point.
 * Rotation is geographic clockwise-from-north minus the current map bearing.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number }} point
 * @param {{ kind: string, color: string, rotationDeg?: number }} glyph
 * @param {number} sizePt
 * @param {number} [mapBearingDeg]
 */
export function drawUdotFiberPdfGlyph(doc, point, glyph, sizePt, mapBearingDeg = 0) {
    if (!point || !glyph?.kind) return;
    const size = Math.max(4, Number(sizePt) || 8);
    const color = glyph.color || '#111111';
    const ink = mixHex(color, '#000000', 0.28);
    const body = mixHex(color, '#ffffff', 0.18);
    const angle = (Number(glyph.rotationDeg) || 0) - (Number(mapBearingDeg) || 0);
    const cx = point.x;
    const cy = point.y;
    const sw = Math.max(0.45, size / 14);
    const at = (lx, ly) => rotatePoint(cx + lx, cy + ly, cx, cy, angle);

    applyStroke(doc, ink);
    applyFill(doc, body);
    doc.setLineWidth(sw);

    const kind = glyph.kind;
    if (kind === 'rect' || kind === 'dashed-box' || kind === 'rounded-square' || kind === 'square-x') {
        const rw = kind === 'rect' ? size * 0.68 : size * 0.64;
        const rh = kind === 'rect' ? size * 0.42 : size * 0.64;
        const corners = [
            at(-rw / 2, -rh / 2),
            at(rw / 2, -rh / 2),
            at(rw / 2, rh / 2),
            at(-rw / 2, rh / 2)
        ];
        if (kind === 'dashed-box') doc.setLineDashPattern?.([sw * 2.1, sw * 1.4], 0);
        fillPolygon(doc, corners);
        doc.setLineDashPattern?.([], 0);
        if (kind === 'square-x') {
            const a = at(-rw / 2 + sw, -rh / 2 + sw);
            const b = at(rw / 2 - sw, rh / 2 - sw);
            const c = at(rw / 2 - sw, -rh / 2 + sw);
            const d = at(-rw / 2 + sw, rh / 2 - sw);
            doc.line(a.x, a.y, b.x, b.y);
            doc.line(c.x, c.y, d.x, d.y);
        }
        return;
    }

    if (kind === 'ring' || kind === 'circle' || kind === 'vee-circle') {
        const r = size * (kind === 'ring' ? 0.34 : 0.3);
        doc.circle(cx, cy, r, 'FD');
        if (kind === 'vee-circle') {
            const left = at(-r * 0.4, -r * 0.32);
            const mid = at(0, r * 0.36);
            const right = at(r * 0.4, -r * 0.32);
            doc.line(left.x, left.y, mid.x, mid.y);
            doc.line(mid.x, mid.y, right.x, right.y);
        }
        return;
    }

    if (kind === 'diamond') {
        fillPolygon(doc, [at(0, -size * 0.34), at(size * 0.32, 0), at(0, size * 0.34), at(-size * 0.32, 0)]);
        return;
    }

    if (kind === 'hex') {
        const r = size * 0.34;
        const pts = [0, 1, 2, 3, 4, 5].map((i) => {
            const a = (Math.PI / 180) * (60 * i - 30);
            return at(r * Math.cos(a), r * Math.sin(a));
        });
        fillPolygon(doc, pts);
        return;
    }

    if (kind === 'bowtie') {
        fillPolygon(doc, [at(-size * 0.38, -size * 0.28), at(0, 0), at(-size * 0.38, size * 0.28)]);
        fillPolygon(doc, [at(size * 0.38, -size * 0.28), at(0, 0), at(size * 0.38, size * 0.28)]);
        return;
    }

    if (kind === 'building') {
        const w = size * 0.32;
        fillPolygon(doc, [at(0, -size * 0.36), at(-w, -size * 0.08), at(w, -size * 0.08)]);
        fillPolygon(doc, [at(-w, -size * 0.08), at(w, -size * 0.08), at(w, size * 0.32), at(-w, size * 0.32)]);
        return;
    }

    doc.circle(cx, cy, size * 0.3, 'FD');
}

/**
 * Midpoint along a projected polyline (by segment length).
 * @param {Array<{ x: number, y: number }>} points
 */
export function midpointAlongPolyline(points) {
    if (!points?.length) return null;
    if (points.length === 1) return points[0];
    let total = 0;
    const segs = [];
    for (let i = 1; i < points.length; i++) {
        const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        segs.push({ from: points[i - 1], to: points[i], len });
        total += len;
    }
    if (total <= 1e-6) return points[0];
    let remain = total / 2;
    for (const seg of segs) {
        if (remain <= seg.len) {
            const t = seg.len ? remain / seg.len : 0;
            return {
                x: seg.from.x + (seg.to.x - seg.from.x) * t,
                y: seg.from.y + (seg.to.y - seg.from.y) * t,
                angle: (Math.atan2(seg.to.y - seg.from.y, seg.to.x - seg.from.x) * 180) / Math.PI
            };
        }
        remain -= seg.len;
    }
    const last = segs[segs.length - 1];
    return {
        x: last.to.x,
        y: last.to.y,
        angle: (Math.atan2(last.to.y - last.from.y, last.to.x - last.from.x) * 180) / Math.PI
    };
}

/**
 * Keep along-line text upright (same idea as MapLibre text-keep-upright).
 * @param {number} angleDeg
 */
export function keepPdfTextUpright(angleDeg) {
    let angle = Number(angleDeg) || 0;
    while (angle > 90) angle -= 180;
    while (angle < -90) angle += 180;
    return angle;
}
