/**
 * KML exporter — with optional styling and folder grouping
 */
import { isSmartStyleActive } from '../map/style-engine.js';
import { resolvePlacemarkLabel } from '../map/map-labels.js';
import { bakeFeatureKmlStyle, styleHash } from './style-baker.js';
import {
    isKmlMilepostLayer,
    resolveMilepostPlacemarkName,
    getMilepostIconHref,
    MILEPOST_ICON_COLOR,
    MILEPOST_ICON_SCALE,
    MILEPOST_LABEL_SCALE
} from './kml-milepost-style.js';

/** Default KML label text color for icon-hidden (text-only) point layers. */
const LABEL_ONLY_TEXT_COLOR = '#ffffff';

export async function exportKML(dataset, options = {}, task) {
    const features = dataset.geojson?.features || [];
    task?.updateProgress(30, 'Generating KML...');

    const style = options.style || null;
    const exportOptions = options;

    if (style && isSmartStyleActive(style)) {
        return _exportKmlWithBakedStyles(dataset, features, style, task, exportOptions);
    }
    const sourceGroups = _groupBySource(features);
    const hasSourceFolders = sourceGroups && Object.keys(sourceGroups).length > 1;
    const useGeomFolders = !hasSourceFolders && options.folders !== false && _hasMultipleGeomTypes(features);
    const labelOnlyLayer = _layerUsesLabelOnlyPoints(style, dataset, features);
    const milepostLayer = isKmlMilepostLayer(dataset, style, features);
    const defaultStyleId = labelOnlyLayer && !style
        ? 'style_label_only'
        : milepostLayer && !style
            ? 'style_milepost'
            : 'style_default';

    // Build style elements
    let styleBlock = '';
    if (style) {
        styleBlock = _buildKmlStyles(style, useGeomFolders, dataset, features, exportOptions);
    } else if (labelOnlyLayer) {
        styleBlock = _kmlStyleEl('style_label_only', {}, 'hidden', exportOptions);
    } else if (milepostLayer) {
        styleBlock = _kmlStyleEl('style_milepost', { fillColor: MILEPOST_ICON_COLOR }, 'milepost', exportOptions);
    }

    let placemarkXml;
    if (hasSourceFolders) {
        const folderParts = [];
        const styleUrl = style || labelOnlyLayer || milepostLayer ? `#${defaultStyleId}` : '';
        if (style && !useGeomFolders) {
            styleBlock = _kmlStyleEl(
                'style_default',
                _applyKmlLabelColor(style, style),
                _layerIconMode(style, dataset, features),
                exportOptions
            );
        }
        for (const [srcName, feats] of Object.entries(sourceGroups)) {
            const marks = feats.map((f, i) => _buildPlacemark(f, i, styleUrl, dataset, style)).filter(Boolean).join('\n');
            folderParts.push(`    <Folder>\n      <name>${escapeXml(srcName)}</name>\n${marks}\n    </Folder>`);
        }
        placemarkXml = folderParts.join('\n');
    } else if (useGeomFolders) {
        const groups = _groupByGeomType(features);
        const folderParts = [];
        for (const [gtype, feats] of Object.entries(groups)) {
            if (feats.length === 0) continue;
            const label = { point: 'Points', line: 'Lines', polygon: 'Polygons' }[gtype] || gtype;
            const styleUrl = style ? `#style_${gtype}` : '';
            const marks = feats.map((f, i) => _buildPlacemark(f, i, styleUrl, dataset, style)).filter(Boolean).join('\n');
            folderParts.push(`    <Folder>\n      <name>${escapeXml(label)}</name>\n${marks}\n    </Folder>`);
        }
        placemarkXml = folderParts.join('\n');
    } else {
        const styleUrl = style || labelOnlyLayer || milepostLayer ? `#${defaultStyleId}` : '';
        if (style && !useGeomFolders) {
            styleBlock = _kmlStyleEl(
                'style_default',
                _applyKmlLabelColor(style, style),
                _layerIconMode(style, dataset, features),
                exportOptions
            );
        }
        placemarkXml = features.map((f, i) => _buildPlacemark(f, i, styleUrl, dataset, style)).filter(Boolean).join('\n');
    }

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(dataset.name || 'Export')}</name>
${styleBlock}${placemarkXml}
  </Document>
