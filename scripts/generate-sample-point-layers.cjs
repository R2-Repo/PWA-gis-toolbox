#!/usr/bin/env node
/**
 * Generate sample GeoJSON point layers for import/perf testing.
 * Usage: node scripts/generate-sample-point-layers.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'samples');

/** Deterministic 0..1 from index + salt */
function rand01(i, salt) {
  let t = ((i + 1) * salt) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function writePoints(filePath, count, name) {
  // Roughly Wasatch Front / Salt Lake Valley
  const lon0 = -112.1;
  const lat0 = 40.4;
  const lonSpan = 0.9;
  const latSpan = 0.7;

  const fd = fs.openSync(filePath, 'w');
  fs.writeSync(fd, `{"type":"FeatureCollection","name":"${name}","features":[`);

  for (let i = 0; i < count; i++) {
    const lon = lon0 + rand01(i, 2654435761) * lonSpan;
    const lat = lat0 + rand01(i, 1597334677) * latSpan;
    const category = (i % 5) + 1;
    const piece =
      (i ? ',' : '') +
      `{"type":"Feature","properties":{"id":${i + 1},"name":"Point ${i + 1}","category":${category}},` +
      `"geometry":{"type":"Point","coordinates":[${lon.toFixed(6)},${lat.toFixed(6)}]}}`;
    fs.writeSync(fd, piece);
    if ((i + 1) % 50000 === 0) {
      process.stdout.write(`  ${name}: ${(i + 1).toLocaleString()}/${count.toLocaleString()}\n`);
    }
  }

  fs.writeSync(fd, ']}');
  fs.closeSync(fd);

  const mb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
  console.log(`Wrote ${filePath} (${count.toLocaleString()} points, ${mb} MB)`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const specs = [
  ['points-12k.geojson', 12000, 'points-12k'],
  ['points-40k.geojson', 40000, 'points-40k'],
  ['points-150k.geojson', 150000, 'points-150k'],
  ['points-250k.geojson', 250000, 'points-250k'],
  ['points-500k.geojson', 500000, 'points-500k'],
];

for (const [file, count, name] of specs) {
  writePoints(path.join(OUT_DIR, file), count, name);
}
