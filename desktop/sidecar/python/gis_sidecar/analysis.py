"""Path-based vector analysis ops (buffer, clip, spatial join, reproject, spatial filter)."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .engines import duckdb_available, pyogrio_available
from .protocol import emit_log, emit_progress

_GEOJSON_SUFFIXES = {".geojson", ".json"}
_IN_MEMORY_CAP = 80_000
_PREVIEW_CAP = 500

_RELATION_MAP = {
    "intersects": "intersects",
    "within": "within",
    "contains": "contains",
    "centroid_within": "centroid_within",
}


def _sql_quote_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def _require_shapely():
    try:
        import shapely  # noqa: F401
        from shapely.geometry import mapping, shape  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "Analysis ops require shapely (pip install -r desktop/sidecar/python/requirements.txt)"
        ) from exc


def _load_geojson_features(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("GeoJSON root must be an object")
    if data.get("type") == "FeatureCollection":
        return [f for f in (data.get("features") or []) if isinstance(f, dict)]
    if data.get("type") == "Feature":
        return [data]
    if data.get("coordinates") is not None:
        return [{"type": "Feature", "geometry": data, "properties": {}}]
    raise ValueError("Unsupported GeoJSON type")


def _load_features(path: Path, max_features: Optional[int] = None) -> List[dict]:
    cap = max_features if max_features is not None else _IN_MEMORY_CAP
    if path.suffix.lower() in _GEOJSON_SUFFIXES:
        features = _load_geojson_features(path)
        if len(features) > cap:
            raise ValueError(
                f"Dataset has {len(features):,} features; in-memory analysis supports up to {cap:,}. "
                "Convert to GeoParquet and ensure DuckDB is available, or reduce input size."
            )
        return features

    if not pyogrio_available():
        raise ValueError(
            f'Cannot open "{path.suffix}" without pyogrio '
            "(pip install -r desktop/sidecar/python/requirements.txt)"
        )

    import pyogrio  # type: ignore
    from shapely import from_wkb  # type: ignore
    from shapely.geometry import mapping  # type: ignore

    info = pyogrio.read_info(str(path))
    total = int(info.get("features") or 0)
    if total > cap:
        raise ValueError(
            f"Dataset has {total:,} features; in-memory analysis supports up to {cap:,}."
        )
    field_names = [str(f) for f in (info.get("fields") or [])]
    try:
        meta, geometry, field_data = pyogrio.raw.read(str(path), max_features=cap)
    except TypeError:
        meta, geometry, field_data = pyogrio.raw.read(str(path))
    _ = meta
    features: List[dict] = []
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
                        if hasattr(val, "item"):
                            val = val.item()
                        props[name] = val
                    except Exception:  # noqa: BLE001
                        props[name] = None
        features.append({"type": "Feature", "geometry": geom, "properties": props})
    return features


def _write_geojson(path: Path, features: List[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle)


def _units_to_meters(distance: float, units: str) -> float:
    u = (units or "meters").lower()
    if u in {"m", "meter", "meters"}:
        return float(distance)
    if u in {"km", "kilometer", "kilometers"}:
        return float(distance) * 1000.0
    if u in {"ft", "feet", "foot"}:
        return float(distance) * 0.3048
    if u in {"mi", "mile", "miles"}:
        return float(distance) * 1609.344
    if u in {"degrees", "deg"}:
        # approximate at equator — last resort
        return float(distance) * 111_320.0
    raise ValueError(f"Unsupported buffer units: {units}")


def _buffer_geom_meters(geom: Any, meters: float):
    """Buffer in meters using Web Mercator when pyproj is available."""
    from shapely.geometry import mapping, shape
    from shapely.ops import transform

    g = shape(geom) if isinstance(geom, dict) else geom
    try:
        from pyproj import Transformer

        to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
        to_wgs = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform
        projected = transform(to_merc, g)
        buffered = projected.buffer(meters)
        return mapping(transform(to_wgs, buffered))
    except Exception:  # noqa: BLE001
        # Degree approximation (~meters / cos(lat) / 111320)
        centroid = g.centroid
        lat = centroid.y if hasattr(centroid, "y") else 0.0
        deg = meters / (111_320.0 * max(0.2, math.cos(math.radians(lat))))
        return mapping(g.buffer(deg))


def _clip_feature(feature: dict, clip_geom: Any) -> Optional[dict]:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    if not feature.get("geometry"):
        return None
    try:
        g = shape(feature["geometry"])
        clip = clip_geom if not isinstance(clip_geom, dict) else shape(clip_geom)
        if clip.geom_type == "GeometryCollection":
            clip = unary_union(clip)
        if g.is_empty or clip.is_empty:
            return None
        if g.geom_type == "Point":
            if clip.contains(g) or clip.touches(g):
                return feature
            return None
        inter = g.intersection(clip)
        if inter.is_empty:
            return None
        return {
            "type": "Feature",
            "geometry": mapping(inter),
            "properties": dict(feature.get("properties") or {}),
        }
    except Exception:  # noqa: BLE001
        return None


def _relation_match(feature: dict, area_geom: Any, relation: str) -> bool:
    from shapely.geometry import shape

    if not feature.get("geometry"):
        return False
    try:
        g = shape(feature["geometry"])
        area = area_geom if not isinstance(area_geom, dict) else shape(area_geom)
        if relation == "intersects":
            return bool(g.intersects(area))
        if relation == "within":
            return bool(g.within(area))
        if relation == "contains":
            return bool(g.contains(area))
        if relation == "centroid_within":
            return bool(g.centroid.within(area))
        return bool(g.intersects(area))
    except Exception:  # noqa: BLE001
        return False


def _result_payload(
    *,
    path: Path,
    output: Path,
    features: List[dict],
    engine: str,
    op: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    preview = features[:_PREVIEW_CAP]
    geom_counts: Dict[str, int] = {}
    for f in features:
        gt = (f.get("geometry") or {}).get("type") or "null"
        geom_counts[str(gt)] = geom_counts.get(str(gt), 0) + 1
    payload = {
        "path": str(path.resolve()),
        "outputPath": str(output.resolve()),
        "featureCount": len(features),
        "sampledFeatureCount": len(preview),
        "geometryTypes": geom_counts,
        "byteSize": output.stat().st_size if output.is_file() else 0,
        "format": "geojson",
        "engine": engine,
        "op": op,
        "previewGeojson": {"type": "FeatureCollection", "features": preview},
    }
    if extra:
        payload.update(extra)
    return payload


def buffer_vector(
    path: Path,
    output: Path,
    request_id: str,
    *,
    distance: float,
    units: str = "meters",
) -> Dict[str, Any]:
    _require_shapely()
    meters = _units_to_meters(distance, units)
    emit_progress(request_id, percent=10, stage="read", message="Loading features")
    features = _load_features(path)
    emit_progress(request_id, percent=30, stage="buffer", message=f"Buffering {len(features)} features")
    out_features: List[dict] = []
    for i, feat in enumerate(features):
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            buffered = _buffer_geom_meters(geom, meters)
            out_features.append(
                {
                    "type": "Feature",
                    "geometry": buffered,
                    "properties": dict(feat.get("properties") or {}),
                }
            )
        except Exception:  # noqa: BLE001
            continue
        if i and i % 2000 == 0:
            pct = 30 + int(50 * i / max(len(features), 1))
            emit_progress(request_id, percent=min(pct, 85), stage="buffer", message=f"Buffered {i}")
    emit_progress(request_id, percent=90, stage="write", message="Writing output")
    _write_geojson(output, out_features)
    emit_progress(request_id, percent=100, stage="done", message="Buffer complete")
    return _result_payload(
        path=path,
        output=output,
        features=out_features,
        engine="shapely",
        op="buffer_vector",
        extra={"distance": distance, "units": units, "distanceMeters": meters},
    )


def clip_vector(
    path: Path,
    clip_path: Path,
    output: Path,
    request_id: str,
) -> Dict[str, Any]:
    _require_shapely()
    from shapely.geometry import shape
    from shapely.ops import unary_union

    emit_progress(request_id, percent=10, stage="read", message="Loading layers")
    features = _load_features(path)
    clip_features = _load_features(clip_path, max_features=5_000)
    clip_geoms = [shape(f["geometry"]) for f in clip_features if f.get("geometry")]
    if not clip_geoms:
        raise ValueError("Clip layer has no geometries")
    clip_geom = unary_union(clip_geoms)
    emit_progress(request_id, percent=35, stage="clip", message=f"Clipping {len(features)} features")
    out_features: List[dict] = []
    for i, feat in enumerate(features):
        clipped = _clip_feature(feat, clip_geom)
        if clipped:
            out_features.append(clipped)
        if i and i % 2000 == 0:
            pct = 35 + int(50 * i / max(len(features), 1))
            emit_progress(request_id, percent=min(pct, 85), stage="clip", message=f"Clipped {i}")
    emit_progress(request_id, percent=90, stage="write", message="Writing output")
    _write_geojson(output, out_features)
    emit_progress(request_id, percent=100, stage="done", message="Clip complete")
    return _result_payload(
        path=path,
        output=output,
        features=out_features,
        engine="shapely",
        op="clip_vector",
        extra={"clipPath": str(clip_path.resolve())},
    )


def spatial_filter(
    path: Path,
    output: Path,
    request_id: str,
    *,
    area_geojson: Optional[dict] = None,
    area_path: Optional[Path] = None,
    relation: str = "intersects",
) -> Dict[str, Any]:
    _require_shapely()
    from shapely.geometry import shape
    from shapely.ops import unary_union

    rel = _RELATION_MAP.get((relation or "intersects").lower(), "intersects")
    emit_progress(request_id, percent=10, stage="read", message="Loading features")
    features = _load_features(path)

    if area_path is not None:
        area_features = _load_features(area_path, max_features=5_000)
        area_geoms = [shape(f["geometry"]) for f in area_features if f.get("geometry")]
        if not area_geoms:
            raise ValueError("Analysis area has no geometries")
        area_geom = unary_union(area_geoms)
    elif area_geojson is not None:
        if area_geojson.get("type") == "FeatureCollection":
            area_geoms = [
                shape(f["geometry"])
                for f in (area_geojson.get("features") or [])
                if isinstance(f, dict) and f.get("geometry")
            ]
            area_geom = unary_union(area_geoms) if area_geoms else None
        elif area_geojson.get("type") == "Feature":
            area_geom = shape(area_geojson["geometry"])
        else:
            area_geom = shape(area_geojson)
    else:
        raise ValueError("spatial_filter requires areaGeojson or areaPath")

    if area_geom is None or area_geom.is_empty:
        raise ValueError("Analysis area is empty")

    emit_progress(request_id, percent=35, stage="filter", message=f"Filtering ({rel})")
    matched: List[dict] = []
    for i, feat in enumerate(features):
        if _relation_match(feat, area_geom, rel):
            matched.append(feat)
        if i and i % 2000 == 0:
            pct = 35 + int(50 * i / max(len(features), 1))
            emit_progress(request_id, percent=min(pct, 85), stage="filter", message=f"Scanned {i}")

    emit_progress(request_id, percent=90, stage="write", message="Writing matches")
    _write_geojson(output, matched)
    emit_progress(request_id, percent=100, stage="done", message="Filter complete")
    return _result_payload(
        path=path,
        output=output,
        features=matched,
        engine="shapely",
        op="spatial_filter",
        extra={"relation": rel, "inputFeatureCount": len(features)},
    )


def spatial_join(
    left_path: Path,
    right_path: Path,
    output: Path,
    request_id: str,
    *,
    predicate: str = "intersects",
) -> Dict[str, Any]:
    """Join left features to first matching right feature (attribute merge)."""
    _require_shapely()
    from shapely.geometry import shape

    pred = (predicate or "intersects").lower()
    if pred not in {"intersects", "within", "contains"}:
        pred = "intersects"

    emit_progress(request_id, percent=10, stage="read", message="Loading join layers")
    left = _load_features(left_path)
    right = _load_features(right_path)
    right_prepared: List[Tuple[Any, dict]] = []
    for f in right:
        if not f.get("geometry"):
            continue
        try:
            right_prepared.append((shape(f["geometry"]), dict(f.get("properties") or {})))
        except Exception:  # noqa: BLE001
            continue

    emit_progress(request_id, percent=35, stage="join", message=f"Joining {len(left)} × {len(right_prepared)}")
    out_features: List[dict] = []
    for i, feat in enumerate(left):
        if not feat.get("geometry"):
            continue
        try:
            g = shape(feat["geometry"])
        except Exception:  # noqa: BLE001
            continue
        match_props = None
        for rg, rprops in right_prepared:
            try:
                ok = (
                    g.intersects(rg)
                    if pred == "intersects"
                    else g.within(rg)
                    if pred == "within"
                    else g.contains(rg)
                )
            except Exception:  # noqa: BLE001
                ok = False
            if ok:
                match_props = rprops
                break
        props = dict(feat.get("properties") or {})
        if match_props:
            for k, v in match_props.items():
                props[f"join_{k}"] = v
            props["__joined"] = True
        else:
            props["__joined"] = False
        out_features.append(
            {"type": "Feature", "geometry": feat["geometry"], "properties": props}
        )
        if i and i % 2000 == 0:
            pct = 35 + int(50 * i / max(len(left), 1))
            emit_progress(request_id, percent=min(pct, 85), stage="join", message=f"Joined {i}")

    emit_progress(request_id, percent=90, stage="write", message="Writing join output")
    _write_geojson(output, out_features)
    emit_progress(request_id, percent=100, stage="done", message="Spatial join complete")
    joined = sum(1 for f in out_features if (f.get("properties") or {}).get("__joined"))
    return _result_payload(
        path=left_path,
        output=output,
        features=out_features,
        engine="shapely",
        op="spatial_join",
        extra={
            "rightPath": str(right_path.resolve()),
            "predicate": pred,
            "joinedCount": joined,
        },
    )


def reproject_vector(
    path: Path,
    output: Path,
    request_id: str,
    *,
    target_crs: str = "EPSG:4326",
    source_crs: Optional[str] = None,
) -> Dict[str, Any]:
    """Reproject via DuckDB spatial when available; otherwise copy GeoJSON if already 4326."""
    target = (target_crs or "EPSG:4326").strip()
    source = (source_crs or "EPSG:4326").strip()

    if duckdb_available():
        import duckdb  # type: ignore

        emit_progress(request_id, percent=15, stage="duckdb", message="Reprojecting via DuckDB")
        output.parent.mkdir(parents=True, exist_ok=True)
        src = _sql_quote_path(path)
        dest = _sql_quote_path(output)
        con = duckdb.connect()
        try:
            con.execute("INSTALL spatial;")
            con.execute("LOAD spatial;")
            # Write GeoJSON via GDAL driver when possible
            if output.suffix.lower() in _GEOJSON_SUFFIXES:
                sql = (
                    f"COPY ("
                    f"SELECT * EXCLUDE (geom), "
                    f"ST_Transform(geom, '{source}', '{target}') AS geom "
                    f"FROM ST_Read('{src}')"
                    f") TO '{dest}' (FORMAT GDAL, DRIVER 'GeoJSON')"
                )
            else:
                sql = (
                    f"COPY ("
                    f"SELECT * EXCLUDE (geom), "
                    f"ST_Transform(geom, '{source}', '{target}') AS geom "
                    f"FROM ST_Read('{src}')"
                    f") TO '{dest}' (FORMAT PARQUET)"
                )
            try:
                con.execute(sql)
            except Exception:
                # Fallback: ST_Read may name geometry column differently
                sql2 = (
                    f"COPY (SELECT * FROM ST_Read('{src}')) TO '{dest}' "
                    f"(FORMAT GDAL, DRIVER 'GeoJSON')"
                )
                con.execute(sql2)
                emit_log(request_id, "Reproject fell back to copy (transform SQL unsupported for this file)")
        finally:
            con.close()

        if not output.is_file():
            raise RuntimeError("Reproject did not create output")
        # Load for preview counts
        if output.suffix.lower() in _GEOJSON_SUFFIXES:
            features = _load_geojson_features(output)
        else:
            features = _load_features(output, max_features=_PREVIEW_CAP)
        emit_progress(request_id, percent=100, stage="done", message="Reproject complete")
        return _result_payload(
            path=path,
            output=output,
            features=features if output.suffix.lower() in _GEOJSON_SUFFIXES else features,
            engine="duckdb-spatial",
            op="reproject_vector",
            extra={"sourceCrs": source, "targetCrs": target},
        )

    # Shapely/pyproj path for GeoJSON
    _require_shapely()
    if source.upper() == target.upper() and path.suffix.lower() in _GEOJSON_SUFFIXES:
        features = _load_features(path)
        _write_geojson(output, features)
        return _result_payload(
            path=path,
            output=output,
            features=features,
            engine="copy",
            op="reproject_vector",
            extra={"sourceCrs": source, "targetCrs": target},
        )

    try:
        from pyproj import Transformer
        from shapely.geometry import mapping, shape
        from shapely.ops import transform
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "reproject_vector requires duckdb or pyproj "
            "(pip install -r desktop/sidecar/python/requirements.txt)"
        ) from exc

    emit_progress(request_id, percent=20, stage="read", message="Loading for reproject")
    features = _load_features(path)
    transformer = Transformer.from_crs(source, target, always_xy=True)
    project = transformer.transform
    out_features: List[dict] = []
    for feat in features:
        if not feat.get("geometry"):
            continue
        try:
            g = transform(project, shape(feat["geometry"]))
            out_features.append(
                {
                    "type": "Feature",
                    "geometry": mapping(g),
                    "properties": dict(feat.get("properties") or {}),
                }
            )
        except Exception:  # noqa: BLE001
            continue
    _write_geojson(output, out_features)
    emit_progress(request_id, percent=100, stage="done", message="Reproject complete")
    return _result_payload(
        path=path,
        output=output,
        features=out_features,
        engine="pyproj",
        op="reproject_vector",
        extra={"sourceCrs": source, "targetCrs": target},
    )
