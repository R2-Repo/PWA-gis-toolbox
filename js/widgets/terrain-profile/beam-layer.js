/**
 * 3D sight beam for the map that owns the scene.
 * Sampled altitudes are un-exaggerated meters above sea level.
 * MapLibre 4 draws terrain with modelViewProjectionMatrix, which subtracts
 * transform.elevation (already exaggerated). customLayerMatrix does not.
 * The altitude passed to MercatorCoordinate.fromLngLat is therefore
 * ground * exaggeration + height - transform.elevation, recomputed every frame.
 * Width is screen pixels. A world-space ribbon a few meters wide aliases into dots.
 */

export const LINE_OF_SITE_BEAM_LAYER_ID = 'gis-line-of-site-beam';

/** Full ribbon is twice this many CSS pixels, with a dark edge. */
export const BEAM_HALF_WIDTH_PX = 8;
/** Fraction of the half-width that stays the sight color. The rest is outline. */
export const BEAM_CORE_FRACTION = 0.62;

export const BEAM_VISIBLE_COLOR = [0.0, 0.878, 0.251, 1];
export const BEAM_BLOCKED_COLOR = [1.0, 0.176, 0.102, 1];
export const BEAM_OUTLINE_COLOR = [0.04, 0.04, 0.04, 1];

/** pos.xyz, prev.xyz, next.xyz, side */
export const BEAM_RIBBON_STRIDE = 10;

const VERT = `
attribute vec3 a_pos;
attribute vec3 a_prev;
attribute vec3 a_next;
attribute float a_side;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_halfWidthPx;
varying float v_side;
void main() {
    vec4 clip = u_matrix * vec4(a_pos, 1.0);
    vec4 clipPrev = u_matrix * vec4(a_prev, 1.0);
    vec4 clipNext = u_matrix * vec4(a_next, 1.0);
    vec2 b = clip.xy / max(abs(clip.w), 0.0001);
    vec2 a = clipPrev.xy / max(abs(clipPrev.w), 0.0001);
    vec2 c = clipNext.xy / max(abs(clipNext.w), 0.0001);
    vec2 dir = (b - a) + (c - b);
    float len = length(dir);
    dir = len > 0.00001 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);
    vec2 viewport = max(u_viewport, vec2(1.0));
    vec2 ndc = normal * a_side * u_halfWidthPx * 2.0 / viewport;
    gl_Position = clip;
    gl_Position.xy += ndc * clip.w;
    v_side = a_side;
}`;

const FRAG = `
precision mediump float;
uniform vec4 u_color;
uniform vec4 u_outline;
uniform float u_core;
varying float v_side;
void main() {
    gl_FragColor = abs(v_side) > u_core ? u_outline : u_color;
}`;

export const BEAM_VERTEX_SOURCE = VERT;
export const BEAM_FRAGMENT_SOURCE = FRAG;

/**
 * Exaggeration used by the terrain mesh. Prefer the live terrain object,
 * which is the multiplier already baked into transform.elevation.
 * @param {object | null | undefined} map
 * @returns {number}
 */
export function readTerrainExaggeration(map) {
    const candidates = [map?.terrain?.exaggeration, map?.getTerrain?.()?.exaggeration];
    for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 1;
}

/**
 * Exaggerated elevation at the camera center. The terrain matrix subtracts
 * this once. Zero when terrain is off.
 * @param {object | null | undefined} map
 * @returns {number}
 */
export function readCameraElevationM(map) {
    const n = Number(map?.transform?.elevation);
    return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object | null | undefined} map
 * @param {WebGLRenderingContext | null | undefined} gl
 * @returns {[number, number]}
 */
export function readBeamViewport(map, gl) {
    const w = Number(map?.transform?.width);
    const h = Number(map?.transform?.height);
    if (w > 0 && h > 0) return [w, h];
    const dw = Number(gl?.drawingBufferWidth);
    const dh = Number(gl?.drawingBufferHeight);
    if (dw > 0 && dh > 0) return [dw, dh];
    return [1, 1];
}

/**
 * Interpolated un-exaggerated ground and real height along the straight line.
 * @param {object} point
 * @param {object | null | undefined} frame
 * @returns {{ groundM: number, heightM: number } | null}
 */
