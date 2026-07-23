"""Allow-listed sidecar operations. No arbitrary script execution."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import __version__
from .protocol import PROTOCOL_VERSION, emit_log, emit_progress


Handler = Callable[[str, Dict[str, Any]], Any]

# Cap preview GeoJSON payload returned over IPC (characters of serialized JSON).
_SAMPLE_MAX_JSON_CHARS = 2_000_000
_SAMPLE_DEFAULT_MAX_FEATURES = 500
_SUPPORTED_VECTOR_SUFFIXES = {".geojson", ".json"}


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


def _require_path(input_data: Dict[str, Any], op_name: str) -> Path:
    path_value = input_data.get("path")
    if not path_value or not isinstance(path_value, str):
        raise ValueError(f"{op_name} requires input.path (file path string)")
    path = Path(path_value)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")
    return path


def _load_geojson_features(path: Path) -> Tuple[Any, List[dict]]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if not isinstance(data, dict):
        raise ValueError("GeoJSON root must be an object")

    root_type = data.get("type")
    if root_type == "FeatureCollection":
        features = data.get("features") or []
    elif root_type == "Feature":
        features = [data]
    else:
        features = [{"type": "Feature", "geometry": data, "properties": {}}]

    if not isinstance(features, list):
        raise ValueError("FeatureCollection.features must be an array")
    return root_type, features


def _analyze_features(features: List[Any]) -> Tuple[Dict[str, int], List[str], Optional[List[float]]]:
    geom_counts: Counter[str] = Counter()
    property_keys: set[str] = set()
    min_x = min_y = max_x = max_y = None

    def _extend_bbox(coords: Any) -> None:
        nonlocal min_x, min_y, max_x, max_y
        if not isinstance(coords, (list, tuple)) or not coords:
            return
        if isinstance(coords[0], (int, float)):
            x, y = float(coords[0]), float(coords[1])
            min_x = x if min_x is None else min(min_x, x)
            min_y = y if min_y is None else min(min_y, y)
            max_x = x if max_x is None else max(max_x, x)
            max_y = y if max_y is None else max(max_y, y)
            return
        for item in coords:
            _extend_bbox(item)

    for feature in features:
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        geom_type = geometry.get("type") if isinstance(geometry, dict) else None
        geom_counts[str(geom_type or "null")] += 1
        props = feature.get("properties") or {}
        if isinstance(props, dict):
            property_keys.update(str(key) for key in props.keys())
        if isinstance(geometry, dict) and geometry.get("coordinates") is not None:
            _extend_bbox(geometry.get("coordinates"))

    bbox = None
    if min_x is not None and min_y is not None and max_x is not None and max_y is not None:
        bbox = [min_x, min_y, max_x, max_y]

    return dict(sorted(geom_counts.items())), sorted(property_keys), bbox


def _ensure_geojson_suffix(path: Path, op_name: str) -> None:
    if path.suffix.lower() not in _SUPPORTED_VECTOR_SUFFIXES:
        raise ValueError(
            f'{op_name} currently supports GeoJSON/JSON only '
            f'(got "{path.suffix or "no extension"}"). GDAL formats come in a later phase.'
        )


def op_summarize_geojson(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Narrow GIS operation: summarize a GeoJSON file on disk.
    Input: { "path": "<absolute-or-relative-file-path>" }
    Does not accept inline giant JSON payloads.
    """
    path = _require_path(input_data, "summarize_geojson")
    emit_progress(request_id, percent=5, stage="validate", message="Validating path")
    emit_log(request_id, f"Reading {path.name}")
    emit_progress(request_id, percent=25, stage="read", message="Reading GeoJSON")
    root_type, features = _load_geojson_features(path)

    emit_progress(request_id, percent=60, stage="analyze", message="Analyzing features")
    geom_counts, property_keys, _bbox = _analyze_features(features)

    emit_progress(request_id, percent=100, stage="done", message="Summary complete")
    return {
        "path": str(path.resolve()),
        "rootType": root_type,
        "featureCount": len(features),
        "geometryTypes": geom_counts,
        "propertyKeys": property_keys,
        "byteSize": path.stat().st_size,
    }


