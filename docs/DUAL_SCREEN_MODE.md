# Dual Screen Mode

Dual Screen moves the map into a second browser window. The main window keeps tools, layers, and widgets. The pop-out window owns the map. They talk over one `BroadcastChannel`.

Counts below are taken from `FORWARDED_MAP_METHODS` and `LOCAL_ONLY_MAP_METHODS` in `js/dual-screen/map-bridge.js`.

## Architecture

| Piece | File | Role |
|-------|------|------|
| Main window | app shell, `js/tools/tool-handlers.js` | Layers, tools, header. **Dual Screen** toggles the mode. |
| Pop-out window | `map-window.html`, `js/map-window.js` | Dedicated map window. Draws the map and sends hello. |
| Coordinator | `js/dual-screen/coordinator.js` | Primary lifecycle: open the pop-out, wait for hello, snapshot, tear down, restore the main map. |
| Channel | `js/dual-screen/channel.js` | `BroadcastChannel` named `gis-toolbox-dual-screen`. Drops stale sessions. |
| Protocol | `js/dual-screen/protocol.js` | Message envelope (`v`, `role`, `sessionId`, `msgId`, `type`, `payload`). `PROTOCOL_VERSION` is 1. |
| Popup handshake | `js/dual-screen/secondary-protocol.js` | Hello once, queue until ready, goodbye immediately. |
| Map bridge | `js/dual-screen/map-bridge.js` | Forwards or keeps each public map-service method. |
| Window open | `js/dual-screen/window-open.js` | `window.open` features for the normal pop-out, or a full screen on one monitor. |
| Screen owner flag | `js/dual-screen/screen-mode.js` | `isPopoutMap()` while the pop-out owns the map. |

Flow:

1. **Dual Screen** calls `dualScreenCoordinator.activate()`. The main map stays up.
2. The coordinator creates a session id, opens `map-window.html?session=…`, and listens.
3. The pop-out loads its own map, then sends `HELLO` for that session.
4. The coordinator destroys the main map, marks dual screen active, and sends one snapshot.
5. Later map calls go through the bridge. Closing either side sends `BYE` and the main window builds its map again.

The normal pop-out is a centered window (at most 1600×960) on the current screen. That path is unchanged when no second-monitor screen is passed.

## Map bridge

`installDualScreenMapServiceDecorator` wraps the map service while dual screen is on. `classifyMapMethod` returns `forward` or `local`. A public method in neither set is `unbridged` and is a bug: every public map-service method is in exactly one set.

Forwarded calls are `{ method, args }`. Methods the caller waits on use `MAP_RPC` (`RPC_MAP_METHODS`: `startPointPick`, `startTwoPointPick`, `startRouteTwoPointPick`, `startRectangleDraw`, `startSketchPolygon`, `startSketchPolyline`, `startSketchCirclePolygon`, `startPresentationFeaturePick`, `getMapView`, `playPresentationPreview`). Every other forwarded method is a one-way `MAP_CMD`. The pop-out applies them with `applyForwardedMapCall`. `getMapView` is a quiet RPC: it does not pull the pop-out forward.

**79** forwarded methods:

