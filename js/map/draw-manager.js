/**
 * Draw Manager — Create and edit features directly on the map
 * Supports drawing points, lines, and polygons into a target layer.
 * Uses native MapLibre GL JS events (no external draw library required).
 */
import bus from '../core/event-bus.js';
import logger from '../core/logger.js';
import mapService from './map-service.js';
import { showModal } from '../ui/modals.js';
import { collectEditableVertices, applyVertexMove } from './editable-vertices.js';
import {
    ANNOTATION_TYPES,
    DEFAULT_ANNOTATION_STYLE,
    isAnnotationFeature,
    normalizeAnnotationProperties
} from './map-annotations.js';

const DRAW_STYLE = {
    lineColor: '#01bcdd',
    lineWidth: 3,
    lineOpacity: 0.9,
    fillColor: '#01bcdd',
    fillOpacity: 0.3,
    lineDasharray: [6, 4]
};

const VERTEX_STYLE = {
    radius: 5,
    fillColor: '#fff',
    strokeColor: '#01bcdd',
    strokeWidth: 2
};

let _drawIdCounter = 0;
function _nextDrawId(prefix) { return `draw-${prefix}-${++_drawIdCounter}`; }

class DrawManager {
    constructor() {
        this._active = false;
        this._tool = null;          // 'point' | 'line' | 'polygon' | null
        this._targetLayerId = null;  // layer ID to add features to
        this._vertices = [];         // current drawing vertices [{lat, lng}]
        this._vertexMarkers = [];    // MapLibre Marker instances for vertices
        this._previewSourceId = null;
        this._previewLayerIds = [];
        this._rubberBandSourceId = null;
        this._rubberBandLayerIds = [];
        this._toolbar = null;        // DOM element for draw toolbar
        this._toolbarLayerName = '';
        this._toolbarHint = '';
        this._reactToolbarMount = null;
        this._mountDrawToolbarFn = null;
        this._escHandler = null;
        this._clickHandler = null;
        this._moveHandler = null;
        this._dblClickHandler = null;
        this._clickTimeout = null;   // debounce clicks vs dblclick
        this._finishing = false;     // guard to prevent clicks during finish
        this._lastTapTime = 0;       // for mobile double-tap detection
        this._selectedFeatureIndex = null;
        this._editMarkers = [];
        this._editFeatureRef = null;
        this._contextHandler = null;
        this._rectCorner1 = null;
        this._rectPreviewSourceId = null;
        this._rectPreviewLayerIds = [];
        this._circleCenter = null;
        this._circlePreviewSourceId = null;
        this._circlePreviewLayerIds = [];
        this._sectorCenter = null;
        this._sectorRadius = null;
        this._sectorStartAngle = null;
        this._sectorPreviewSourceId = null;
        this._sectorPreviewLayerIds = [];
        this._calloutAnchor = null;
        this._calloutPreviewSourceId = null;
        this._calloutPreviewLayerIds = [];
        this._lastAnnotationStyle = { ...DEFAULT_ANNOTATION_STYLE };
        this._annotationDialogOpen = false;
        this._selectDblClickHandler = null;
    }

    /** Get the MapLibre map instance */
    get map() { return mapService.map; }

    /** Is drawing currently active? */
    get isDrawing() { return this._active && this._tool !== null; }

    /** Get the active tool name */
    get activeTool() { return this._tool; }

    /** Get the target layer ID */
    get targetLayerId() { return this._targetLayerId; }

    /** Snapshot of the feature currently selected in draw/select mode. */
    getSelectedFeatureSnapshot() {
        if (this._selectedFeatureIndex === null || !this._editFeatureRef) return null;
        return {
            layerId: this._targetLayerId,
            feature: JSON.parse(JSON.stringify(this._editFeatureRef))
        };
    }

    // ============================
    // Toolbar UI
    // ============================

    showToolbar(layerId, layerName) {
        this.hideToolbar();
        this._targetLayerId = layerId;
        this._toolbarLayerName = layerName;
        this._toolbarHint = '';

        const toolbar = document.createElement('div');
        toolbar.className = 'draw-toolbar-react-host';
        toolbar.addEventListener('click', (e) => e.stopPropagation());
        toolbar.addEventListener('dblclick', (e) => e.stopPropagation());
        toolbar.addEventListener('mousedown', (e) => e.stopPropagation());

        this.map.getContainer().appendChild(toolbar);
        this._toolbar = toolbar;
        this._active = true;
        void this._mountOrUpdateReactToolbar();

        logger.debug('Draw', `Draw toolbar opened for layer: ${layerName}`);
        bus.emit('draw:toolbarOpened', { layerId });
    }

    hideToolbar() {
        this.cancelDraw();
        if (this._reactToolbarMount) {
            this._reactToolbarMount.unmount?.();
            this._reactToolbarMount = null;
        }
        if (this._toolbar) {
            this._toolbar.remove();
            this._toolbar = null;
        }
        this._active = false;
        this._targetLayerId = null;
        this._toolbarLayerName = '';
        this._toolbarHint = '';
        bus.emit('draw:toolbarClosed');
    }

    _setHint(text) {
        this._toolbarHint = text || '';
        void this._mountOrUpdateReactToolbar();
    }

    _updateToolButtons() {
        void this._mountOrUpdateReactToolbar();
    }

