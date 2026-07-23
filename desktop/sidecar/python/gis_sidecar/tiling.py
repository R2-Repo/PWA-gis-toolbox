"""Generate PMTiles from a vector file (tippecanoe when available, else Python MVT writer)."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .protocol import emit_log, emit_progress

SOURCE_LAYER = "default"
# Soft cap for the in-process Python tiler (tippecanoe has no such cap).
_PYTHON_FEATURE_CAP = 40_000
_DEFAULT_MIN_ZOOM = 0
_DEFAULT_MAX_ZOOM = 12
_EXTENT = 4096


def tippecanoe_available() -> bool:
    return shutil.which("tippecanoe") is not None


def pmtiles_writer_available() -> bool:
    try:
        import pmtiles.writer  # noqa: F401
        import mapbox_vector_tile  # noqa: F401
        import mercantile  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


def _lonlat_to_tile_xy(lon: float, lat: float, z: int, x: int, y: int, extent: int = _EXTENT) -> Tuple[float, float]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2.0**z
    world_x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    world_y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return (world_x - x) * extent, (world_y - y) * extent


def _project_coords(coords: Any, z: int, x: int, y: int) -> Any:
    if not coords:
        return coords
    if isinstance(coords[0], (int, float)):
        return list(_lonlat_to_tile_xy(float(coords[0]), float(coords[1]), z, x, y))
    return [_project_coords(c, z, x, y) for c in coords]


def _feature_bbox(geom: dict) -> Optional[Tuple[float, float, float, float]]:
    try:
        from shapely.geometry import shape

        b = shape(geom).bounds  # minx, miny, maxx, maxy
        return float(b[0]), float(b[1]), float(b[2]), float(b[3])
    except Exception:  # noqa: BLE001
        return None


def _iter_geojson_features(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("GeoJSON root must be an object")
    if data.get("type") == "FeatureCollection":
        for f in data.get("features") or []:
            if isinstance(f, dict) and f.get("geometry"):
                yield f
    elif data.get("type") == "Feature" and data.get("geometry"):
        yield data
    elif data.get("type") and data.get("coordinates") is not None:
        yield {"type": "Feature", "geometry": data, "properties": {}}


def _load_features_for_tiling(path: Path, max_features: int) -> List[dict]:
    suffix = path.suffix.lower()
    features: List[dict] = []

    if suffix in {".geojson", ".json"}:
        for f in _iter_geojson_features(path):
            features.append(f)
            if len(features) >= max_features:
                break
        return features

    try:
        import pyogrio

        # pyogrio.read_info + read_arrow / geojson path without geopandas:
        # export a temporary GeoJSON via ogr2ogr-like write when possible.
        info = pyogrio.read_info(str(path))
        total = int(info.get("features") or 0)
        if total > max_features:
            raise ValueError(
                f"Dataset has {total:,} features; Python tiler supports up to "
                f"{max_features:,}. Install tippecanoe for larger layers, or sample first."
            )
        # Prefer GeoJSON dump via pyogrio if available
        with tempfile.TemporaryDirectory(prefix="gis-pmtiles-") as tmp:
            geojson_path = Path(tmp) / "layer.geojson"
            try:
                pyogrio.write_dataframe  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001
                pass
            # Use raw GDAL path through pyogrio.open_arrow / convert via duckdb if needed
            try:
                from .engines import duckdb_available

                if duckdb_available():
                    import duckdb

                    con = duckdb.connect()
                    try:
                        con.execute("INSTALL spatial;")
                        con.execute("LOAD spatial;")
                        # Quote paths for COPY TO GeoJSON
                        src = str(path.resolve()).replace("'", "''")
                        dest = str(geojson_path.resolve()).replace("'", "''")
                        con.execute(
                            f"COPY (SELECT * FROM ST_Read('{src}')) TO '{dest}' "
                            f"(FORMAT GDAL, DRIVER 'GeoJSON')"
                        )
                    finally:
                        con.close()
                    if geojson_path.is_file():
                        return _load_features_for_tiling(geojson_path, max_features)
            except Exception:  # noqa: BLE001
                pass

            # Last resort: shapefile/gpkg via ogr2ogr CLI
            ogr2ogr = shutil.which("ogr2ogr")
            if ogr2ogr:
                subprocess.run(
                    [ogr2ogr, "-f", "GeoJSON", str(geojson_path), str(path)],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                return _load_features_for_tiling(geojson_path, max_features)

        raise ValueError(
            "Could not read vector for tiling — use GeoJSON, or install duckdb/pyogrio/tippecanoe"
        )
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not open vector for tiling: {exc}") from exc


def _encode_tile(features: List[dict], z: int, x: int, y: int) -> bytes:
    import mapbox_vector_tile

    layer_features = []
    for feat in features:
        geom = feat.get("geometry")
        if not geom:
            continue
        projected = {
            "type": geom["type"],
            "coordinates": _project_coords(geom["coordinates"], z, x, y),
        }
        layer_features.append(
            {
                "geometry": projected,
                "properties": feat.get("properties") or {},
            }
        )
    if not layer_features:
        return b""
    return mapbox_vector_tile.encode(
        [{"name": SOURCE_LAYER, "features": layer_features}],
        default_options={"extents": _EXTENT, "y_coord_down": True},
    )


def _write_pmtiles_python(
    features: List[dict],
    output: Path,
    min_zoom: int,
    max_zoom: int,
    request_id: str,
) -> Dict[str, Any]:
    import mercantile
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    emit_progress(request_id, percent=30, stage="tile", message="Building vector tiles")
    buckets: Dict[Tuple[int, int, int], List[dict]] = defaultdict(list)
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")

    for idx, feat in enumerate(features):
        geom = feat.get("geometry")
        if not geom:
            continue
        bbox = _feature_bbox(geom)
        if not bbox:
            continue
        west, south, east, north = bbox
        min_lon = min(min_lon, west)
        min_lat = min(min_lat, south)
        max_lon = max(max_lon, east)
        max_lat = max(max_lat, north)
        for z in range(min_zoom, max_zoom + 1):
            for tile in mercantile.tiles(west, south, east, north, zooms=z):
                buckets[(tile.z, tile.x, tile.y)].append(feat)
        if idx and idx % 2000 == 0:
            pct = 30 + int(40 * idx / max(len(features), 1))
            emit_progress(request_id, percent=min(pct, 70), stage="tile", message=f"Indexed {idx} features")

    if not math.isfinite(min_lon):
        raise ValueError("No valid geometries to tile")

    output.parent.mkdir(parents=True, exist_ok=True)
    tile_count = 0
    with output.open("wb") as handle:
        writer = Writer(handle)
        keys = sorted(buckets.keys(), key=lambda t: (t[0], t[1], t[2]))
        total_tiles = len(keys) or 1
        for i, (z, x, y) in enumerate(keys):
            data = _encode_tile(buckets[(z, x, y)], z, x, y)
            if not data:
                continue
            writer.write_tile(zxy_to_tileid(z, x, y), data)
            tile_count += 1
            if i and i % 50 == 0:
                pct = 70 + int(25 * i / total_tiles)
                emit_progress(request_id, percent=min(pct, 95), stage="write", message=f"Wrote {i} tiles")

        header = {
            "tile_type": TileType.MVT,
            "tile_compression": Compression.NONE,
            "min_zoom": min_zoom,
            "max_zoom": max_zoom,
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
            "center_zoom": min(max_zoom, max(min_zoom, 8)),
            "center_lon": (min_lon + max_lon) / 2,
            "center_lat": (min_lat + max_lat) / 2,
        }
        metadata = {
            "name": output.stem,
            "format": "pbf",
            "type": "overlay",
            "generator": "gis-toolbox-sidecar",
            "vector_layers": [
                {
                    "id": SOURCE_LAYER,
                    "minzoom": min_zoom,
                    "maxzoom": max_zoom,
                    "fields": {},
                }
            ],
        }
        writer.finalize(header, metadata)

    return {
        "tileCount": tile_count,
        "minZoom": min_zoom,
        "maxZoom": max_zoom,
        "sourceLayer": SOURCE_LAYER,
        "engine": "python-mvt",
        "bbox": [min_lon, min_lat, max_lon, max_lat],
        "featureCount": len(features),
    }


def _generate_with_tippecanoe(
    path: Path,
    output: Path,
    min_zoom: int,
    max_zoom: int,
    request_id: str,
) -> Dict[str, Any]:
    emit_log(request_id, "Using tippecanoe for PMTiles generation")
    emit_progress(request_id, percent=25, stage="tippecanoe", message="Running tippecanoe")
    output.parent.mkdir(parents=True, exist_ok=True)
    # tippecanoe 2.17+ can write .pmtiles directly
    cmd = [
        "tippecanoe",
        "-o",
        str(output),
        "-Z",
        str(min_zoom),
        "-z",
        str(max_zoom),
        "-l",
        SOURCE_LAYER,
        "--force",
        "--drop-densest-as-needed",
        str(path),
    ]
    # Non-GeoJSON: tippecanoe may need GeoJSON — convert via duckdb/ogr when needed
    work_path = path
    tmp_dir = None
    if path.suffix.lower() not in {".geojson", ".json"}:
        tmp_dir = tempfile.mkdtemp(prefix="gis-tippecanoe-")
        work_path = Path(tmp_dir) / "layer.geojson"
        features = _load_features_for_tiling(path, max_features=5_000_000)
        with work_path.open("w", encoding="utf-8") as handle:
            json.dump({"type": "FeatureCollection", "features": features}, handle)
        cmd[-1] = str(work_path)

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "tippecanoe failed")
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    if not output.is_file():
        raise RuntimeError("tippecanoe did not create output PMTiles")

    return {
        "tileCount": None,
        "minZoom": min_zoom,
        "maxZoom": max_zoom,
        "sourceLayer": SOURCE_LAYER,
        "engine": "tippecanoe",
        "bbox": None,
        "featureCount": None,
    }


def generate_pmtiles(
    path: Path,
    output: Path,
    request_id: str,
    *,
    min_zoom: Optional[int] = None,
    max_zoom: Optional[int] = None,
    max_features: Optional[int] = None,
) -> Dict[str, Any]:
    zmin = _DEFAULT_MIN_ZOOM if min_zoom is None else int(min_zoom)
    zmax = _DEFAULT_MAX_ZOOM if max_zoom is None else int(max_zoom)
    if zmin < 0 or zmax > 22 or zmin > zmax:
        raise ValueError("Invalid minZoom/maxZoom")

    emit_progress(request_id, percent=5, stage="validate", message="Validating paths")

    if tippecanoe_available():
        meta = _generate_with_tippecanoe(path, output, zmin, zmax, request_id)
    else:
        if not pmtiles_writer_available():
            raise ValueError(
                "generate_pmtiles requires tippecanoe on PATH, or pip packages: "
                "pmtiles mapbox-vector-tile mercantile shapely"
            )
        cap = _PYTHON_FEATURE_CAP if max_features is None else int(max_features)
        emit_progress(request_id, percent=15, stage="read", message="Loading features for Python tiler")
        features = _load_features_for_tiling(path, max_features=cap)
        if not features:
            raise ValueError("No features found to tile")
        if len(features) >= cap:
            emit_log(
                request_id,
                f"Stopped at Python tiler feature cap ({cap:,}). Install tippecanoe for full datasets.",
            )
        meta = _write_pmtiles_python(features, output, zmin, zmax, request_id)

    emit_progress(request_id, percent=100, stage="done", message="PMTiles ready")
    meta.update(
        {
            "path": str(path.resolve()),
            "outputPath": str(output.resolve()),
            "byteSize": output.stat().st_size if output.is_file() else 0,
            "format": "pmtiles",
        }
    )
    return meta
