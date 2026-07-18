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

- `health`
- `echo`
- `summarize_geojson` — `{ "path": "<file>" }`