function splitLineAltitude(point, frame) {
    if (!frame) return null;
    const g0 = Number(frame.observerGroundM);
    const g1 = Number(frame.targetGroundM);
    const h0 = Number(frame.observerHeightM);
    const h1 = Number(frame.targetHeightM);
    if (![g0, g1, h0, h1].every((value) => Number.isFinite(value))) return null;
    const total = Number(frame.totalDistanceM);
    const dist = Number(point?.distanceM);
    const t = Number.isFinite(total) && total > 0 && Number.isFinite(dist)
        ? Math.min(1, Math.max(0, dist / total))
        : 0;
    return {
        groundM: g0 + (t * (g1 - g0)),
        heightM: h0 + (t * (h1 - h0))
    };
}

/**
 * Meters to pass to MercatorCoordinate.fromLngLat for this map.
 * Ground is exaggerated once. Height stays real meters. Camera elevation
 * (already exaggerated) is subtracted once. Do not pass this result back in.
 * @param {object} point
 * @param {object | null | undefined} frame
 * @param {number} [exaggeration]
 * @param {number} [cameraElevationM]
 * @returns {number}
 */
export function beamVertexAltitudeM(point, frame, exaggeration = 1, cameraElevationM = 0) {
    const scaleValue = Number(exaggeration);
    const scale = Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
    const cameraValue = Number(cameraElevationM);
    const camera = Number.isFinite(cameraValue) ? cameraValue : 0;
    const split = splitLineAltitude(point, frame);
    if (split) return (split.groundM * scale) + split.heightM - camera;
    const absolute = Number(point?.altitudeM);
    const amsl = Number.isFinite(absolute) ? absolute : 0;
    return (amsl * scale) - camera;
}

/**
 * @param {object} point
 * @param {object | null | undefined} frame
 * @param {object | null | undefined} map
 * @returns {number}
 */
export function beamRenderAltitudeM(point, frame, map) {
    return beamVertexAltitudeM(
        point,
        frame,
        readTerrainExaggeration(map),
        readCameraElevationM(map)
    );
}

/**
 * Screen-space ribbon. Two vertices per point. `fromLngLat` receives the
 * altitude already converted for the custom-layer matrix.
 * @param {object[]} points
 * @param {(lngLat: [number, number], altitudeMeters: number) => { x: number, y: number, z: number }} fromLngLat
 * @param {{ altitudeOf?: (point: object) => number } | number} [options]
 * @returns {Float32Array}
 */
export function beamRibbonPositions(points, fromLngLat, options) {
    const altitudeOf = options && typeof options === 'object' && typeof options.altitudeOf === 'function'
        ? options.altitudeOf
        : (point) => point.altitudeM;
    if (!Array.isArray(points) || points.length < 2 || typeof fromLngLat !== 'function') {
        return new Float32Array(0);
    }
    const coords = points.map((point) => fromLngLat([point.lng, point.lat], altitudeOf(point)));
    const out = new Float32Array(coords.length * 2 * BEAM_RIBBON_STRIDE);
    let offset = 0;
    const write = (coord, prev, next, side) => {
        out[offset++] = coord.x;
        out[offset++] = coord.y;
        out[offset++] = coord.z;
        out[offset++] = prev.x;
        out[offset++] = prev.y;
        out[offset++] = prev.z;
        out[offset++] = next.x;
        out[offset++] = next.y;
        out[offset++] = next.z;
        out[offset++] = side;
    };
    for (let i = 0; i < coords.length; i += 1) {
        const prev = coords[Math.max(0, i - 1)];
        const next = coords[Math.min(coords.length - 1, i + 1)];
        write(coords[i], prev, next, -1);
        write(coords[i], prev, next, 1);
    }
    return out;
}

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