    _getToolbarUiState() {
        const minVerts = this._tool === 'polygon' ? 3 : 2;
        const showFinish = (this._tool === 'line' || this._tool === 'polygon') && this._vertices.length >= minVerts;
        const showUndo = (this._tool === 'line' || this._tool === 'polygon') && this._vertices.length > 0;
        const showDelete = this._selectedFeatureIndex !== null;
        const showEdit = this._selectedFeatureIndex !== null && isAnnotationFeature(this._editFeatureRef);
        return {
            layerName: this._toolbarLayerName,
            activeTool: this._tool,
            hint: this._toolbarHint || '',
            showFinish,
            showUndo,
            showDelete,
            showEdit,
            onClose: () => this.hideToolbar(),
            onToggleTool: (tool) => {
                if (this._tool === tool) {
                    this.cancelDraw();
                } else {
                    this.startTool(tool);
                }
            },
            onUndo: () => this._undoLastVertex(),
            onDelete: () => this._deleteSelected(),
            onEdit: () => this._editSelectedAnnotation(),
            onFinish: () => this._finishDraw()
        };
    }

    async _mountOrUpdateReactToolbar() {
        if (!this._toolbar) return;
        const props = this._getToolbarUiState();

        if (!this._reactToolbarMount) {
            if (!this._mountDrawToolbarFn) {
                const { mountDrawToolbar } = await import('../../react/map/mountDrawToolbar.jsx');
                this._mountDrawToolbarFn = mountDrawToolbar;
            }
            if (!this._toolbar) return;
            this._reactToolbarMount = this._mountDrawToolbarFn(this._toolbar, props);
            return;
        }

        this._reactToolbarMount.update?.(props);
    }

    // ============================
    // Drawing tools
    // ============================

    startTool(tool) {
        this.cancelDraw();
        this._tool = tool;
        this._vertices = [];
        this._finishing = false;
        this._updateToolButtons();

        mapService.blockSelection?.();

        // Edit Vertices — click to select one feature and drag vertices
        if (tool === 'select') {
            this.map.getCanvas().style.cursor = '';
            this._setHint('Click a feature to edit. Drag vertices to reshape.');
            this._clickHandler = (e) => this._onSelectClick(e);
            this._selectDblClickHandler = (e) => this._onSelectDblClick(e);
            this.map.on('click', this._clickHandler);
            this.map.on('dblclick', this._selectDblClickHandler);
            this._escHandler = (e) => {
                if (e.key === 'Escape') { this._clearEditSelection(); this.cancelDraw(); }
                if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedFeatureIndex !== null) {
                    this._deleteSelected();
                }
            };
            document.addEventListener('keydown', this._escHandler);
            logger.debug('Draw', 'Started tool: select');
            return;
        }

        // Text label — click to place, then enter text in dialog
        if (tool === 'text') {
            this.map.getCanvas().style.cursor = 'crosshair';
            this._setHint('Click on the map to place a text label.');
            this._clickHandler = (e) => this._onTextClick(e);
            this._escHandler = (e) => { if (e.key === 'Escape') this.cancelDraw(); };
            this.map.on('click', this._clickHandler);
            document.addEventListener('keydown', this._escHandler);
            logger.debug('Draw', 'Started tool: text');
            return;
        }

        // Callout — click anchor, then click label position
        if (tool === 'callout') {
            this._calloutAnchor = null;
            this._removeCalloutPreview();
            this.map.getCanvas().style.cursor = 'crosshair';
            this._setHint('Click the point on the map to anchor the callout.');
            this._clickHandler = (e) => this._onCalloutClick(e);
            this._moveHandler = (e) => this._onCalloutMove(e);
            this._escHandler = (e) => { if (e.key === 'Escape') this.cancelDraw(); };
            this.map.on('click', this._clickHandler);
            this.map.on('mousemove', this._moveHandler);
            document.addEventListener('keydown', this._escHandler);
            logger.debug('Draw', 'Started tool: callout');
            return;
        }

        // Rectangle mode — same drag gesture as GIS widgets / clip rectangle
        if (tool === 'rectangle') {
            this._rectCorner1 = null;
            this._removeRectPreview();
            this.map.getCanvas().style.cursor = 'crosshair';
            this._setHint('Click and drag on the map to draw a rectangle.');
            this._escHandler = (e) => {
                if (e.key === 'Escape') {
                    mapService.cancelInteraction();
                    this.cancelDraw();
                }
            };
            document.addEventListener('keydown', this._escHandler);
            logger.debug('Draw', 'Started tool: rectangle');
            void this._runDelegatedRectangleDraw();
            return;
        }

        // Circle mode — click center, move to set radius, click to finish
        if (tool === 'circle') {
            this._circleCenter = null;
            this.map.getCanvas().style.cursor = 'crosshair';
            this._setHint('Click to set centre of circle.');
            this._clickHandler = (e) => this._onCircleClick(e);
            this._moveHandler = (e) => this._onCircleMove(e);
            this._escHandler = (e) => { if (e.key === 'Escape') this.cancelDraw(); };
            this.map.on('click', this._clickHandler);
            this.map.on('mousemove', this._moveHandler);
            document.addEventListener('keydown', this._escHandler);
            logger.debug('Draw', 'Started tool: circle');
            return;
        }

        // Sector mode — click center, click to set radius+start angle, click to set end angle
        if (tool === 'sector') {
            this._sectorCenter = null;
            this._sectorRadius = null;
            this._sectorStartAngle = null;
            this.map.getCanvas().style.cursor = 'crosshair';
            this._setHint('Click to set centre of sector.');
            this._clickHandler = (e) => this._onSectorClick(e);
            this._moveHandler = (e) => this._onSectorMove(e);
            this._escHandler = (e) => { if (e.key === 'Escape') this.cancelDraw(); };
            this.map.on('click', this._clickHandler);
            this.map.on('mousemove', this._moveHandler);
            document.addEventListener('keydown', this._escHandler);
            logger.debug('Draw', 'Started tool: sector');
            return;
        }

