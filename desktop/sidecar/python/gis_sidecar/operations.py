"""Allow-listed sidecar operations. No arbitrary script execution."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict

from . import __version__
from .protocol import PROTOCOL_VERSION, emit_log, emit_progress


Handler = Callable[[str, Dict[str, Any]], Any]


def op_health(_request_id: str, _input: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ok": True,
        "version": __version__,
        "protocolVersion": PROTOCOL_VERSION,
        "operations": sorted(OPERATION_HANDLERS.keys()),
    }


def op_echo(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    emit_progress(request_id, percent=50, stage="echo", message="Echoing payload")
    emit_log(request_id, "echo operation running")
    emit_progress(request_id, percent=100, stage="done", message="Echo complete")
    return {"echo": input_data}


def op_summarize_geojson(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Narrow GIS operation: summarize a GeoJSON file on disk.
    Input: { "path": "<absolute-or-relative-file-path>" }
    Does not accept inline giant JSON payloads.
    """
    path_value = input_data.get("path")
    if not path_value or not isinstance(path_value, str):
        raise ValueError('summarize_geojson requires input.path (file path string)')

    path = Path(path_value)
    emit_progress(request_id, percent=5, stage="validate", message="Validating path")
    if not path.is_file():
        raise FileNotFoundError(f"GeoJSON file not found: {path}")

    emit_log(request_id, f"Reading {path.name}")
    emit_progress(request_id, percent=25, stage="read", message="Reading GeoJSON")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    emit_progress(request_id, percent=60, stage="analyze", message="Analyzing features")
    if not isinstance(data, dict):
        raise ValueError("GeoJSON root must be an object")

    root_type = data.get("type")
    features = []
    if root_type == "FeatureCollection":
        features = data.get("features") or []
    elif root_type == "Feature":
        features = [data]
    else:
        # Geometry-only document
        features = [{"type": "Feature", "geometry": data, "properties": {}}]

    if not isinstance(features, list):
        raise ValueError("FeatureCollection.features must be an array")

    geom_counts: Counter[str] = Counter()
    property_keys = set()
    for feature in features:
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        geom_type = geometry.get("type") if isinstance(geometry, dict) else None
        geom_counts[str(geom_type or "null")] += 1
        props = feature.get("properties") or {}
        if isinstance(props, dict):
            property_keys.update(str(key) for key in props.keys())

    emit_progress(request_id, percent=100, stage="done", message="Summary complete")
    return {
        "path": str(path.resolve()),
        "rootType": root_type,
        "featureCount": len(features),
        "geometryTypes": dict(sorted(geom_counts.items())),
        "propertyKeys": sorted(property_keys),
        "byteSize": path.stat().st_size,
    }


OPERATION_HANDLERS: Dict[str, Handler] = {
    "health": op_health,
    "echo": op_echo,
    "summarize_geojson": op_summarize_geojson,
}


def dispatch(request_id: str, operation: str, input_data: Dict[str, Any]) -> Any:
    handler = OPERATION_HANDLERS.get(operation)
    if handler is None:
        raise ValueError(f'Unknown operation "{operation}"')
    return handler(request_id, input_data or {})
