"""Allow-listed sidecar operations. No arbitrary script execution."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import __version__
from .engines import duckdb_available, probe_engines, pyogrio_available
from .protocol import PROTOCOL_VERSION, emit_log, emit_progress
from .tiling import generate_pmtiles, pmtiles_writer_available, tippecanoe_available
from . import analysis as analysis_ops


Handler = Callable[[str, Dict[str, Any]], Any]

_SAMPLE_MAX_JSON_CHARS = 2_000_000
_SAMPLE_DEFAULT_MAX_FEATURES = 500
_GEOJSON_SUFFIXES = {".geojson", ".json"}
_PYOGRIO_SUFFIXES = {
    ".geojson",
    ".json",
    ".gpkg",
    ".shp",
    ".parquet",
    ".geoparquet",
    ".kml",
    ".gml",
    ".fgb",
}


def op_health(_request_id: str, _input: Dict[str, Any]) -> Dict[str, Any]:
    engines = probe_engines()
    engines = {
        **engines,
        "tippecanoe": {"available": tippecanoe_available()},
        "pmtilesWriter": {"available": pmtiles_writer_available()},
    }
    return {
        "ok": True,
        "version": __version__,
        "protocolVersion": PROTOCOL_VERSION,
        "operations": sorted(OPERATION_HANDLERS.keys()),
        "engines": engines,
        "localGdal": bool(engines.get("pyogrio", {}).get("available")),
        "duckdb": bool(engines.get("duckdb", {}).get("available")),
    }


def op_echo(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    emit_progress(request_id, percent=50, stage="echo", message="Echoing payload")
    emit_log(request_id, "echo operation running")
    emit_progress(request_id, percent=100, stage="done", message="Echo complete")
    return {"echo": input_data}


def _require_path(input_data: Dict[str, Any], op_name: str, key: str = "path") -> Path:
    path_value = input_data.get(key)
    if not path_value or not isinstance(path_value, str):
        raise ValueError(f"{op_name} requires input.{key} (file path string)")
    path = Path(path_value)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")
    return path


def _require_output_path(input_data: Dict[str, Any], op_name: str, default: Path) -> Path:
    raw = input_data.get("outputPath")
    if raw is None or raw == "":
        return default
    if not isinstance(raw, str):
        raise ValueError(f"{op_name} outputPath must be a string")
    out = Path(raw)
    if ".." in out.as_posix():
        raise ValueError(f"{op_name} outputPath must not contain ..")
    if out.parent and not out.parent.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
    return out


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


def _format_from_path(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    if ext in {"geojson", "json"}:
        return "geojson"
    if ext == "geoparquet":
        return "parquet"
    return ext or "unknown"


def _is_geojson_path(path: Path) -> bool:
    return path.suffix.lower() in _GEOJSON_SUFFIXES


def _can_use_pyogrio(path: Path) -> bool:
    # Prefer stdlib for GeoJSON; use pyogrio for other GDAL formats (no geopandas required for info/raw).
    if _is_geojson_path(path):
        return False
    return pyogrio_available() and path.suffix.lower() in _PYOGRIO_SUFFIXES


def _inspect_with_pyogrio(path: Path) -> Dict[str, Any]:
    import pyogrio  # type: ignore

    info = pyogrio.read_info(path)
    fields = info.get("fields") or []
    dtypes = info.get("dtypes") or []
    property_keys = [str(f) for f in fields]
    geom_type = info.get("geometry_type") or info.get("geom_type")
    geometry_types = {str(geom_type): int(info.get("features") or 0)} if geom_type else {}
    crs = info.get("crs")
    crs_hint = str(crs) if crs else None
    bbox = info.get("total_bounds") or info.get("bbox")
    if bbox is not None:
        try:
            bbox = [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
        except Exception:  # noqa: BLE001
            bbox = None
    return {
        "path": str(path.resolve()),
        "format": _format_from_path(path),
        "rootType": "FeatureCollection",
        "featureCount": int(info.get("features") or 0),
        "geometryTypes": geometry_types,
        "propertyKeys": property_keys,
        "fieldDtypes": [str(d) for d in dtypes],
        "bbox": bbox,
        "byteSize": path.stat().st_size,
        "crsHint": crs_hint,
        "engine": "pyogrio",
    }


def _sample_with_pyogrio(path: Path, max_features: int) -> Tuple[List[dict], int]:
    """Sample without geopandas — use pyogrio.raw + shapely WKB when available."""
    import pyogrio  # type: ignore

    info = pyogrio.read_info(path)
    total = int(info.get("features") or 0)
    field_names = [str(f) for f in (info.get("fields") or [])]

    # raw.read returns meta, geometry (WKB), field arrays
    try:
        meta, geometry, field_data = pyogrio.raw.read(
            str(path),
            max_features=max_features,
        )
    except TypeError:
        meta, geometry, field_data = pyogrio.raw.read(str(path))
        if geometry is not None and len(geometry) > max_features:
            geometry = geometry[:max_features]
            if field_data is not None:
                field_data = [col[:max_features] for col in field_data]

    features: List[dict] = []
    try:
        from shapely import from_wkb  # type: ignore
        from shapely.geometry import mapping  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "Sampling non-GeoJSON formats requires shapely "
            f"(pip install -r requirements.txt): {exc}"
        ) from exc

    count = len(geometry) if geometry is not None else 0
    for i in range(count):
        geom = None
        try:
            if geometry[i] is not None:
                geom = mapping(from_wkb(geometry[i]))
        except Exception:  # noqa: BLE001
            geom = None
        props: Dict[str, Any] = {}
        if field_data is not None and field_names:
            for fi, name in enumerate(field_names):
                if fi < len(field_data):
                    try:
                        val = field_data[fi][i]
                        # numpy scalars → python
                        if hasattr(val, "item"):
                            val = val.item()
                        props[name] = val
                    except Exception:  # noqa: BLE001
                        props[name] = None
        features.append({"type": "Feature", "geometry": geom, "properties": props})

    _ = meta
    return features, total


def _cap_sample_features(sampled: List[dict], request_id: str) -> List[dict]:
    while sampled:
        payload = {"type": "FeatureCollection", "features": sampled}
        encoded = json.dumps(payload, separators=(",", ":"))
        if len(encoded) <= _SAMPLE_MAX_JSON_CHARS:
            break
        keep = max(1, int(len(sampled) * 0.75))
        if keep >= len(sampled):
            keep = len(sampled) - 1
        if keep < 1:
            raise ValueError("sample_vector preview exceeds IPC size budget even for one feature")
        sampled = sampled[:keep]
        emit_log(request_id, f"Reduced sample to {keep} features for IPC budget")
    return sampled


def op_summarize_geojson(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
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
    path = _require_path(input_data, "inspect_vector")
    emit_progress(request_id, percent=10, stage="validate", message="Validating path")
    emit_log(request_id, f"Inspecting {path.name}")

    if _can_use_pyogrio(path):
        emit_progress(request_id, percent=40, stage="read", message="Reading via pyogrio")
        result = _inspect_with_pyogrio(path)
        emit_progress(request_id, percent=100, stage="done", message="Inspect complete")
        return result

    if path.suffix.lower() not in _GEOJSON_SUFFIXES:
        raise ValueError(
            f'inspect_vector: format "{path.suffix or "unknown"}" requires pyogrio/GDAL '
            "(pip install -r desktop/sidecar/python/requirements.txt)."
        )

    emit_progress(request_id, percent=35, stage="read", message="Reading GeoJSON")
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
        "engine": "stdlib",
    }


def op_sample_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "sample_vector")
    max_features = input_data.get("maxFeatures", _SAMPLE_DEFAULT_MAX_FEATURES)
    try:
        max_features = int(max_features)
    except (TypeError, ValueError) as exc:
        raise ValueError("sample_vector maxFeatures must be an integer") from exc
    max_features = max(1, min(max_features, 5000))

    emit_progress(request_id, percent=10, stage="validate", message="Validating path")
    emit_log(request_id, f"Sampling {path.name} (max {max_features})")

    if _can_use_pyogrio(path):
        emit_progress(request_id, percent=35, stage="read", message="Sampling via pyogrio")
        sampled, total = _sample_with_pyogrio(path, max_features)
        sampled = [f for f in sampled if isinstance(f, dict)]
        sampled = _cap_sample_features(sampled, request_id)
        geom_counts, property_keys, bbox = _analyze_features(sampled)
        emit_progress(request_id, percent=100, stage="done", message="Sample complete")
        return {
            "path": str(path.resolve()),
            "format": _format_from_path(path),
            "featureCount": total,
            "sampledFeatureCount": len(sampled),
            "geometryTypes": geom_counts,
            "propertyKeys": property_keys,
            "bbox": bbox,
            "previewOnly": len(sampled) < total,
            "byteSize": path.stat().st_size,
            "engine": "pyogrio",
            "geojson": {"type": "FeatureCollection", "features": sampled},
        }

    if path.suffix.lower() not in _GEOJSON_SUFFIXES:
        raise ValueError(
            f'sample_vector: format "{path.suffix or "unknown"}" requires pyogrio/GDAL '
            "(pip install -r desktop/sidecar/python/requirements.txt)."
        )

    emit_progress(request_id, percent=30, stage="read", message="Reading GeoJSON")
    _root_type, features = _load_geojson_features(path)
    emit_progress(request_id, percent=60, stage="sample", message="Building preview")
    sampled = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        sampled.append(feature)
        if len(sampled) >= max_features:
            break
    sampled = _cap_sample_features(sampled, request_id)
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
        "engine": "stdlib",
        "geojson": {"type": "FeatureCollection", "features": sampled},
    }


def op_file_checksum(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "file_checksum")
    emit_progress(request_id, percent=10, stage="hash", message="Computing SHA-256")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            if size and size % (16 * 1024 * 1024) == 0:
                emit_progress(
                    request_id,
                    percent=min(90, 10 + int((size / max(path.stat().st_size, 1)) * 80)),
                    stage="hash",
                    message=f"Hashed {size // (1024 * 1024)} MB",
                )
    emit_progress(request_id, percent=100, stage="done", message="Checksum complete")
    return {
        "path": str(path.resolve()),
        "algorithm": "sha256",
        "checksum": digest.hexdigest(),
        "byteSize": size,
    }


def _sql_quote_path(path: Path) -> str:
    """Single-quote a filesystem path for DuckDB SQL (escape embedded quotes)."""
    return "'" + str(path.resolve()).replace("'", "''") + "'"


def _convert_with_duckdb(path: Path, output: Path, request_id: str) -> str:
    import duckdb  # type: ignore

    emit_log(request_id, "Converting via DuckDB spatial")
    con = duckdb.connect()
    try:
        con.execute("INSTALL spatial;")
        con.execute("LOAD spatial;")
        emit_progress(request_id, percent=40, stage="read", message="ST_Read source")
        # DuckDB COPY ... TO ? parameter binding is unreliable with ST_Read(?);
        # use quoted literals after path validation.
        src = _sql_quote_path(path)
        dest = _sql_quote_path(output)
        con.execute(f"CREATE OR REPLACE TABLE _gis_convert AS SELECT * FROM ST_Read({src})")
        emit_progress(request_id, percent=70, stage="write", message="Writing Parquet")
        con.execute(f"COPY _gis_convert TO {dest} (FORMAT PARQUET)")
    finally:
        con.close()
    return "duckdb"


def op_convert_to_geoparquet(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a vector file on disk to GeoParquet (DuckDB spatial).
    Input: { "path": "<source>", "outputPath"?: "<dest.parquet>" }
    """
    path = _require_path(input_data, "convert_to_geoparquet")
    default_out = path.with_suffix(".parquet")
    if default_out.resolve() == path.resolve():
        default_out = path.parent / f"{path.stem}.geoparquet.parquet"
    output = _require_output_path(input_data, "convert_to_geoparquet", default_out)

    emit_progress(request_id, percent=5, stage="validate", message="Validating paths")
    if not duckdb_available():
        raise ValueError(
            "convert_to_geoparquet requires duckdb "
            "(pip install -r desktop/sidecar/python/requirements.txt)"
        )

    emit_progress(request_id, percent=20, stage="convert", message="Converting to GeoParquet")
    engine = _convert_with_duckdb(path, output, request_id)

    if not output.is_file():
        raise RuntimeError(f"GeoParquet output was not created: {output}")

    emit_progress(request_id, percent=100, stage="done", message="GeoParquet ready")
    return {
        "path": str(path.resolve()),
        "outputPath": str(output.resolve()),
        "byteSize": output.stat().st_size,
        "engine": engine,
        "format": "parquet",
    }