        this.map.getCanvas().style.cursor = 'crosshair';

        this._clickHandler = (e) => this._onMapClick(e);
        this._moveHandler = (e) => this._onMapMove(e);
        this._dblClickHandler = (e) => this._onMapDblClick(e);
        this._escHandler = (e) => { if (e.key === 'Escape') this.cancelDraw(); };

        this.map.on('click', this._clickHandler);
        this.map.on('mousemove', this._moveHandler);
        document.addEventListener('keydown', this._escHandler);

        if (tool === 'line' || tool === 'polygon') {
            this.map.doubleClickZoom.disable();
            this.map.on('dblclick', this._dblClickHandler);

            // Right-click to undo last vertex
            this._contextHandler = (e) => {
                if (this._vertices.length > 0) {
                    e.preventDefault();
                    this._undoLastVertex();
                }
            };
            this.map.on('contextmenu', this._contextHandler);
            const isMobile = window.innerWidth < 768 || 'ontouchstart' in window;
            if (isMobile) {
                this._setHint(tool === 'line'
                    ? 'Tap to add vertices. Tap Finish when done.'
                    : 'Tap to add vertices. Tap Finish to close polygon.');
            } else {
                this._setHint(tool === 'line'
                    ? 'Click to add vertices. Double-click or press Enter to finish.'
                    : 'Click to add vertices. Double-click or press Enter to close polygon.');
            }
        } else if (tool === 'point') {
            this._setHint(window.innerWidth < 768 ? 'Tap on the map to place a point.' : 'Click on the map to place a point.');
        }

        const enterHandler = (e) => {
            if (e.key === 'Enter') {
                const minVerts = this._tool === 'polygon' ? 3 : 2;
                if (this._vertices.length >= minVerts) {
                    this._finishDraw();
                }
            }
        };
        this._enterHandler = enterHandler;
        document.addEventListener('keydown', enterHandler);