`addLayer`, `addLayerIncremental`, `addWorkspaceLayer`, `addServiceLayer`, `removeServiceLayer`, `refreshServiceLayer`, `materializeServiceLayer`, `refreshWorkspaceLayerViewport`, `syncWorkspaceAttributeFilter`, `appendFeaturesToLayer`, `removeLayer`, `toggleLayer`, `setLayerScaleRange`, `restyleLayer`, `refreshLayerData`, `setLayerStyle`, `applyLayerLock`, `syncLayerOrder`, `setLayerStylesRecord`, `setBasemap`, `setBasemapTone`, `enable3D`, `disable3D`, `reconcile3DState`, `stopMapCamera`, `fitToAll`, `fitToLayers`, `fitBounds`, `scheduleMapFit`, `scheduleFitToLayers`, `fitToFeatureIndices`, `focusFeatures`, `startCameraOrbit`, `stopCameraOrbit`, `prepareOrbitView`, `showTempFeature`, `showRouteMilepostPreview`, `showWirelessPlanningPreview`, `showProjectStationingPreview`, `showGeoreferencePreview`, `updateGeoreferencePreview`, `clearGeoreferencePreview`, `removeTempFeature`, `clearTempFeatures`, `showQueryResults`, `clearQueryResults`, `pulseQueryResults`, `syncAnnotationSources`, `highlightFeature`, `clearHighlight`, `startPointPick`, `startTwoPointPick`, `startRouteTwoPointPick`, `startRectangleDraw`, `startSketchPolygon`, `startSketchPolyline`, `startSketchCirclePolygon`, `startPresentationFeaturePick`, `getMapView`, `applyMapView`, `playPresentationPreview`, `cancelInteraction`, `startMeasureFrom`, `selectFeatures`, `clearSelection`, `selectAll`, `invertSelection`, `enterSelectionMode`, `exitSelectionMode`, `setActiveLayerId`, `blockSelection`, `unblockSelection`, `clearSelectionBoxOutline`, `enablePresentationMultiSelect`, `disablePresentationMultiSelect`, `addCoverageHeatmapLayer`, `addGeoreferencedImageLayer`, `setPopupMode`, `startContinuousPointPick`

**50** local-only methods. Each stays in the calling window:

| Method | Why it stays local |
|--------|--------------------|
| `init` | Creates the map in this window |
| `destroy` | Tears down the map in this window |
| `getMap` | No map object in this window while dual-screen is on |
| `resize` | Resizes this window's map container |
| `getLayerStyle` | Style store kept on the main window for restore |
| `getLayerDefaultColor` | Color table kept on the main window |
| `getCurrentBasemap` | Basemap key kept on the main window |
| `setCurrentBasemap` | Chrome sync writes the key here and must not bounce |
| `getBasemapTone` | Tone kept on the main window |
| `is3DEnabled` | 3D flag kept on the main window |
| `set3DEnabled` | Chrome sync writes the flag here and must not bounce |
| `getLayerStyles` | Style map kept on the main window |
| `getLayerStylesRecord` | Style record read on the main window |
| `userHasMovedCamera` | Camera flag belongs to the window that owns the map |
| `getBounds` | Uses the last viewport the popup already sent |
| `hasImportFence` | Fence flag; the draw protocol moves the fence |
| `clearImportFence` | Fence clear already goes out as a draw command |
| `startImportFenceDraw` | Fence draw already goes out as a draw command |
| `setImportFenceFromBbox` | Fence apply already goes out as a draw command |
| `getImportFenceEsriEnvelope` | Built from the fence bbox stored on the main window |
| `getSearchLatLng` | Search marker is moved by the draw protocol |
| `clearSearchMarker` | Search clear already goes out as a draw command |
| `getLayerRecord` | Layer table on this window is empty while the map is in the popup |
| `compositeAnnotationOverlay` | Needs a canvas context, which cannot cross the bridge |
| `getLayerIds` | Layer ids on this window while the map is in the popup |
| `isSelectionMode` | Reads selection state already mirrored by the selection channel |
| `isPresentationMultiSelect` | Reads a flag on this window |
| `getActiveLayerId` | Reads the active layer id on this window |
| `getTotalSelectionCount` | Reads selection state already mirrored by the selection channel |
| `getSelectedIndices` | Reads selection state already mirrored by the selection channel |
| `getSelectedFeatures` | Reads selection state already mirrored by the selection channel |
| `getSelectionCount` | Reads selection state already mirrored by the selection channel |
| `getLastSelectionBbox` | Reads selection state already mirrored by the selection channel |
| `isSelectionBlocked` | Reads selection state on this window |
| `showInteractionBanner` | The cancel callback cannot cross the bridge |
| `getHighlightedFeature` | Reads highlight state on this window |
| `getPresentationAnchor` | Reads presentation state on this window |
| `getPresentationSourceFeatures` | Reads presentation features on this window |
| `resolveFeaturesByIndices` | Looks up features in this window's layer table |
| `getActivePopupHit` | Popups belong to the window that owns the map |
| `hasPopupHits` | Popups belong to the window that owns the map |
| `cyclePopup` | Popups belong to the window that owns the map |
| `getPopupMode` | Popups belong to the window that owns the map |
| `closePopup` | Popups belong to the window that owns the map |
| `findFeaturesNearClick` | Hit testing needs this window's map pixels |
| `queryFeaturesAtPoint` | Hit testing needs this window's map pixels |
| `showMultiPopup` | Popups belong to the window that owns the map |
| `showPopup` | Popups belong to the window that owns the map |
| `isOrbiting` | Reads orbit state on the window that owns the map |
| `queryElevationAt` | Elevation is a synchronous read of the local map |