def op_summarize_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Attribute/geometry summary. Prefers DuckDB spatial; falls back to GeoJSON summarize.
    Input: { "path": "<file>" }
    """
    path = _require_path(input_data, "summarize_vector")
    emit_progress(request_id, percent=10, stage="validate", message="Validating path")

    if duckdb_available() and path.suffix.lower() in _PYOGRIO_SUFFIXES | {".csv", ".parquet"}:
        import duckdb  # type: ignore

        emit_log(request_id, f"Summarizing {path.name} via DuckDB")
        con = duckdb.connect()
        try:
            con.execute("INSTALL spatial;")
            con.execute("LOAD spatial;")
            emit_progress(request_id, percent=40, stage="query", message="Running summary SQL")
            # Row count via ST_Read when spatial can open the file
            try:
                row = con.execute(
                    "SELECT COUNT(*)::BIGINT AS n FROM ST_Read(?)",
                    [str(path.resolve())],
                ).fetchone()
                feature_count = int(row[0]) if row else 0
                engine = "duckdb-spatial"
            except Exception:  # noqa: BLE001
                # Tabular fallback
                row = con.execute(
                    "SELECT COUNT(*)::BIGINT AS n FROM read_parquet(?) ",
                    [str(path.resolve())],
                ).fetchone() if path.suffix.lower() in {".parquet", ".geoparquet"} else None
                if row is None and path.suffix.lower() == ".csv":
                    row = con.execute(
                        "SELECT COUNT(*)::BIGINT AS n FROM read_csv_auto(?)",
                        [str(path.resolve())],
                    ).fetchone()
                if row is None:
                    raise
                feature_count = int(row[0])
                engine = "duckdb"
        finally:
            con.close()
        emit_progress(request_id, percent=100, stage="done", message="Summary complete")
        return {
            "path": str(path.resolve()),
            "featureCount": feature_count,
            "byteSize": path.stat().st_size,
            "engine": engine,
            "format": _format_from_path(path),
        }

    if path.suffix.lower() in _GEOJSON_SUFFIXES:
        return op_summarize_geojson(request_id, input_data)

    if _can_use_pyogrio(path):
        emit_progress(request_id, percent=50, stage="read", message="Summarizing via pyogrio info")
        info = _inspect_with_pyogrio(path)
        emit_progress(request_id, percent=100, stage="done", message="Summary complete")
        return {
            "path": info["path"],
            "featureCount": info["featureCount"],
            "geometryTypes": info.get("geometryTypes"),
            "propertyKeys": info.get("propertyKeys"),
            "byteSize": info["byteSize"],
            "engine": "pyogrio",
            "format": info.get("format"),
        }

    raise ValueError(
        "summarize_vector could not open this file — install duckdb/pyogrio or use GeoJSON"
    )


def op_generate_pmtiles(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a PMTiles archive from a vector file on disk.
    Input: {
      "path": "<source>",
      "outputPath"?: "<dest.pmtiles>",
      "minZoom"?: 0,
      "maxZoom"?: 12,
      "maxFeatures"?: 40000
    }
    Prefers tippecanoe when on PATH; otherwise Python MVT writer (feature-capped).
    """
    path = _require_path(input_data, "generate_pmtiles")
    default_out = path.with_suffix(".pmtiles")
    if default_out.resolve() == path.resolve():
        default_out = path.parent / f"{path.stem}.pmtiles"
    output = _require_output_path(input_data, "generate_pmtiles", default_out)

    min_zoom = input_data.get("minZoom")
    max_zoom = input_data.get("maxZoom")
    max_features = input_data.get("maxFeatures")

    return generate_pmtiles(
        path,
        output,
        request_id,
        min_zoom=int(min_zoom) if min_zoom is not None else None,
        max_zoom=int(max_zoom) if max_zoom is not None else None,
        max_features=int(max_features) if max_features is not None else None,
    )


