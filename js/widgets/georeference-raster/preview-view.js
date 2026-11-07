/**
 * Control-point view math: exact marker anchors, sharp zoom crops, canvas caps.
 * No DOM, map, or React.
 */

/** Crosshair box in CSS pixels. Stays this size at every zoom. */
export const MARKER_SIZE_PX = 13;
/** Label sits off the anchor so the point itself stays visible. */
export const MARKER_LABEL_OFFSET = { x: 8, y: -14 };

/** Interactive zoom canvas caps — one crop at a time, never a full-page blowup. */
export const PREVIEW_CANVAS_MAX_EDGE = 1536;
export const PREVIEW_CANVAS_MAX_PIXELS = 1536 * 1536;

export function clampGeorefOpacity(value, fallback = 0.7) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
}

/**
 * Pointer → source pixels. Uses the content box (clientLeft/clientTop) so a
 * 1px border does not shift the point. No rounding.
 */
export function pointerToSourcePx({
    clientX,
    clientY,
    rectLeft,
    rectTop,
    clientLeft = 0,
    clientTop = 0,
    viewX = 0,
    viewY = 0,
    viewScale = 1,
    displayWidth,
    displayHeight,
    sourceWidth,
    sourceHeight
}) {
    const scale = Number(viewScale);
    if (!(scale > 0)) return null;
    const localX = Number(clientX) - Number(rectLeft) - Number(clientLeft || 0);
    const localY = Number(clientY) - Number(rectTop) - Number(clientTop || 0);
    const displayX = (localX - Number(viewX || 0)) / scale;
    const displayY = (localY - Number(viewY || 0)) / scale;
    const dw = Number(displayWidth);
    const dh = Number(displayHeight);
    if (!(dw > 0) || !(dh > 0)) return null;
    if (displayX < 0 || displayY < 0 || displayX > dw || displayY > dh) return null;
    const sw = Number(sourceWidth) > 0 ? Number(sourceWidth) : dw;
    const sh = Number(sourceHeight) > 0 ? Number(sourceHeight) : dh;
    return {
        displayX,
        displayY,
        x: displayX * (sw / dw),
        y: displayY * (sh / dh)
    };
}

/**
 * Source pixel → viewport CSS pixel. Markers use this (not the scaled image)
 * so their screen size does not change with zoom.
 */
export function sourcePxToViewport({
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
    viewX = 0,
    viewY = 0,
    viewScale = 1
}) {
    const sw = Math.max(1e-9, Number(sourceWidth) || 1);
    const sh = Math.max(1e-9, Number(sourceHeight) || 1);
    const dw = Number(displayWidth) > 0 ? Number(displayWidth) : sw;
    const dh = Number(displayHeight) > 0 ? Number(displayHeight) : sh;
    const displayX = Number(sourceX) * (dw / sw);
    const displayY = Number(sourceY) * (dh / sh);
    const scale = Number(viewScale) > 0 ? Number(viewScale) : 1;
    return {
        x: Number(viewX || 0) + displayX * scale,
        y: Number(viewY || 0) + displayY * scale
    };
}

export function markerAnchorStyle(viewportPoint) {
    return {
        left: viewportPoint.x,
        top: viewportPoint.y,
        width: MARKER_SIZE_PX,
        height: MARKER_SIZE_PX,
        screenSizePx: MARKER_SIZE_PX
    };
}

function clampVisible(start, size, limit) {
    let x = start;
    let w = size;
    if (x < 0) {
        w += x;
        x = 0;
    }
    if (x + w > limit) w = limit - x;
    return { x, w };
}

/**
 * Visible window of the unscaled preview image, in display pixels.
 */
