# GIS Toolbox Python sidecar

Narrow, allow-listed operations for the private Windows desktop shell.

## Design rules

- No arbitrary `runPythonScript` / shell execution from the frontend
- Operations are typed and versioned (`health`, `echo`, `summarize_geojson`, `inspect_vector`, `sample_vector`)
- Large datasets pass as **file paths**, not giant JSON over IPC
- Stdlib only for v0.1 (no GDAL/PDAL/DuckDB yet) — GeoJSON path inspect/sample for desktop large-file preview

## Dev usage

From the repo root (or with `PYTHONPATH` set):

```bash
cd desktop/sidecar/python
printf '%s\n' '{"id":"1","op":"health","input":{}}' | python -m gis_sidecar
```

Summarize a GeoJSON file:

```bash
printf '%s\n' '{"id":"2","op":"summarize_geojson","input":{"path":"/path/to/file.geojson"}}' | python -m gis_sidecar
```

## Packaging (Windows)

Later CI / local packaging can freeze this module with PyInstaller into
`src-tauri/binaries/gis-sidecar-x86_64-pc-windows-msvc.exe` and declare it as a
Tauri `externalBin`. Until then, the Rust host falls back to:

`python -m gis_sidecar` with `PYTHONPATH=desktop/sidecar/python`.

## Protocol

Newline-delimited JSON on stdin/stdout. See `gis_sidecar/protocol.py`.