`getMap`, `showInteractionBanner`, `compositeAnnotationOverlay`, and `queryElevationAt` are not run locally against a live map in the main window while dual screen is on (`getMap` returns null). The others call the main window's original method or a value the coordinator already stored (`getBounds`, fence envelope).

## Safe-start handshake

The main map is not removed until the pop-out says hello for this attempt. A failed start rolls back to the single-screen map.

### Session id

Each `activate()` calls `createDualSessionId()` (`ds-` plus a UUID, or a time-based id if `randomUUID` is missing). The id is the `session` query on the pop-out URL and the `sessionId` on every protocol message. `classifyIncoming` marks a message `stale` when the id does not match the channel's expected session, and the channel ignores it. An older pop-out cannot attach to a new attempt.

### Hello timeout and rollback

`HELLO_TIMEOUT_MS` is 8000. The coordinator starts that timer before `window.open`. The pop-out sends `HELLO` once, from `markHandshakeReady()`, after its map fires `load` (`onMapReady` in `js/map-window.js`). Other popup messages wait in a queue until that hello, then flush in order.

On hello for the pending session, the coordinator completes activation: destroy the main map, set dual screen active, send the snapshot.

If hello does not arrive in time, `_failActivation('timeout')` runs:

- The main map was never destroyed.
- A warning toast is shown (`HELLO_TIMEOUT_NOTICE`).
- The coordinator posts `BYE`, closes the channel, closes the pop-out, and clears the session id.
- `activate()` resolves `false`.

The same rollback runs if the pop-out closes or sends `BYE` before hello (`reason: 'bye'`). A version mismatch during the wait uses `reason: 'version'`.

### Goodbye on pagehide

The pop-out listens for `pagehide` and `beforeunload` and calls `handlePageHide()`. That sends `BYE` immediately. Goodbye does not wait in the outbound queue. The main window treats `BYE` while still pending as a failed start, and `BYE` while active as deactivate-and-restore (it does not post another `BYE` or close a window that is already going away).

### Version mismatch

Every message carries `v: PROTOCOL_VERSION` (1). A message with a different numeric version and a `type` is `version`, not applied. The channel calls `onProtocolMismatch`. The coordinator shows `PROTOCOL_MISMATCH_NOTICE` once and, if activation is still pending, rolls back the same way as a timeout (map stays in the main window).

## Full screen on a second monitor

The header button **Full screen on second monitor** (`#btn-dual-screen-second-monitor`, next to **Dual Screen**) is optional. **Dual Screen** still opens the normal centered pop-out.

The second-monitor button calls `resolveSecondMonitorPlacement()` in `js/dual-screen/second-monitor.js`, which feature-detects `window.getScreenDetails` (Window Management API) and never throws.

| Result | What happens |
|--------|----------------|
| Supported, and a screen has `isPrimary === false` | `window.open` uses that screen's `availLeft`, `availTop`, `availWidth`, and `availHeight`, so the pop-out fills the non-primary monitor. Negative origins are kept for a monitor left of the primary. |
| API missing | Info toast, then the normal pop-out. |
| `getScreenDetails()` rejects (permission denied or any other failure) | Info toast, then the normal pop-out. |
| Fewer than two screens, or no identifiable non-primary screen | Info toast, then the normal pop-out. |

Toasts are non-blocking. The single-screen app and the normal **Dual Screen** button do not call `getScreenDetails`. If dual screen is already on, the second-monitor button only focuses the existing pop-out.