export function visibleDisplayRect({
    viewX = 0,
    viewY = 0,
    viewScale = 1,
    viewportWidth,
    viewportHeight,
    displayWidth,
    displayHeight
}) {
    const scale = Number(viewScale);
    const vw = Number(viewportWidth);
    const vh = Number(viewportHeight);
    const dw = Number(displayWidth);
    const dh = Number(displayHeight);
    if (!(scale > 0) || !(vw > 0) || !(vh > 0) || !(dw > 0) || !(dh > 0)) return null;
    const rawLeft = -Number(viewX || 0) / scale;
    const rawTop = -Number(viewY || 0) / scale;
    const left = rawLeft === 0 ? 0 : rawLeft;
    const top = rawTop === 0 ? 0 : rawTop;
    const xClamp = clampVisible(left, vw / scale, dw);
    const yClamp = clampVisible(top, vh / scale, dh);
    if (!(xClamp.w > 0) || !(yClamp.w > 0)) return null;
    return { x: xClamp.x, y: yClamp.x, width: xClamp.w, height: yClamp.w };
}

function capOutputSize(width, height, maxEdge, maxPixels) {
    let outW = Math.max(1, Math.round(width));
    let outH = Math.max(1, Math.round(height));
    let capped = false;
    const edge = Math.max(outW, outH);
    if (edge > maxEdge) {
        const s = maxEdge / edge;
        outW = Math.max(1, Math.floor(outW * s));
        outH = Math.max(1, Math.floor(outH * s));
        capped = true;
    }
    if (outW * outH > maxPixels) {
        const s = Math.sqrt(maxPixels / (outW * outH));
        outW = Math.max(1, Math.floor(outW * s));
        outH = Math.max(1, Math.floor(outH * s));
        capped = true;
    }
    return { outputWidth: outW, outputHeight: outH, capped };
}

/**
 * Plan a sharp crop of the visible region.
 * limitToSourcePixels: images cannot invent pixels past the file.
 * PDFs leave it false so vectors re-render above the working raster.
 */
export function planZoomPreview({
    viewX = 0,
    viewY = 0,
    viewScale = 1,
    viewportWidth,
    viewportHeight,
    displayWidth,
    displayHeight,
    sourceWidth,
    sourceHeight,
    devicePixelRatio = 1,
    maxEdge = PREVIEW_CANVAS_MAX_EDGE,
    maxPixels = PREVIEW_CANVAS_MAX_PIXELS,
    limitToSourcePixels = false
} = {}) {
    const display = visibleDisplayRect({
        viewX,
        viewY,
        viewScale,
        viewportWidth,
        viewportHeight,
        displayWidth,
        displayHeight
    });
    if (!display) return null;
    const sw = Number(sourceWidth);
    const sh = Number(sourceHeight);
    const dw = Number(displayWidth);
    const dh = Number(displayHeight);
    if (!(sw > 0) || !(sh > 0)) return null;

    const sx0 = display.x * (sw / dw);
    const sy0 = display.y * (sh / dh);
    const xClamp = clampVisible(sx0, display.width * (sw / dw), sw);
    const yClamp = clampVisible(sy0, display.height * (sh / dh), sh);
    if (!(xClamp.w > 0) || !(yClamp.w > 0)) return null;

    const dpr = Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1;
    const scale = Number(viewScale) > 0 ? Number(viewScale) : 1;
    let desiredW = display.width * scale * dpr;
    let desiredH = display.height * scale * dpr;
    let capped = false;

    if (limitToSourcePixels) {
        const srcW = Math.max(1, xClamp.w);
        const srcH = Math.max(1, yClamp.w);
        if (desiredW > srcW || desiredH > srcH) {
            const s = Math.min(srcW / desiredW, srcH / desiredH);
            desiredW *= s;
            desiredH *= s;
            capped = true;
        }
    }

    const edgeCap = Math.max(1, Number(maxEdge) || PREVIEW_CANVAS_MAX_EDGE);
    const pixelCap = Math.max(1, Number(maxPixels) || PREVIEW_CANVAS_MAX_PIXELS);
    const sized = capOutputSize(desiredW, desiredH, edgeCap, pixelCap);

    return {
        sourceRect: { x: xClamp.x, y: yClamp.x, width: xClamp.w, height: yClamp.w },
        displayRect: display,
        sourceWidth: sw,
        sourceHeight: sh,
        outputWidth: sized.outputWidth,
        outputHeight: sized.outputHeight,
        pixels: sized.outputWidth * sized.outputHeight,
        bytes: sized.outputWidth * sized.outputHeight * 4,
        capped: capped || sized.capped,
        maxEdge: edgeCap,
        maxPixels: pixelCap
    };
}