</kml>`;

    task?.updateProgress(90, 'Done');
    return { text: kml, mimeType: 'application/vnd.google-earth.kml+xml' };
}

function _exportKmlWithBakedStyles(dataset, features, style, task, exportOptions = {}) {
    const hashToId = new Map();
    const styleEls = [];
    const labelOnlyLayer = _layerUsesLabelOnlyPoints(style, dataset, features);
    const milepostLayer = isKmlMilepostLayer(dataset, style, features);

    const styleUrlFor = (f) => {
        const baked = bakeFeatureKmlStyle(f, style);
        if (!baked) return '';
        const h = styleHash(baked);
        if (!hashToId.has(h)) {
            const id = `style_baked_${hashToId.size}`;
            hashToId.set(h, id);
            let iconMode = 'none';
            if (_primaryGeomGroup(f.geometry) === 'point') {
                if (labelOnlyLayer) iconMode = 'hidden';
                else if (milepostLayer) iconMode = 'milepost';
                else iconMode = 'icon';
            }
            styleEls.push(_kmlStyleEl(id, _applyKmlLabelColor(baked, style), iconMode, exportOptions));
        }
        return `#${hashToId.get(h)}`;
    };

    const placemarkXml = features
        .map((f, i) => _buildPlacemark(f, i, styleUrlFor(f), dataset, style))
        .filter(Boolean)
        .join('\n');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(dataset.name || 'Export')}</name>
${styleEls.join('\n')}${placemarkXml}
  </Document>