def op_buffer_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "buffer_vector")
    distance = input_data.get("distance")
    if distance is None:
        raise ValueError("buffer_vector requires input.distance")
    units = str(input_data.get("units") or "meters")
    default_out = path.parent / f"{path.stem}_buffer.geojson"
    output = _require_output_path(input_data, "buffer_vector", default_out)
    return analysis_ops.buffer_vector(
        path, output, request_id, distance=float(distance), units=units
    )


def op_clip_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "clip_vector")
    clip_path = _require_path(input_data, "clip_vector", key="clipPath")
    default_out = path.parent / f"{path.stem}_clip.geojson"
    output = _require_output_path(input_data, "clip_vector", default_out)
    return analysis_ops.clip_vector(path, clip_path, output, request_id)


def op_spatial_join(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "spatial_join")
    right = _require_path(input_data, "spatial_join", key="rightPath")
    predicate = str(input_data.get("predicate") or "intersects")
    default_out = path.parent / f"{path.stem}_join.geojson"
    output = _require_output_path(input_data, "spatial_join", default_out)
    return analysis_ops.spatial_join(
        path, right, output, request_id, predicate=predicate
    )


def op_reproject_vector(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "reproject_vector")
    target = str(input_data.get("targetCrs") or "EPSG:4326")
    source = input_data.get("sourceCrs")
    default_out = path.parent / f"{path.stem}_reproject.geojson"
    output = _require_output_path(input_data, "reproject_vector", default_out)
    return analysis_ops.reproject_vector(
        path,
        output,
        request_id,
        target_crs=target,
        source_crs=str(source) if source else None,
    )


