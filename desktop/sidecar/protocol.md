# Sidecar protocol (v1)

Transport: **stdin / stdout**, one JSON object per line.

## Request

```json
{"id":"job-1","op":"summarize_geojson","input":{"path":"C:\\data\\layer.geojson"}}
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Correlates progress/result lines |
| `op` | yes | Allow-listed operation name |
| `input` | yes | Object; schemas are per-operation |

## Messages from sidecar

Progress:

```json
{"id":"job-1","type":"progress","percent":40,"stage":"read","message":"Reading GeoJSON"}
```

Log:

```json
{"id":"job-1","type":"log","message":"Reading layer.geojson"}
```

Success:

```json
{"id":"job-1","type":"result","ok":true,"output":{}}
```

Failure:

```json
{"id":"job-1","type":"result","ok":false,"message":"...","details":{}}
```

## Allow-listed operations

- `health` — includes `engines` (`duckdb`, `pyogrio`, `shapely`), `localGdal`, `duckdb` flags
- `echo`
- `summarize_geojson` — `{ "path": "<file>" }`
- `inspect_vector` — `{ "path": "<file>" }` — GeoJSON stdlib; GPKG/SHP/Parquet via pyogrio when installed
- `sample_vector` — `{ "path": "<file>", "maxFeatures"?: number }` — capped FeatureCollection preview
- `file_checksum` — `{ "path": "<file>" }` — SHA-256
- `convert_to_geoparquet` — `{ "path": "<file>", "outputPath"?: "<dest.parquet>" }` — requires duckdb or pyogrio
- `summarize_vector` — `{ "path": "<file>" }` — DuckDB/pyogrio when available
- `generate_pmtiles` — `{ "path": "<file>", "outputPath"?: "<dest.pmtiles>", "minZoom"?: 0, "maxZoom"?: 12 }` — tippecanoe or Python MVT writer

## Optional engines

Install from `desktop/sidecar/python/requirements.txt`:

```bash
pip install -r desktop/sidecar/python/requirements.txt
```