        logger.debug('Draw', `Started tool: ${tool}`);
    }

    cancelDraw() {
        mapService.cancelInteraction();
        mapService.unblockSelection?.();
        this._clearPreview();
        this._clearEditSelection();
        this._removeRectPreview();
        this._removeCirclePreview();
        this._removeSectorPreview();
        this._removeCalloutPreview();
        this._rectCorner1 = null;
        this._circleCenter = null;
        this._calloutAnchor = null;
        this._sectorCenter = null;
        this._sectorRadius = null;
        this._sectorStartAngle = null;
        this._vertices = [];
        this._tool = null;
        this._finishing = false;
        this._lastTapTime = 0;
        this._updateToolButtons();
        this._setHint('');
        this._updateFinishBtn();
        this._updateActionButtons();

        if (this._clickTimeout) {
            clearTimeout(this._clickTimeout);
            this._clickTimeout = null;
        }

        if (this.map) {
            this.map.getCanvas().style.cursor = '';
            this.map.doubleClickZoom.enable();
        }

        if (this._clickHandler) { this.map?.off('click', this._clickHandler); this._clickHandler = null; }
        if (this._moveHandler) { this.map?.off('mousemove', this._moveHandler); this._moveHandler = null; }
        if (this._dblClickHandler) { this.map?.off('dblclick', this._dblClickHandler); this._dblClickHandler = null; }
        if (this._selectDblClickHandler) { this.map?.off('dblclick', this._selectDblClickHandler); this._selectDblClickHandler = null; }
        if (this._contextHandler) { this.map?.off('contextmenu', this._contextHandler); this._contextHandler = null; }
        if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
        if (this._enterHandler) { document.removeEventListener('keydown', this._enterHandler); this._enterHandler = null; }
    }

    /**
     * Rectangle aligned with MapManager drag-rectangle (widgets / clip).
     */
    async _runDelegatedRectangleDraw() {
        try {
            const bbox = await mapService.startRectangleDraw('Click and drag to draw rectangle. Esc cancels.');
            if (this._tool !== 'rectangle' || !this._toolbar) return;
            if (!bbox) {
                this._setHint('Rectangle cancelled — drag on the map to draw again.');
                return;
            }
            const [w, s, east, n] = bbox;
            const rectCoords = [[w, s], [east, s], [east, n], [w, n], [w, s]];
            this._createFeature('Polygon', [rectCoords]);
        } catch (err) {
            logger.warn('Draw', 'Rectangle draw failed', { error: err?.message });
        }
    }

    // ============================
    // Map event handlers
    // ============================

    _onMapClick(e) {
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent._drawHandled = true;
        }
        e._drawHandled = true;

        if (this._finishing) return;

        const lat = e.lngLat.lat;
        const lng = e.lngLat.lng;

        if (this._tool === 'point') {
            this._createFeature('Point', [[lng, lat]]);
            return;
        }

        const now = Date.now();
        if (now - this._lastTapTime < 400) {
            this._lastTapTime = 0;
            if (this._clickTimeout) { clearTimeout(this._clickTimeout); this._clickTimeout = null; }
            const minVerts = this._tool === 'polygon' ? 3 : 2;
            this._addVertex(lat, lng);
            if (this._vertices.length >= minVerts) {
                this._finishDraw();
            }
            return;
        }
        this._lastTapTime = now;

        if (this._clickTimeout) clearTimeout(this._clickTimeout);
        this._clickTimeout = setTimeout(() => {
            this._clickTimeout = null;
            if (this._finishing) return;
            this._addVertex(lat, lng);
        }, 200);
    }

    _addVertex(lat, lng) {
        this._vertices.push({ lat, lng });
        this._addVertexMarker(lat, lng);
        this._updatePreviewLine();

        const n = this._vertices.length;
        const isMobile = window.innerWidth < 768 || 'ontouchstart' in window;
        const finishHint = isMobile ? 'Tap Finish when done.' : 'Double-click or Enter to finish.';
        const closeHint = isMobile ? 'Tap Finish to close polygon.' : 'Double-click or Enter to close polygon.';
        if (this._tool === 'line') {
            this._setHint(`${n} vertex${n > 1 ? 'es' : ''} placed. ${finishHint}`);
        } else {
            this._setHint(`${n} vertex${n > 1 ? 'es' : ''} placed. ${n < 3 ? 'Need at least 3.' : closeHint}`);
        }
        this._updateFinishBtn();
        this._updateUndoBtn();
    }

    _updateFinishBtn() {
        void this._mountOrUpdateReactToolbar();
    }

    _onMapMove(e) {
        if (this._tool === 'point' || this._vertices.length === 0) return;
        this._updateRubberBand(e.lngLat);
    }

    _onMapDblClick(e) {
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            e.originalEvent._drawHandled = true;
        }
        e._drawHandled = true;

        // Cancel any pending single-click that would add a stray vertex
        if (this._clickTimeout) {
            clearTimeout(this._clickTimeout);
            this._clickTimeout = null;
        }

        // Do NOT add the dblclick point as a vertex — just finish with what we have
        const minVerts = this._tool === 'polygon' ? 3 : 2;
        if (this._vertices.length >= minVerts) {
            this._finishDraw();
        }
    }

    // ============================
    // Preview rendering (MapLibre sources/layers + markers)
    // ============================

    _addVertexMarker(lat, lng) {
        const el = document.createElement('div');
        el.style.cssText = `width:${VERTEX_STYLE.radius * 2}px;height:${VERTEX_STYLE.radius * 2}px;background:${VERTEX_STYLE.fillColor};border:${VERTEX_STYLE.strokeWidth}px solid ${VERTEX_STYLE.strokeColor};border-radius:50%;`;
        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(this.map);
        this._vertexMarkers.push(marker);
    }

    _updatePreviewLine() {
        // Remove old preview source/layers
        this._removePreviewLine();

        if (this._vertices.length < 2) return;

        const coords = this._vertices.map(v => [v.lng, v.lat]);
        if (this._tool === 'polygon' && this._vertices.length >= 3) {
            coords.push(coords[0]);
        }

        const srcId = _nextDrawId('preview');
        this._previewSourceId = srcId;

        this.map.addSource(srcId, {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
        });

        const lineId = srcId + '-line';
        this.map.addLayer({
            id: lineId, type: 'line', source: srcId,
            paint: {
                'line-color': DRAW_STYLE.lineColor,
                'line-width': DRAW_STYLE.lineWidth,
                'line-opacity': DRAW_STYLE.lineOpacity,
                'line-dasharray': DRAW_STYLE.lineDasharray
            }
        });
        this._previewLayerIds = [lineId];

        // Add fill for polygon preview
        if (this._tool === 'polygon' && this._vertices.length >= 3) {
            const fillCoords = this._vertices.map(v => [v.lng, v.lat]);
            fillCoords.push(fillCoords[0]);
            const fillSrcId = srcId + '-fill-src';
            this.map.addSource(fillSrcId, {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [fillCoords] } }
            });
            const fillId = srcId + '-fill';
            this.map.addLayer({
                id: fillId, type: 'fill', source: fillSrcId,
                paint: { 'fill-color': DRAW_STYLE.fillColor, 'fill-opacity': DRAW_STYLE.fillOpacity }
            });
            this._previewLayerIds.push(fillId);
            this._previewLayerIds.push(fillSrcId); // track for cleanup
        }
    }

    _removePreviewLine() {
        if (this._previewLayerIds.length > 0) {
            for (const id of this._previewLayerIds) {
                if (this.map?.getLayer(id)) this.map.removeLayer(id);
            }
            this._previewLayerIds = [];
        }
        if (this._previewSourceId) {
            // Also remove fill source if present
            const fillSrcId = this._previewSourceId + '-fill-src';
            if (this.map?.getSource(fillSrcId)) this.map.removeSource(fillSrcId);
            if (this.map?.getSource(this._previewSourceId)) this.map.removeSource(this._previewSourceId);
            this._previewSourceId = null;
        }
    }

    _updateRubberBand(lngLat) {
        this._removeRubberBand();
        const lastVertex = this._vertices[this._vertices.length - 1];
        if (!lastVertex) return;

        const coords = [[lastVertex.lng, lastVertex.lat], [lngLat.lng, lngLat.lat]];
        if (this._tool === 'polygon' && this._vertices.length >= 2) {
            coords.push([this._vertices[0].lng, this._vertices[0].lat]);
        }

        const srcId = _nextDrawId('rubber');
        this._rubberBandSourceId = srcId;

        this.map.addSource(srcId, {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
        });

        const lineId = srcId + '-line';
        this.map.addLayer({
            id: lineId, type: 'line', source: srcId,
            paint: {
                'line-color': DRAW_STYLE.lineColor,
                'line-width': DRAW_STYLE.lineWidth,
                'line-opacity': 0.5,
                'line-dasharray': [4, 6]
            }
        });
        this._rubberBandLayerIds = [lineId];
    }

    _removeRubberBand() {
        for (const lid of this._rubberBandLayerIds) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        this._rubberBandLayerIds = [];
        if (this._rubberBandSourceId) {
            if (this.map?.getSource(this._rubberBandSourceId)) this.map.removeSource(this._rubberBandSourceId);
            this._rubberBandSourceId = null;
        }
    }

    _clearPreview() {
        // Remove vertex markers
        for (const m of this._vertexMarkers) {
            try { m.remove(); } catch (_) {}
        }
        this._vertexMarkers = [];

        // Remove preview line/fill
        this._removePreviewLine();

        // Remove rubber band
        this._removeRubberBand();
    }

    // ============================
    // Select & Edit
    // ============================

    _onSelectClick(e) {
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent._drawHandled = true;
        }
        e._drawHandled = true;

        const info = mapService.getLayerRecord(this._targetLayerId);
        if (!info) return;

        const features = mapService.queryFeaturesAtPoint(e.point, info.layerIds);
        if (features.length > 0) {
            const props = features[0].properties;
            const featureIndex = props._featureIndex;
            if (featureIndex !== undefined) {
                this._selectFeature(featureIndex);
            }
        } else {
            this._clearEditSelection();
        }
    }

    _selectFeature(featureIndex) {
        this._clearEditSelection();
        this._selectedFeatureIndex = featureIndex;

        mapService.highlightFeature(this._targetLayerId, featureIndex);
        this._showEditVertices(featureIndex);
        this._updateActionButtons();
        const info = mapService.getLayerRecord(this._targetLayerId);
        const feature = info?.geojson?.features?.find((f) => f.properties?._featureIndex === featureIndex);
        this._editFeatureRef = feature || null;
        const hint = isAnnotationFeature(feature)
            ? 'Label selected. Drag to move, Edit to change text/style, or Delete.'
            : 'Feature selected. Drag vertices to reshape, or press Delete.';
        this._setHint(hint);
    }

    _onSelectDblClick(e) {
        if (this._tool !== 'select') return;
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            e.originalEvent._drawHandled = true;
        }
        e._drawHandled = true;
        if (this._selectedFeatureIndex !== null && isAnnotationFeature(this._editFeatureRef)) {
            this._editSelectedAnnotation();
        }
    }

    _editSelectedAnnotation() {
        if (this._selectedFeatureIndex === null || !isAnnotationFeature(this._editFeatureRef)) return;
        const feature = this._editFeatureRef;
        const mode = feature.properties._annotationType === ANNOTATION_TYPES.CALLOUT ? 'callout' : 'text';
        void this._openAnnotationDialog({
            mode,
            initial: { ...feature.properties },
            onConfirm: (props) => {
                const annotationType = feature.properties._annotationType;
                Object.assign(feature.properties, normalizeAnnotationProperties(props, annotationType));
                this._syncLayerData();
                bus.emit('draw:featureEdited', {
                    layerId: this._targetLayerId,
                    featureIndex: this._selectedFeatureIndex
                });
                this._setHint('Label updated.');
            }
        });
    }

    _clearEditSelection() {
        this._selectedFeatureIndex = null;
        this._editFeatureRef = null;
        this._removeEditMarkers();
        mapService.clearHighlight();
    }

    _removeEditMarkers() {
        for (const m of this._editMarkers) {
            try { m.remove(); } catch (_) {}
        }
        this._editMarkers = [];
    }

    _showEditVertices(featureIndex) {
        this._removeEditMarkers();

        const info = mapService.getLayerRecord(this._targetLayerId);
        if (!info) return;

        const feature = info.geojson.features.find(f => f.properties._featureIndex === featureIndex);
        if (!feature || !feature.geometry) return;

        this._editFeatureRef = feature;
        const vertices = collectEditableVertices(feature.geometry);

        vertices.forEach((item) => {
            const el = document.createElement('div');
            el.className = 'draw-edit-vertex';

            const marker = new maplibregl.Marker({ element: el, draggable: true })
                .setLngLat(item.coord)
                .addTo(this.map);

            marker.on('drag', () => {
                const lngLat = marker.getLngLat();
                applyVertexMove(feature.geometry, item.path, [lngLat.lng, lngLat.lat]);
                if (feature?.properties?._annotationType === ANNOTATION_TYPES.CALLOUT
                    && feature.geometry?.type === 'LineString') {
                    const coords = feature.geometry.coordinates;
                    const last = coords[coords.length - 1];
                    feature.properties.labelLng = last[0];
                    feature.properties.labelLat = last[1];
                }
                this._syncLayerData();
            });

            marker.on('dragend', () => {
                bus.emit('draw:featureEdited', {
                    layerId: this._targetLayerId,
                    featureIndex
                });
            });

            this._editMarkers.push(marker);
        });
    }

    _getEditableCoords(geometry) {
        return collectEditableVertices(geometry).map((item) => item.coord);
    }

    _applyVertexMove(geometry, vertexIndex, newCoord, feature = null) {
        const vertices = collectEditableVertices(geometry);
        const item = vertices[vertexIndex];
        if (!item) return;
        applyVertexMove(geometry, item.path, newCoord);
        if (feature?.properties?._annotationType === ANNOTATION_TYPES.CALLOUT
            && geometry.type === 'LineString') {
            const coords = geometry.coordinates;
            const last = coords[coords.length - 1];
            feature.properties.labelLng = last[0];
            feature.properties.labelLat = last[1];
        }
    }

    _syncLayerData() {
        const info = mapService.getLayerRecord(this._targetLayerId);
        if (!info) return;
        const src = this.map.getSource(info.sourceId);
        if (src) src.setData(info.geojson);
        mapService.syncAnnotationSources(this._targetLayerId, info.geojson);
    }

    _deleteSelected() {
        if (this._selectedFeatureIndex === null) return;
        const featureIndex = this._selectedFeatureIndex;
        this._clearEditSelection();
        this._updateActionButtons();

        bus.emit('draw:featureDeleted', {
            layerId: this._targetLayerId,
            featureIndex
        });

        this._setHint('Feature deleted.');
        logger.debug('Draw', `Deleted feature at index ${featureIndex}`);
    }

    _updateActionButtons() {
        void this._mountOrUpdateReactToolbar();
    }

    // ============================
    // Undo last vertex
    // ============================

    _undoLastVertex() {
        if (!this._tool || this._tool === 'point' || this._tool === 'select' || this._tool === 'rectangle') return;
        if (this._vertices.length === 0) return;

        this._vertices.pop();
        if (this._vertexMarkers.length > 0) {
            const m = this._vertexMarkers.pop();
            try { m.remove(); } catch (_) {}
        }
        this._updatePreviewLine();
        this._updateFinishBtn();
        this._updateUndoBtn();

        const n = this._vertices.length;
        if (n === 0) {
            this._setHint('Click to start drawing.');
        } else {
            this._setHint(`${n} vertex${n > 1 ? 'es' : ''} placed.`);
        }
    }

    _updateUndoBtn() {
        void this._mountOrUpdateReactToolbar();
    }

    // ============================
    // Rectangle preview cleanup (drag rectangle uses MapManager — no live preview here)
    // ============================

    _removeRectPreview() {
        for (const lid of this._rectPreviewLayerIds) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        this._rectPreviewLayerIds = [];
        if (this._rectPreviewSourceId) {
            if (this.map?.getSource(this._rectPreviewSourceId)) this.map.removeSource(this._rectPreviewSourceId);
            this._rectPreviewSourceId = null;
        }
    }

    // ============================
    // Circle tool
    // ============================

    _onCircleClick(e) {
        if (e.originalEvent) { e.originalEvent.stopPropagation(); e.originalEvent._drawHandled = true; }
        e._drawHandled = true;
        if (this._finishing) return;

        const coord = [e.lngLat.lng, e.lngLat.lat];

        if (!this._circleCenter) {
            this._circleCenter = coord;
            this._setHint('Move to set radius, then click to finish.');
        } else {
            const center = turf.point(this._circleCenter);
            const edge = turf.point(coord);
            const radius = turf.distance(center, edge, { units: 'kilometers' });
            if (radius < 0.001) return; // too small

            const circle = turf.circle(this._circleCenter, radius, { steps: 64, units: 'kilometers' });
            this._circleCenter = null;
            this._removeCirclePreview();
            this._createFeature('Polygon', circle.geometry.coordinates);
        }
    }

    _onCircleMove(e) {
        if (!this._circleCenter) return;
        this._updateCirclePreview(e.lngLat);
    }

    _updateCirclePreview(lngLat) {
        this._removeCirclePreview();
        if (!this._circleCenter) return;

        const center = turf.point(this._circleCenter);
        const edge = turf.point([lngLat.lng, lngLat.lat]);
        const radius = turf.distance(center, edge, { units: 'kilometers' });
        if (radius < 0.0001) return;

        const circle = turf.circle(this._circleCenter, radius, { steps: 64, units: 'kilometers' });

        const srcId = _nextDrawId('circle-preview');
        this._circlePreviewSourceId = srcId;

        this.map.addSource(srcId, { type: 'geojson', data: circle });

        const lineId = srcId + '-outline';
        this.map.addLayer({
            id: lineId, type: 'line', source: srcId,
            paint: { 'line-color': DRAW_STYLE.lineColor, 'line-width': DRAW_STYLE.lineWidth, 'line-dasharray': DRAW_STYLE.lineDasharray }
        });

        const fillId = srcId + '-fill';
        this.map.addLayer({
            id: fillId, type: 'fill', source: srcId,
            paint: { 'fill-color': DRAW_STYLE.fillColor, 'fill-opacity': DRAW_STYLE.fillOpacity }
        });

        this._circlePreviewLayerIds = [lineId, fillId];
    }

    _removeCirclePreview() {
        for (const lid of this._circlePreviewLayerIds) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        this._circlePreviewLayerIds = [];
        if (this._circlePreviewSourceId) {
            if (this.map?.getSource(this._circlePreviewSourceId)) this.map.removeSource(this._circlePreviewSourceId);
            this._circlePreviewSourceId = null;
        }
    }

    // ============================
    // Sector (pie wedge) tool
    // ============================

    _onSectorClick(e) {
        if (e.originalEvent) { e.originalEvent.stopPropagation(); e.originalEvent._drawHandled = true; }
        e._drawHandled = true;
        if (this._finishing) return;

        const coord = [e.lngLat.lng, e.lngLat.lat];

        if (!this._sectorCenter) {
            // Step 1: set center
            this._sectorCenter = coord;
            this._setHint('Click to set radius and start angle.');
        } else if (this._sectorRadius === null) {
            // Step 2: set radius + start angle
            const center = turf.point(this._sectorCenter);
            const edge = turf.point(coord);
            const radius = turf.distance(center, edge, { units: 'kilometers' });
            if (radius < 0.001) return;
            this._sectorRadius = radius;
            this._sectorStartAngle = turf.bearing(center, edge);
            this._setHint('Move to set sweep, then click to finish sector.');
        } else {
            // Step 3: set end angle and create
            const center = turf.point(this._sectorCenter);
            const edge = turf.point(coord);
            const endAngle = turf.bearing(center, edge);
            const sectorCoords = this._buildSectorCoords(this._sectorCenter, this._sectorRadius, this._sectorStartAngle, endAngle);

            this._sectorCenter = null;
            this._sectorRadius = null;
            this._sectorStartAngle = null;
            this._removeSectorPreview();
            this._createFeature('Polygon', [sectorCoords]);
        }
    }

    _onSectorMove(e) {
        if (!this._sectorCenter) return;
        this._updateSectorPreview(e.lngLat);
    }

    _updateSectorPreview(lngLat) {
        this._removeSectorPreview();
        if (!this._sectorCenter) return;

        const coord = [lngLat.lng, lngLat.lat];
        const center = turf.point(this._sectorCenter);
        const edge = turf.point(coord);
        let geojson;

        if (this._sectorRadius === null) {
            // Preview: just a radius line from center to cursor
            const radius = turf.distance(center, edge, { units: 'kilometers' });
            if (radius < 0.0001) return;
            geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: [this._sectorCenter, coord] } };
        } else {
            // Preview: the sector wedge
            const endAngle = turf.bearing(center, edge);
            const coords = this._buildSectorCoords(this._sectorCenter, this._sectorRadius, this._sectorStartAngle, endAngle);
            geojson = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
        }

        const srcId = _nextDrawId('sector-preview');
        this._sectorPreviewSourceId = srcId;
        this.map.addSource(srcId, { type: 'geojson', data: geojson });

        const lineId = srcId + '-outline';
        this.map.addLayer({
            id: lineId, type: 'line', source: srcId,
            paint: { 'line-color': DRAW_STYLE.lineColor, 'line-width': DRAW_STYLE.lineWidth, 'line-dasharray': DRAW_STYLE.lineDasharray }
        });
        this._sectorPreviewLayerIds = [lineId];

        if (this._sectorRadius !== null) {
            const fillId = srcId + '-fill';
            this.map.addLayer({
                id: fillId, type: 'fill', source: srcId,
                paint: { 'fill-color': DRAW_STYLE.fillColor, 'fill-opacity': DRAW_STYLE.fillOpacity }
            });
            this._sectorPreviewLayerIds.push(fillId);
        }
    }

    _removeSectorPreview() {
        for (const lid of this._sectorPreviewLayerIds) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        this._sectorPreviewLayerIds = [];
        if (this._sectorPreviewSourceId) {
            if (this.map?.getSource(this._sectorPreviewSourceId)) this.map.removeSource(this._sectorPreviewSourceId);
            this._sectorPreviewSourceId = null;
        }
    }

    /**
     * Build a closed polygon ring for a sector (pie wedge).
     * Angles are Turf bearings (-180 to 180, north = 0, clockwise positive).
     */
    _buildSectorCoords(center, radiusKm, startBearing, endBearing) {
        const steps = 48;
        // Normalize bearings to 0–360
        let s = ((startBearing % 360) + 360) % 360;
        let e = ((endBearing % 360) + 360) % 360;
        // Sweep clockwise from start to end
        let sweep = e - s;
        if (sweep <= 0) sweep += 360;

        const coords = [center]; // start at center
        for (let i = 0; i <= steps; i++) {
            const bearing = s + (sweep * i / steps);
            const pt = turf.destination(center, radiusKm, bearing, { units: 'kilometers' });
            coords.push(pt.geometry.coordinates);
        }
        coords.push(center); // close back to center
        return coords;
    }

    // ============================
    // Feature creation
    // ============================

    // ============================
    // Text & callout annotations
    // ============================

    _onTextClick(e) {
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent._drawHandled = true;
        }
        e._drawHandled = true;
        if (this._finishing || this._annotationDialogOpen) return;

        const coord = [e.lngLat.lng, e.lngLat.lat];
        this._finishing = true;
        void this._openAnnotationDialog({
            mode: 'text',
            initial: { ...this._lastAnnotationStyle },
            onConfirm: (props) => {
                this._createAnnotationFeature(ANNOTATION_TYPES.TEXT, {
                    type: 'Point',
                    coordinates: coord
                }, props);
            },
            onCancel: () => {
                this._finishing = false;
                this._setHint('Click on the map to place a text label.');
            }
        });
    }

    _onCalloutClick(e) {
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent._drawHandled = true;
        }
        e._drawHandled = true;
        if (this._finishing || this._annotationDialogOpen) return;

        const coord = [e.lngLat.lng, e.lngLat.lat];

        if (!this._calloutAnchor) {
            this._calloutAnchor = coord;
            this._setHint('Move cursor and click where the label should go.');
            return;
        }

        const anchor = this._calloutAnchor;
        const label = coord;
        this._calloutAnchor = null;
        this._removeCalloutPreview();
        this._finishing = true;

        void this._openAnnotationDialog({
            mode: 'callout',
            initial: { ...this._lastAnnotationStyle },
            onConfirm: (props) => {
                this._createAnnotationFeature(ANNOTATION_TYPES.CALLOUT, {
                    type: 'LineString',
                    coordinates: [anchor, label]
                }, props);
            },
            onCancel: () => {
                this._finishing = false;
                this._setHint('Click the point on the map to anchor the callout.');
            }
        });
    }

    _onCalloutMove(e) {
        if (!this._calloutAnchor) return;
        this._updateCalloutPreview(this._calloutAnchor, [e.lngLat.lng, e.lngLat.lat]);
    }

    _updateCalloutPreview(anchor, cursor) {
        this._removeCalloutPreview();
        const srcId = _nextDrawId('callout-preview');
        this._calloutPreviewSourceId = srcId;
        this.map.addSource(srcId, {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [anchor, cursor] }
            }
        });
        const lineId = srcId + '-line';
        this.map.addLayer({
            id: lineId,
            type: 'line',
            source: srcId,
            paint: {
                'line-color': DRAW_STYLE.lineColor,
                'line-width': 2,
                'line-opacity': 0.85,
                'line-dasharray': [4, 4]
            }
        });
        const anchorId = srcId + '-anchor';
        this.map.addLayer({
            id: anchorId,
            type: 'circle',
            source: srcId,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': 4,
                'circle-color': DRAW_STYLE.lineColor,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 1
            }
        });
        this._calloutPreviewLayerIds = [lineId, anchorId];
    }

    _removeCalloutPreview() {
        for (const lid of this._calloutPreviewLayerIds) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        this._calloutPreviewLayerIds = [];
        if (this._calloutPreviewSourceId) {
            if (this.map?.getSource(this._calloutPreviewSourceId)) {
                this.map.removeSource(this._calloutPreviewSourceId);
            }
            this._calloutPreviewSourceId = null;
        }
    }

    async _openAnnotationDialog({ mode, initial, onConfirm, onCancel }) {
        if (this._annotationDialogOpen) return;
        this._annotationDialogOpen = true;
        const rootId = `text-ann-dialog-${Date.now()}`;
        const title = mode === 'callout' ? 'Callout label' : 'Text label';

        await new Promise((resolve) => {
            showModal(title, `<div id="${rootId}"></div>`, {
                width: '380px',
                onMount: async (overlay, close) => {
                    const root = overlay.querySelector(`#${rootId}`);
                    if (!root) {
                        resolve();
                        return;
                    }
                    const { mountTextAnnotationDialog } = await import('../../react/map/mountTextAnnotationDialog.jsx');
                    let mounted = null;
                    const finish = (result) => {
                        this._annotationDialogOpen = false;
                        close();
                        mounted?.unmount?.();
                        resolve(result);
                    };
                    mounted = mountTextAnnotationDialog(root, {
                        mode,
                        initial,
                        onConfirm: (props) => {
                            this._lastAnnotationStyle = { ...props };
                            onConfirm?.(props);
                            finish(props);
                        },
                        onCancel: () => {
                            onCancel?.();
                            finish(null);
                        }
                    });
                }
            });
        });
    }

    _createAnnotationFeature(annotationType, geometry, styleProps) {
        this._finishing = true;
        const properties = normalizeAnnotationProperties(styleProps, annotationType);
        if (annotationType === ANNOTATION_TYPES.CALLOUT && geometry.type === 'LineString') {
            const coords = geometry.coordinates;
            const last = coords[coords.length - 1];
            properties.labelLng = last[0];
            properties.labelLat = last[1];
        }

        const feature = {
            type: 'Feature',
            properties,
            geometry
        };

        this._clearPreview();
        this._removeCalloutPreview();
        this._calloutAnchor = null;
        this._vertices = [];

        bus.emit('draw:featureCreated', {
            layerId: this._targetLayerId,
            feature
        });

        logger.debug('Draw', `Created ${annotationType} annotation`);

        const hint = annotationType === ANNOTATION_TYPES.CALLOUT
            ? 'Callout placed! Click to anchor another callout.'
            : 'Label placed! Click again to add another.';
        this._setHint(hint);
        this.map.getCanvas().style.cursor = 'crosshair';
        setTimeout(() => { this._finishing = false; }, 300);
    }

    _finishDraw() {
        if (this._tool === 'line' && this._vertices.length >= 2) {
            const coords = this._vertices.map(v => [v.lng, v.lat]);
            this._createFeature('LineString', coords);
        } else if (this._tool === 'polygon' && this._vertices.length >= 3) {
            const coords = this._vertices.map(v => [v.lng, v.lat]);
            coords.push(coords[0]);
            this._createFeature('Polygon', [coords]);
        }
    }

    _createFeature(type, coordinates) {
        this._finishing = true;

        const feature = {
            type: 'Feature',
            properties: {},
            geometry: {
                type,
                coordinates: type === 'Point' ? coordinates[0] : coordinates
            }
        };

        this._clearPreview();
        this._vertices = [];

        bus.emit('draw:featureCreated', {
            layerId: this._targetLayerId,
            feature
        });

        logger.debug('Draw', `Created ${type} feature`);

        if (this._tool === 'point') {
            this._setHint('Point placed! Click again to add another.');
            this.map.getCanvas().style.cursor = 'crosshair';
            this._finishing = false;
        } else {
            this._vertices = [];
            this._vertexMarkers = [];
            this._rectCorner1 = null;
            this._updateFinishBtn();
            this._updateUndoBtn();
            this._setHint('Click to start a new shape.');
            this.map.getCanvas().style.cursor = 'crosshair';
            // Keep _finishing true briefly to block stray click events
            setTimeout(() => { this._finishing = false; }, 300);
        }
    }
}

const drawManager = new DrawManager();
export default drawManager;
