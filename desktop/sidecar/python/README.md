# GIS Toolbox Python sidecar

Narrow, allow-listed operations for the private Windows desktop shell.

## Design rules

- No arbitrary `runPythonScript` / shell execution from the frontend
- Operations are typed and versioned (see `protocol.md`)
- Large datasets pass as **file paths**, not giant JSON over IPC
- Stdlib GeoJSON path works without extras
- Optional engines (Phases 3–4): DuckDB Spatial, pyogrio, shapely, PMTiles writer
- Prefer **tippecanoe** on PATH for large `generate_pmtiles` jobs

## Install GIS engines (desktop)

```bash
cd desktop/sidecar/python
pip install -r requirements.txt
```

`health` reports `engines.duckdb` / `engines.pyogrio` / `engines.tippecanoe` / `engines.pmtilesWriter`. The Tauri handshake maps DuckDB/pyogrio to `duckdb` and `localGdal` capabilities.

## Dev usage

```bash
cd desktop/sidecar/python
printf '%s\n' '{"id":"1","op":"health","input":{}}' | python -m gis_sidecar
```

Convert to GeoParquet:

```bash
printf '%s\n' '{"id":"2","op":"convert_to_geoparquet","input":{"path":"C:/data/layer.geojson","outputPath":"C:/data/layer.parquet"}}' | python -m gis_sidecar
```

Generate PMTiles:

```bash
printf '%s\n' '{"id":"3","op":"generate_pmtiles","input":{"path":"C:/data/layer.geojson","outputPath":"C:/data/layer.pmtiles","maxZoom":12}}' | python -m gis_sidecar
```

## Packaging (Windows)

Later CI / local packaging can freeze this module with PyInstaller into
`src-tauri/binaries/gis-sidecar-x86_64-pc-windows-msvc.exe` and declare it as a
Tauri `externalBin`. Until then, the Rust host falls back to:

`python -m gis_sidecar` with `PYTHONPATH=desktop/sidecar/python`.

## Protocol

Newline-delimited JSON on stdin/stdout. See [`../protocol.md`](../protocol.md).