function createBeamLayer(fromLngLat) {
    return {
        id: LINE_OF_SITE_BEAM_LAYER_ID,
        type: 'custom',
        renderingMode: '3d',
        _beam: { visible: [], blocked: [], altitudeFrame: null },
        _fromLngLat: fromLngLat,
        _map: null,
        setBeam(beam) {
            this._beam = {
                visible: Array.isArray(beam?.visible) ? beam.visible : [],
                blocked: Array.isArray(beam?.blocked) ? beam.blocked : [],
                altitudeFrame: beam?.altitudeFrame || null
            };
        },
        onAdd(map, gl) {
            this._map = map;
            const program = gl.createProgram();
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(program);
            this._program = program;
            this._buffer = gl.createBuffer();
            this._matrix = gl.getUniformLocation(program, 'u_matrix');
            this._color = gl.getUniformLocation(program, 'u_color');
            this._outline = gl.getUniformLocation(program, 'u_outline');
            this._viewport = gl.getUniformLocation(program, 'u_viewport');
            this._halfWidth = gl.getUniformLocation(program, 'u_halfWidthPx');
            this._core = gl.getUniformLocation(program, 'u_core');
            this._pos = gl.getAttribLocation(program, 'a_pos');
            this._prev = gl.getAttribLocation(program, 'a_prev');
            this._next = gl.getAttribLocation(program, 'a_next');
            this._side = gl.getAttribLocation(program, 'a_side');
        },
        onRemove(_map, gl) {
            if (this._buffer) gl.deleteBuffer(this._buffer);
            if (this._program) gl.deleteProgram(this._program);
            this._buffer = null;
            this._program = null;
            this._map = null;
        },
        _draw(gl, matrix, points, color) {
            const frame = this._beam.altitudeFrame;
            const map = this._map;
            const data = beamRibbonPositions(points, this._fromLngLat, {
                altitudeOf: (point) => beamRenderAltitudeM(point, frame, map)
            });
            if (!this._program || data.length < BEAM_RIBBON_STRIDE * 4) return;
            const [viewportW, viewportH] = readBeamViewport(map, gl);
            gl.useProgram(this._program);
            gl.uniformMatrix4fv(this._matrix, false, matrix);
            gl.uniform4fv(this._color, color);
            gl.uniform4fv(this._outline, BEAM_OUTLINE_COLOR);
            gl.uniform2f(this._viewport, viewportW, viewportH);
            gl.uniform1f(this._halfWidth, BEAM_HALF_WIDTH_PX);
            gl.uniform1f(this._core, BEAM_CORE_FRACTION);
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            const stride = BEAM_RIBBON_STRIDE * 4;
            const bind = (loc, size, byteOffset) => {
                if (loc < 0) return;
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, byteOffset);
            };
            bind(this._pos, 3, 0);
            bind(this._prev, 3, 12);
            bind(this._next, 3, 24);
            bind(this._side, 1, 36);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, data.length / BEAM_RIBBON_STRIDE);
            for (const loc of [this._pos, this._prev, this._next, this._side]) {
                if (loc >= 0) gl.disableVertexAttribArray(loc);
            }
        },
        render(gl, matrix) {
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(-1, -2);
            this._draw(gl, matrix, this._beam.visible, BEAM_VISIBLE_COLOR);
            this._draw(gl, matrix, this._beam.blocked, BEAM_BLOCKED_COLOR);
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }
    };
}

/** @type {{ map: object, layer: object } | null} */
let active = null;

function mercatorFromLngLat() {
    const fromLngLat = globalThis.maplibregl?.MercatorCoordinate?.fromLngLat;
    if (typeof fromLngLat !== 'function') return null;
    return (lngLat, altitude) => fromLngLat(lngLat, altitude);
}

function beamHasLine(beam) {
    return (Array.isArray(beam?.visible) && beam.visible.length >= 2)
        || (Array.isArray(beam?.blocked) && beam.blocked.length >= 2);
}

/**
 * @param {object | null | undefined} map
 * @param {{ visible?: object[], blocked?: object[], altitudeFrame?: object } | null | undefined} beam
 */
export function syncLineOfSiteBeam(map, beam) {
    if (!map || typeof map.addLayer !== 'function') return;
    if (!beamHasLine(beam)) {
        removeLineOfSiteBeam(map);
        return;
    }
    const fromLngLat = mercatorFromLngLat();
    if (!fromLngLat) return;
    if (!active || active.map !== map || !map.getLayer?.(LINE_OF_SITE_BEAM_LAYER_ID)) {
        removeLineOfSiteBeam(map);
        const layer = createBeamLayer(fromLngLat);
        layer.setBeam(beam);
        try {
            map.addLayer(layer);
        } catch {
            return;
        }
        active = { map, layer };
        map.triggerRepaint?.();
        return;
    }
    active.layer._fromLngLat = fromLngLat;
    active.layer.setBeam(beam);
    map.triggerRepaint?.();
}

/** @param {object | null | undefined} map */
export function removeLineOfSiteBeam(map) {
    if (map && typeof map.getLayer === 'function' && map.getLayer(LINE_OF_SITE_BEAM_LAYER_ID)) {
        try {
            map.removeLayer(LINE_OF_SITE_BEAM_LAYER_ID);
        } catch {
            /* style no longer has the beam */
        }
    }
    if (!map || active?.map === map) active = null;
}
