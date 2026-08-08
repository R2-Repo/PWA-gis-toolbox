/**
 * Smooth ArcGIS-Firefly–style hotspot sprites (canvas radial gradients).
 * Avoids MapLibre circle-blur pixelation.
 */

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRgb(hex) {
    const h = String(hex || '#ff0000').replace('#', '');
    const full = h.length === 3
        ? h.split('').map((c) => c + c).join('')
        : h.padStart(6, '0').slice(0, 6);
    return [
        parseInt(full.slice(0, 2), 16) || 0,
        parseInt(full.slice(2, 4), 16) || 0,
        parseInt(full.slice(4, 6), 16) || 0
    ];
}

/**
 * @param {string} hex
 * @param {number} alpha 0–1
 */
function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Draw firefly onto a canvas (same hue, soft falloff, solid core).
 * @param {string} colorHex
 * @param {number} [size]
 * @returns {HTMLCanvasElement | null}
 */
export function makeFireflyCanvas(colorHex, size = 128) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2;

    ctx.clearRect(0, 0, size, size);

    // Outer feather (softer / quieter than before)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, rgba(colorHex, 0.38));
    glow.addColorStop(0.2, rgba(colorHex, 0.22));
    glow.addColorStop(0.45, rgba(colorHex, 0.1));
    glow.addColorStop(0.7, rgba(colorHex, 0.04));
    glow.addColorStop(1, rgba(colorHex, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Saturated core disc (anti-aliased by canvas)
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.2);
    core.addColorStop(0, rgba(colorHex, 0.78));
    core.addColorStop(0.7, rgba(colorHex, 0.55));
    core.addColorStop(1, rgba(colorHex, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
}

/**
 * @param {string} part
 * @param {string} colorHex
 */
export function fireflyImageId(part, colorHex) {
    const safe = String(colorHex || 'ff0000').replace('#', '');
    return `firewatch-firefly-${part}-${safe}`;
}

/**
 * Ensure a smooth Firefly sprite exists on the map.
 * @param {import('maplibre-gl').Map} map
 * @param {string} part
 * @param {string} colorHex
 * @returns {string | null} image id, or null if registration failed
 */
export function ensureFireflyImage(map, part, colorHex) {
    const id = fireflyImageId(part, colorHex);
    if (!map) return null;
    if (map.hasImage?.(id)) return id;

    try {
        const canvas = makeFireflyCanvas(colorHex, 128);
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        map.addImage(id, {
            width: canvas.width,
            height: canvas.height,
            data: new Uint8Array(imageData.data.buffer.slice(0))
        }, { pixelRatio: 2 });
        return id;
    } catch (error) {
        console.warn('[Firewatch] Firefly sprite failed', error);
        return null;
    }
}
