/**
 * 3D sight beam for the map that owns the scene.
 * Positions use MercatorCoordinate altitude in meters, so the beam is a
 * straight line through terrain. Visible and blocked parts are separate strips.
 */

export const LINE_OF_SITE_BEAM_LAYER_ID = 'gis-line-of-site-beam';

const BEAM_HALF_WIDTH_M = 4;
const VISIBLE_COLOR = [0.082, 0.502, 0.239, 1];
const BLOCKED_COLOR = [0.725, 0.110, 0.110, 1];
const EQUATOR_METER = 1 / 40075016.68557849;

const VERT = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
void main() {
    gl_Position = u_matrix * vec4(a_pos, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform vec4 u_color;
void main() {
    gl_FragColor = u_color;
}`;

/**
 * Triangle-strip ribbon. `fromLngLat(lngLat, altitudeMeters)` is MercatorCoordinate.fromLngLat.
 * @param {object[]} points
 * @param {(lngLat: [number, number], altitudeMeters: number) => { x: number, y: number, z: number, meterInMercatorCoordinateUnits?: () => number }} fromLngLat
 * @param {number} [halfWidthM]
 * @returns {Float32Array}
 */
export function beamRibbonPositions(points, fromLngLat, halfWidthM = BEAM_HALF_WIDTH_M) {
    if (!Array.isArray(points) || points.length < 2 || typeof fromLngLat !== 'function') {
        return new Float32Array(0);
    }
    const coords = points.map((point) => fromLngLat([point.lng, point.lat], point.altitudeM));
    const out = new Float32Array(coords.length * 6);
    let offset = 0;
    for (let i = 0; i < coords.length; i += 1) {
        const prev = coords[Math.max(0, i - 1)];
        const next = coords[Math.min(coords.length - 1, i + 1)];
        let dx = next.x - prev.x;
        let dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const unit = typeof coords[i].meterInMercatorCoordinateUnits === 'function'
            ? coords[i].meterInMercatorCoordinateUnits()
            : EQUATOR_METER;
        const w = unit * halfWidthM;
        out[offset++] = coords[i].x + (-dy * w);
        out[offset++] = coords[i].y + (dx * w);
        out[offset++] = coords[i].z;
        out[offset++] = coords[i].x - (-dy * w);
        out[offset++] = coords[i].y - (dx * w);
        out[offset++] = coords[i].z;
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
        _beam: { visible: [], blocked: [] },
        _fromLngLat: fromLngLat,
        setBeam(beam) {
            this._beam = {
                visible: Array.isArray(beam?.visible) ? beam.visible : [],
                blocked: Array.isArray(beam?.blocked) ? beam.blocked : []
            };
        },
        onAdd(_map, gl) {
            const program = gl.createProgram();
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(program);
            this._program = program;
            this._buffer = gl.createBuffer();
            this._matrix = gl.getUniformLocation(program, 'u_matrix');
            this._color = gl.getUniformLocation(program, 'u_color');
        },
        onRemove(_map, gl) {
            if (this._buffer) gl.deleteBuffer(this._buffer);
            if (this._program) gl.deleteProgram(this._program);
            this._buffer = null;
            this._program = null;
        },
        _draw(gl, matrix, points, color) {
            const data = beamRibbonPositions(points, this._fromLngLat);
            if (!this._program || data.length < 12) return;
            gl.useProgram(this._program);
            gl.uniformMatrix4fv(this._matrix, false, matrix);
            gl.uniform4fv(this._color, color);
            gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            const loc = gl.getAttribLocation(this._program, 'a_pos');
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, data.length / 3);
            gl.disableVertexAttribArray(loc);
        },
        render(gl, matrix) {
            this._draw(gl, matrix, this._beam.visible, VISIBLE_COLOR);
            this._draw(gl, matrix, this._beam.blocked, BLOCKED_COLOR);
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
 * @param {{ visible?: object[], blocked?: object[] } | null | undefined} beam
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
