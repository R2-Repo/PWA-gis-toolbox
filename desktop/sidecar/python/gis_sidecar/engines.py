"""Optional GIS engine probes (DuckDB, pyogrio/GDAL bindings, shapely)."""

from __future__ import annotations

from typing import Any, Dict


def _probe_duckdb() -> Dict[str, Any]:
    try:
        import duckdb  # type: ignore

        version = getattr(duckdb, "__version__", None) or "unknown"
        # Spatial extension is loaded on demand in ops; probe import only.
        return {"available": True, "version": str(version)}
    except Exception as exc:  # noqa: BLE001 — report any import/runtime failure
        return {"available": False, "reason": str(exc)}


def _probe_pyogrio() -> Dict[str, Any]:
    try:
        import pyogrio  # type: ignore

        version = getattr(pyogrio, "__version__", None) or "unknown"
        return {"available": True, "version": str(version)}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": str(exc)}


def _probe_shapely() -> Dict[str, Any]:
    try:
        import shapely  # type: ignore

        version = getattr(shapely, "__version__", None) or "unknown"
        return {"available": True, "version": str(version)}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": str(exc)}


def probe_engines() -> Dict[str, Any]:
    return {
        "duckdb": _probe_duckdb(),
        "pyogrio": _probe_pyogrio(),
        "shapely": _probe_shapely(),
    }


def duckdb_available() -> bool:
    return bool(_probe_duckdb().get("available"))


def pyogrio_available() -> bool:
    return bool(_probe_pyogrio().get("available"))