def op_inspect_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """Metadata-only inspect for path-based desktop import. GeoJSON/JSON in v0.1."""
    path = _require_path(input_data, "inspect_vector")
    _ensure_geojson_suffix(path, "inspect_vector")
    emit_progress(request_id, percent=10, stage="validate", message="Validating path")
    emit_log(request_id, f"Inspecting {path.name}")
    emit_progress(request_id, percent=35, stage="read", message="Reading vector file")
    root_type, features = _load_geojson_features(path)
    emit_progress(request_id, percent=75, stage="analyze", message="Analyzing metadata")
    geom_counts, property_keys, bbox = _analyze_features(features)
    emit_progress(request_id, percent=100, stage="done", message="Inspect complete")
    return {
        "path": str(path.resolve()),
        "format": "geojson",
        "rootType": root_type,
        "featureCount": len(features),
        "geometryTypes": geom_counts,
        "propertyKeys": property_keys,
        "bbox": bbox,
        "byteSize": path.stat().st_size,
        "crsHint": "EPSG:4326",
    }


def op_sample_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return a capped FeatureCollection preview for MapLibre.
    Input: { "path": "<file>", "maxFeatures"?: number }
    """
    path = _require_path(input_data, "sample_vector")
    _ensure_geojson_suffix(path, "sample_vector")
    max_features = input_data.get("maxFeatures", _SAMPLE_DEFAULT_MAX_FEATURES)
    try:
        max_features = int(max_features)
    except (TypeError, ValueError) as exc:
        raise ValueError("sample_vector maxFeatures must be an integer") from exc
    max_features = max(1, min(max_features, 5000))

    emit_progress(request_id, percent=10, stage="validate", message="Validating path")
    emit_log(request_id, f"Sampling {path.name} (max {max_features})")
    emit_progress(request_id, percent=30, stage="read", message="Reading vector file")
    _root_type, features = _load_geojson_features(path)
    emit_progress(request_id, percent=60, stage="sample", message="Building preview")

    sampled: List[dict] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        sampled.append(feature)
        if len(sampled) >= max_features:
            break

    # Shrink sample if serialized payload would overwhelm IPC.
    while sampled:
        payload = {"type": "FeatureCollection", "features": sampled}
        encoded = json.dumps(payload, separators=(",", ":"))
        if len(encoded) <= _SAMPLE_MAX_JSON_CHARS:
            break
        # Drop ~25% and retry
        keep = max(1, int(len(sampled) * 0.75))
        if keep >= len(sampled):
            keep = len(sampled) - 1
        if keep < 1:
            raise ValueError("sample_vector preview exceeds IPC size budget even for one feature")
        sampled = sampled[:keep]
        emit_log(request_id, f"Reduced sample to {keep} features for IPC budget")

    geom_counts, property_keys, bbox = _analyze_features(sampled)
    emit_progress(request_id, percent=100, stage="done", message="Sample complete")
    return {
        "path": str(path.resolve()),
        "format": "geojson",
        "featureCount": len(features),
        "sampledFeatureCount": len(sampled),
        "geometryTypes": geom_counts,
        "propertyKeys": property_keys,
        "bbox": bbox,
        "previewOnly": len(sampled) < len(features),
        "byteSize": path.stat().st_size,
        "geojson": {"type": "FeatureCollection", "features": sampled},
    }


OPERATION_HANDLERS: Dict[str, Handler] = {
    "health": op_health,
    "echo": op_echo,
    "summarize_geojson": op_summarize_geojson,
    "inspect_vector": op_inspect_vector,
    "sample_vector": op_sample_vector,
}


def dispatch(request_id: str, operation: str, input_data: Dict[str, Any]) -> Any:
    handler = OPERATION_HANDLERS.get(operation)
    if handler is None:
        raise ValueError(f'Unknown operation "{operation}"')
    return handler(request_id, input_data or {})
