# Holdout fixtures (local only)

Large or sensitive fixtures for Phase 1b+ live here. This directory is gitignored except for this README.

## Manifest format

Use the same schema as `tests/fixtures/e2e/tune/manifest.json`:

```json
{
  "version": 1,
  "fixtures": [
    {
      "id": "unique-id",
      "file": "relative-filename-under-holdout/",
      "format": "geojson",
      "tier": "H1",
      "tag": "@holdout",
      "expectedOutcome": "success",
      "featureCount": 1000,
      "bbox": [-112, 39, -110, 41],
      "geometryTypes": ["Point"],
      "fields": { "id": "number", "name": "string" },
      "crs": "EPSG:4326",
      "crsPick": null,
      "roundTrip": false,
      "notes": "optional"
    }
  ]
}
```

Run holdout imports with `npm run test:gis -- --holdout` when `manifest.json` and files are present.