def op_spatial_filter(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "spatial_filter")
    relation = str(input_data.get("relation") or "intersects")
    default_out = path.parent / f"{path.stem}_filter.geojson"
    output = _require_output_path(input_data, "spatial_filter", default_out)
    area_path = None
    if input_data.get("areaPath"):
        area_path = _require_path(input_data, "spatial_filter", key="areaPath")
    area_geojson = input_data.get("areaGeojson")
    if isinstance(area_geojson, str):
        area_geojson = json.loads(area_geojson)
    return analysis_ops.spatial_filter(
        path,
        output,
        request_id,
        area_geojson=area_geojson if isinstance(area_geojson, dict) else None,
        area_path=area_path,
        relation=relation,
    )


def op_nearest_join(request_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_path(input_data, "nearest_join")
    right = _require_path(input_data, "nearest_join", key="rightPath")
    default_out = path.parent / f"{path.stem}_nearest_join.geojson"
    output = _require_output_path(input_data, "nearest_join", default_out)
    mappings = input_data.get("fieldMappings") or []
    if not isinstance(mappings, list):
        raise ValueError("nearest_join fieldMappings must be an array")
    max_radius = input_data.get("maxRadius")
    return analysis_ops.nearest_join(
        path,
        right,
        output,
        request_id,
        field_mappings=mappings,
        max_radius=float(max_radius) if max_radius not in (None, "") else None,
        units=str(input_data.get("units") or "meters"),
        write_distance=bool(input_data.get("writeDistance", True)),
        write_match_id=bool(input_data.get("writeMatchId", False)),
        match_id_field=str(input_data.get("matchIdField") or ""),
        write_match_layer=bool(input_data.get("writeMatchLayer", False)),
        target_layer_name=str(input_data.get("targetLayerName") or ""),
    )


OPERATION_HANDLERS: Dict[str, Handler] = {
    "health": op_health,
    "echo": op_echo,
    "summarize_geojson": op_summarize_geojson,
    "inspect_vector": op_inspect_vector,
    "sample_vector": op_sample_vector,
    "file_checksum": op_file_checksum,
    "convert_to_geoparquet": op_convert_to_geoparquet,
    "summarize_vector": op_summarize_vector,
    "generate_pmtiles": op_generate_pmtiles,
    "buffer_vector": op_buffer_vector,
    "clip_vector": op_clip_vector,
    "spatial_join": op_spatial_join,
    "reproject_vector": op_reproject_vector,
    "spatial_filter": op_spatial_filter,
    "nearest_join": op_nearest_join,
}


def dispatch(request_id: str, operation: str, input_data: Dict[str, Any]) -> Any:
    handler = OPERATION_HANDLERS.get(operation)
    if handler is None:
        raise ValueError(f'Unknown operation "{operation}"')
    return handler(request_id, input_data or {})