/** True when a zoom canvas would show more samples than the working bitmap. */
export function previewCanvasHelps(plan) {
    if (!plan?.displayRect) return false;
    const working = plan.displayRect.width * plan.displayRect.height;
    if (!(working > 0)) return false;
    return plan.pixels > working * 1.08;
}

/**
 * Integer crop inside the file. createImageBitmap rejects out-of-range rects.
 */
export function imageSampleRect(sourceRect, sourceWidth, sourceHeight) {
    const sw = Math.max(1, Math.floor(Number(sourceWidth) || 0));
    const sh = Math.max(1, Math.floor(Number(sourceHeight) || 0));
    const x = Math.max(0, Math.min(sw - 1, Math.floor(Number(sourceRect?.x) || 0)));
    const y = Math.max(0, Math.min(sh - 1, Math.floor(Number(sourceRect?.y) || 0)));
    const right = Math.max(x + 1, Math.min(sw, Math.ceil((Number(sourceRect?.x) || 0) + (Number(sourceRect?.width) || 0))));
    const bottom = Math.max(y + 1, Math.min(sh, Math.ceil((Number(sourceRect?.y) || 0) + (Number(sourceRect?.height) || 0))));
    return { x, y, width: right - x, height: bottom - y };
}

/**
 * pdf.js viewport placement for a source-pixel crop.
 * Additional transform is applied before the page viewport transform.
 * Returns scale + translation so the crop's top-left lands on canvas (0, 0).
 */
export function pdfPreviewPlacement({
    baseWidth,
    baseHeight,
    sourceWidth,
    sourceHeight,
    sourceRect,
    outputWidth,
    outputHeight
}) {
    const pageW = Number(baseWidth);
    const pageH = Number(baseHeight);
    const sw = Number(sourceWidth);
    const sh = Number(sourceHeight);
    const cropW = (Number(sourceRect?.width) / sw) * pageW;
    const cropH = (Number(sourceRect?.height) / sh) * pageH;
    const outW = Math.max(1, Number(outputWidth) || 1);
    const outH = Math.max(1, Number(outputHeight) || 1);
    const scale = Math.min(outW / Math.max(cropW, 1e-9), outH / Math.max(cropH, 1e-9));
    const vpWidth = pageW * scale;
    const vpHeight = pageH * scale;
    const tx = -(Number(sourceRect?.x) / sw) * vpWidth;
    const ty = -(Number(sourceRect?.y) / sh) * vpHeight;
    return {
        scale,
        transform: [1, 0, 0, 1, tx, ty],
        vpWidth,
        vpHeight
    };
}

/**
 * Drop the previous bitmap before allocating the next size.
 * Same-size updates keep the buffer (caller overwrites pixels).
 */
export function assignPreviewCanvas(canvas, width, height) {
    if (!canvas) return { releasedPixels: 0, pixels: 0, width: 0, height: 0 };
    const prevW = Math.max(0, Number(canvas.width) || 0);
    const prevH = Math.max(0, Number(canvas.height) || 0);
    const nextW = Math.max(1, Math.floor(Number(width) || 1));
    const nextH = Math.max(1, Math.floor(Number(height) || 1));
    if (prevW === nextW && prevH === nextH) {
        return { releasedPixels: 0, pixels: nextW * nextH, width: nextW, height: nextH };
    }
    const releasedPixels = prevW * prevH;
    canvas.width = 0;
    canvas.height = 0;
    canvas.width = nextW;
    canvas.height = nextH;
    return { releasedPixels, pixels: nextW * nextH, width: nextW, height: nextH };
}

export function releasePreviewCanvas(canvas) {
    if (!canvas) return { releasedPixels: 0 };
    const releasedPixels = Math.max(0, Number(canvas.width) || 0) * Math.max(0, Number(canvas.height) || 0);
    canvas.width = 0;
    canvas.height = 0;
    return { releasedPixels };
}
