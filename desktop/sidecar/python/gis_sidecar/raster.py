"""Raster helpers — COG convert + overview for desktop map display."""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .protocol import emit_log, emit_progress

_RASTER_SUFFIXES = {".tif", ".tiff", ".gtiff", ".img", ".jp2", ".vrt"}


def gdal_cli_available() -> bool:
    return shutil.which("gdal_translate") is not None and shutil.which("gdalinfo") is not None


def is_raster_path(path: Path) -> bool:
    return path.suffix.lower() in _RASTER_SUFFIXES


def _run(cmd: List[str], *, op: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"{op} requires GDAL CLI tools on PATH (gdal_translate, gdalinfo, gdalwarp)"
        ) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise RuntimeError(f"{op} failed: {detail[:800]}") from exc


def _gdalinfo(path: Path) -> Dict[str, Any]:
    result = _run(["gdalinfo", "-json", str(path)], op="gdalinfo")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("gdalinfo did not return JSON") from exc


def _wgs84_bbox_and_corners(info: Dict[str, Any]) -> Tuple[List[float], List[List[float]]]:
    """
    Return (bbox [w,s,e,n], image coordinates for MapLibre image source).
    MapLibre expects NW, NE, SE, SW corner lon/lat.
    """
    extent = info.get("wgs84Extent") or {}
    coords = extent.get("coordinates")
    # GeoJSON Polygon ring
    if isinstance(coords, list) and coords and isinstance(coords[0], list):
        ring = coords[0]
        lons = [float(c[0]) for c in ring if isinstance(c, (list, tuple)) and len(c) >= 2]
        lats = [float(c[1]) for c in ring if isinstance(c, (list, tuple)) and len(c) >= 2]
        if lons and lats:
            west, east = min(lons), max(lons)
            south, north = min(lats), max(lats)
            corners = [
                [west, north],
                [east, north],
                [east, south],
                [west, south],
            ]
            return [west, south, east, north], corners

    corners_raw = info.get("cornerCoordinates") or {}
    order = [
        ("upperLeft", True),
        ("upperRight", True),
        ("lowerRight", True),
        ("lowerLeft", True),
    ]
    pts: List[List[float]] = []
    for key, _ in order:
        pt = corners_raw.get(key)
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            pts.append([float(pt[0]), float(pt[1])])
    if len(pts) == 4:
        lons = [p[0] for p in pts]
        lats = [p[1] for p in pts]
        return [min(lons), min(lats), max(lons), max(lats)], pts

    raise RuntimeError("Could not determine WGS84 extent for raster overview")


def convert_to_cog(
    path: Path,
    output: Path,
    request_id: str,
    *,
    overview_max: int = 2048,
) -> Dict[str, Any]:
    """
    Convert a GeoTIFF (or GDAL-readable raster) to Cloud Optimized GeoTIFF
    and build a small WGS84 PNG overview for MapLibre image display.
    """
    if not gdal_cli_available():
        raise RuntimeError(
            "convert_to_cog requires GDAL on PATH "
            "(gdal_translate / gdalinfo / gdalwarp). Install OSGeo4W or GIS binaries."
        )

    emit_progress(request_id, percent=5, stage="validate", message="Validating raster")
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    output.parent.mkdir(parents=True, exist_ok=True)
    emit_progress(request_id, percent=20, stage="cog", message="Writing Cloud Optimized GeoTIFF")
    emit_log(request_id, f"gdal_translate → COG {output.name}")
    _run(
        [
            "gdal_translate",
            "-of",
            "COG",
            "-co",
            "COMPRESS=DEFLATE",
            "-co",
            "BIGTIFF=IF_SAFER",
            "-co",
            "OVERVIEWS=AUTO",
            str(path),
            str(output),
        ],
        op="convert_to_cog",
    )

    if not output.is_file():
        raise RuntimeError(f"COG output was not created: {output}")

    overview_tif = output.parent / f"{output.stem}_overview.tif"
    overview_png = output.parent / f"{output.stem}_overview.png"
    max_dim = max(256, min(int(overview_max or 2048), 8192))

    emit_progress(request_id, percent=55, stage="overview", message="Building WGS84 overview")
    # Warp to EPSG:4326 so MapLibre image corners are lon/lat
    if shutil.which("gdalwarp"):
        _run(
            [
                "gdalwarp",
                "-t_srs",
                "EPSG:4326",
                "-of",
                "GTiff",
                "-r",
                "bilinear",
                "-ts",
                str(max_dim),
                "0",
                str(output),
                str(overview_tif),
            ],
            op="convert_to_cog overview",
        )
    else:
        # Fallback: resize in source CRS (may be wrong for MapLibre if projected)
        emit_log(request_id, "gdalwarp missing — overview may not be WGS84")
        _run(
            [
                "gdal_translate",
                "-of",
                "GTiff",
                "-outsize",
                str(max_dim),
                "0",
                str(output),
                str(overview_tif),
            ],
            op="convert_to_cog overview",
        )

    _run(
        ["gdal_translate", "-of", "PNG", str(overview_tif), str(overview_png)],
        op="convert_to_cog png",
    )

    info = _gdalinfo(overview_tif if overview_tif.is_file() else output)
    bbox, coordinates = _wgs84_bbox_and_corners(info)

    png_b64: Optional[str] = None
    if overview_png.is_file():
        png_b64 = base64.b64encode(overview_png.read_bytes()).decode("ascii")

    # Keep PNG + drop intermediate overview GeoTIFF to save space
    try:
        if overview_tif.is_file():
            overview_tif.unlink()
    except OSError:
        pass

    emit_progress(request_id, percent=100, stage="done", message="COG ready")
    return {
        "path": str(path.resolve()),
        "outputPath": str(output.resolve()),
        "byteSize": output.stat().st_size,
        "format": "cog",
        "engine": "gdal",
        "bbox": bbox,
        "overviewPath": str(overview_png.resolve()) if overview_png.is_file() else None,
        "overviewPngBase64": png_b64,
        "overviewCoordinates": coordinates,
    }