</kml>`;

    task?.updateProgress(90, 'Done');
    return { text: kml, mimeType: 'application/vnd.google-earth.kml+xml' };
}

function _buildPlacemark(f, idx, styleUrl, dataset, style = null) {
    const fallback = resolvePlacemarkLabel(f, idx, style);
    const name = isKmlMilepostLayer(dataset, style, [f])
        ? (resolveMilepostPlacemarkName(f, dataset) || fallback)
        : fallback;
    const desc = buildDescription(f.properties);
    const geomKml = geometryToKML(f.geometry);
    if (!geomKml) return '';
    const styleRef = styleUrl ? `\n      <styleUrl>${styleUrl}</styleUrl>` : '';
    return `    <Placemark>
      <name>${escapeXml(String(name))}</name>
      <description><![CDATA[${desc}]]></description>${styleRef}
      ${geomKml}
    </Placemark>`;
}

function _geometryCategories(geom) {
    const s = new Set();
    if (!geom) return s;
    if (geom.type === 'GeometryCollection') {
        for (const g of geom.geometries || []) {
            for (const c of _geometryCategories(g)) s.add(c);
        }
        return s;
    }
    if (geom.type === 'Point' || geom.type === 'MultiPoint') s.add('point');
    else if (geom.type === 'LineString' || geom.type === 'MultiLineString') s.add('line');
    else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') s.add('polygon');
    return s;
}

function _primaryGeomGroup(geom) {
    const cats = _geometryCategories(geom);
    if (cats.has('point')) return 'point';
    if (cats.has('line')) return 'line';
    if (cats.has('polygon')) return 'polygon';
    return 'polygon';
}

function _hasMultipleGeomTypes(features) {
    const cats = new Set();
    for (const f of features) {
        for (const c of _geometryCategories(f.geometry)) cats.add(c);
        if (cats.size > 1) return true;
    }
    return false;
}

function _groupByGeomType(features) {
    const groups = { point: [], line: [], polygon: [] };
    for (const f of features) {
        const g = _primaryGeomGroup(f.geometry);
        groups[g].push(f);
    }
    return groups;
}

/**
 * Group features by source_file property (set by merge).
 * Returns null if no source_file is present.
 */
function _groupBySource(features) {
    const groups = {};
    let hasSource = false;
    for (const f of features) {
        const src = f.properties?.source_file;
        if (!src) continue;
        hasSource = true;
        if (!groups[src]) groups[src] = [];
        groups[src].push(f);
    }
    return hasSource ? groups : null;
}

/**
 * Convert app style to KML <Style> elements.
 * KML colors are AABBGGRR format (alpha, blue, green, red).
 */
function _applyKmlLabelColor(s, layerStyle) {
    if (layerStyle?.labels?.enabled && layerStyle.labels.color) {
        return { ...s, labelColor: layerStyle.labels.color };
    }
    return s;
}

function _buildKmlStyles(style, useFolders, dataset, features, exportOptions = {}) {
    if (useFolders) {
        const ps = _applyKmlLabelColor({ ...style, ...(style.point || {}) }, style);
        const ls = _applyKmlLabelColor({ ...style, ...(style.line || {}) }, style);
        const gs = _applyKmlLabelColor({ ...style, ...(style.polygon || {}) }, style);
        const pointIconMode = _layerIconMode(ps, dataset, features);
        return [
            _kmlStyleEl('style_point', ps, pointIconMode, exportOptions),
            _kmlStyleEl('style_line', ls, 'none', exportOptions),
            _kmlStyleEl('style_polygon', gs, 'none', exportOptions)
        ].join('\n');
    }
    return _kmlStyleEl(
        'style_default',
        _applyKmlLabelColor(style, style),
        _layerIconMode(style, dataset, features),
        exportOptions
    );
}

function _isKmlLabelOnlyLayer(style, dataset) {
    if (dataset?._kmlExport?.labelOnly) return true;
    if (style?.kmlLabelOnly) return true;
    const pointSize = style?.pointSize ?? style?.point?.pointSize;
    const fillOpacity = style?.fillOpacity ?? style?.point?.fillOpacity;
    if (pointSize === 0 && fillOpacity === 0) return true;
    if (dataset?._mapLabels?.field && pointSize === 0) return true;
    return false;
}

function _kmlIconMode(style, dataset, featureOrGeom, features) {
    const geometry = featureOrGeom?.geometry ?? featureOrGeom;
    if (featureOrGeom?.properties?._annotationType === 'text') return 'hidden';
    if (_primaryGeomGroup(geometry) !== 'point') return 'none';
    if (_isKmlLabelOnlyLayer(style, dataset)) return 'hidden';
    if (isKmlMilepostLayer(dataset, style, features)) return 'milepost';
    return 'icon';
}

function _layerIconMode(style, dataset, features) {
    if (_layerUsesLabelOnlyPoints(style, dataset, features)) return 'hidden';
    if (isKmlMilepostLayer(dataset, style, features)) return 'milepost';
    return 'icon';
}

function _layerUsesLabelOnlyPoints(style, dataset, features) {
    if (_isKmlLabelOnlyLayer(style, dataset)) return true;
    return (features || []).every((f) => _kmlIconMode(style, dataset, f, features) === 'hidden');
}

function _kmlStyleEl(id, s, iconMode = 'none', exportOptions = {}) {
    const sc = _hexToKmlColor(s.strokeColor || '#2563eb', s.strokeOpacity ?? 0.8);
    const fc = _hexToKmlColor(s.fillColor || s.strokeColor || '#2563eb', s.fillOpacity ?? 0.3);
    const sw = s.strokeWidth ?? 2;

    let xml = `    <Style id="${id}">\n`;
    xml += `      <LineStyle><color>${sc}</color><width>${sw}</width></LineStyle>\n`;
    xml += `      <PolyStyle><color>${fc}</color></PolyStyle>\n`;
    if (iconMode === 'icon') {
        const ic = _hexToKmlColor(s.fillColor || s.strokeColor || '#2563eb', Math.min(1, (s.fillOpacity ?? 0.3) + 0.3));
        const scale = ((s.pointSize || 6) / 6).toFixed(1);
        xml += `      <IconStyle><color>${ic}</color><scale>${scale}</scale></IconStyle>\n`;
        if (s.labelColor) {
            const lc = _hexToKmlColor(s.labelColor, 1);
            xml += `      <LabelStyle><scale>1</scale><color>${lc}</color></LabelStyle>\n`;
        }
    } else if (iconMode === 'milepost') {
        const ic = _hexToKmlColor(s.fillColor || s.strokeColor || MILEPOST_ICON_COLOR, 1);
        const href = getMilepostIconHref(exportOptions.forKmzArchive === true);
        xml += `      <IconStyle><color>${ic}</color><scale>${MILEPOST_ICON_SCALE}</scale><Icon><href>${escapeXml(href)}</href></Icon></IconStyle>\n`;
        const lc = _hexToKmlColor(s.labelColor || '#1a1a1a', 1);
        xml += `      <LabelStyle><scale>${MILEPOST_LABEL_SCALE}</scale><color>${lc}</color></LabelStyle>\n`;
    } else if (iconMode === 'hidden') {
        xml += `      <IconStyle><scale>0</scale></IconStyle>\n`;
        const lc = _hexToKmlColor(s.labelColor || LABEL_ONLY_TEXT_COLOR, 1);
        xml += `      <LabelStyle><scale>1</scale><color>${lc}</color></LabelStyle>\n`;
    }
    xml += `    </Style>\n`;
    return xml;
}

/**
 * Convert hex color (#RRGGBB) + opacity (0-1) to KML AABBGGRR format
 */
function _hexToKmlColor(hex, opacity) {
    let h = String(hex || '#2563eb').replace('#', '').trim();
    if (h.length === 3 && /^[0-9a-fA-F]{3}$/.test(h)) {
        h = h.split('').map(c => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) {
        h = '2563eb';
    }
    const r = h.substring(0, 2);
    const g = h.substring(2, 4);
    const b = h.substring(4, 6);
    const a = Math.round((opacity ?? 1) * 255).toString(16).padStart(2, '0');
    return `${a}${b}${g}${r}`.toLowerCase();
}

function _formatDescriptionValue(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
        if (v._att) return v.name || 'attachment';
        try {
            return JSON.stringify(v);
        } catch {
            return '(object)';
        }
    }
    return String(v);
}

function buildDescription(props) {
    if (!props) return '';
    let imgHtml = '';
    if (props._thumbnailDataUrl) {
        imgHtml = `<img src="${props._thumbnailDataUrl}" style="max-width:400px;max-height:400px;" /><br/>`;
    }
    const rows = Object.entries(props)
        .filter(([k, v]) => v != null && v !== '' && !k.startsWith('_'))
        .map(([k, v]) => {
            if (v && typeof v === 'object' && v._att) {
                const isImage = v.type?.startsWith('image/');
                if (isImage && v.dataUrl) {
                    return `<tr><td><b>${escapeXml(k)}</b></td><td><img src="${v.dataUrl}" style="max-width:300px;max-height:200px;" /><br/>${escapeXml(v.name || 'attachment')}</td></tr>`;
                }
                return `<tr><td><b>${escapeXml(k)}</b></td><td>📎 ${escapeXml(v.name || 'attachment')}</td></tr>`;
            }
            return `<tr><td><b>${escapeXml(k)}</b></td><td>${escapeXml(_formatDescriptionValue(v))}</td></tr>`;
        })
        .join('');
    return `${imgHtml}<table>${rows}</table>`;
}

function geometryToKML(geom) {
    if (!geom) return '';
    switch (geom.type) {
        case 'Point':
            return `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},${geom.coordinates[2] || 0}</coordinates></Point>`;
        case 'MultiPoint':
            return `<MultiGeometry>${geom.coordinates.map(c =>
                `<Point><coordinates>${c[0]},${c[1]},${c[2] || 0}</coordinates></Point>`
            ).join('')}</MultiGeometry>`;
        case 'LineString':
            return `<LineString><coordinates>${geom.coordinates.map(c => `${c[0]},${c[1]},${c[2] || 0}`).join(' ')}</coordinates></LineString>`;
        case 'MultiLineString':
            return `<MultiGeometry>${geom.coordinates.map(line =>
                `<LineString><coordinates>${line.map(c => `${c[0]},${c[1]},${c[2] || 0}`).join(' ')}</coordinates></LineString>`
            ).join('')}</MultiGeometry>`;
        case 'Polygon':
            return `<Polygon>${geom.coordinates.map((ring, i) =>
                `<${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}><LinearRing><coordinates>${ring.map(c => `${c[0]},${c[1]},${c[2] || 0}`).join(' ')}</coordinates></LinearRing></${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}>`
            ).join('')}</Polygon>`;
        case 'MultiPolygon':
            return `<MultiGeometry>${geom.coordinates.map(poly =>
                `<Polygon>${poly.map((ring, i) =>
                    `<${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}><LinearRing><coordinates>${ring.map(c => `${c[0]},${c[1]},${c[2] || 0}`).join(' ')}</coordinates></LinearRing></${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}>`
                ).join('')}</Polygon>`
            ).join('')}</MultiGeometry>`;
        case 'GeometryCollection': {
            const parts = (geom.geometries || []).map(g => geometryToKML(g)).filter(Boolean);
            if (parts.length === 0) return '';
            if (parts.length === 1) return parts[0];
            return `<MultiGeometry>${parts.join('')}</MultiGeometry>`;
        }
        default:
            return '';
    }
}

function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Multi-layer KML export — each layer becomes its own <Folder> with its own <Style>.
 * @param {Array<{dataset, style}>} layers - array of { dataset, style } objects
 */
export async function exportMultiLayerKML(layers, options = {}, task) {
    task?.updateProgress(20, 'Generating multi-layer KML...');

    const docName = options.filename || 'Multi-Layer Export';
    let styleBlock = '';
    const folderParts = [];

    layers.forEach(({ dataset, style }, idx) => {
        const features = dataset.geojson?.features || [];
        const folderName = dataset.name || `Layer ${idx + 1}`;
        const labelOnlyLayer = _layerUsesLabelOnlyPoints(style, dataset, features);
        const milepostLayer = isKmlMilepostLayer(dataset, style, features);

        if (style && isSmartStyleActive(style)) {
            const hashToId = new Map();
            const layerStyleEls = [];
            const styleUrlFor = (f) => {
                const baked = bakeFeatureKmlStyle(f, style);
                if (!baked) return '';
                const h = styleHash(baked);
                if (!hashToId.has(h)) {
                    const id = `style_layer_${idx}_baked_${hashToId.size}`;
                    hashToId.set(h, id);
                    let iconMode = 'none';
                    if (_primaryGeomGroup(f.geometry) === 'point') {
                        if (labelOnlyLayer) iconMode = 'hidden';
                        else if (milepostLayer) iconMode = 'milepost';
                        else iconMode = 'icon';
                    }
                    layerStyleEls.push(_kmlStyleEl(id, _applyKmlLabelColor(baked, style), iconMode, options));
                }
                return `#${hashToId.get(h)}`;
            };
            styleBlock += layerStyleEls.join('\n');
            const marks = features.map((f, i) => _buildPlacemark(f, i, styleUrlFor(f), dataset, style)).filter(Boolean).join('\n');
            folderParts.push(`    <Folder>\n      <name>${escapeXml(folderName)}</name>\n${marks}\n    </Folder>`);
            return;
        }

        const styleId = `style_layer_${idx}`;
        if (style) {
            styleBlock += _kmlStyleEl(
                styleId,
                _applyKmlLabelColor(style || {}, style),
                _layerIconMode(style, dataset, features),
                options
            );
        } else if (labelOnlyLayer) {
            styleBlock += _kmlStyleEl(styleId, {}, 'hidden', options);
        } else if (milepostLayer) {
            styleBlock += _kmlStyleEl(styleId, {}, 'milepost', options);
        }
        const styleUrl = (style || labelOnlyLayer || milepostLayer) ? `#${styleId}` : '';
        const marks = features.map((f, i) => _buildPlacemark(f, i, styleUrl, dataset, style)).filter(Boolean).join('\n');
        folderParts.push(`    <Folder>\n      <name>${escapeXml(folderName)}</name>\n${marks}\n    </Folder>`);
    });

    let foldersBody = folderParts.join('\n');
    if (options.parentFolder) {
        const nested = folderParts.map((part) => part.replace(/^    /gm, '      ')).join('\n');
        foldersBody = `    <Folder>\n      <name>${escapeXml(options.parentFolder)}</name>\n${nested}\n    </Folder>`;
    }

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(docName)}</name>
${styleBlock}${foldersBody}
  </Document>
</kml>`;

    task?.updateProgress(90, 'Done');
    return { text: kml, mimeType: 'application/vnd.google-earth.kml+xml' };
}

export { geometryToKML, buildDescription, escapeXml };
