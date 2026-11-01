#!/usr/bin/env node
/**
 * Local ArcGIS REST mock for Playwright e2e (localhost only).
 */
import http from 'node:http';
import {
    getLayerDef,
    handleLayerQuery,
    layerMetadataJson,
    parseLayerKeyFromPathname,
    parseServiceKeyFromPathname,
    serviceMetadataJson
} from './arcgis-mock-layers.js';

const PORT = Number(process.env.ARCGIS_MOCK_PORT || 18765);
const HOST = process.env.ARCGIS_MOCK_HOST || '127.0.0.1';

/** @type {{ url: string, method: string, at: number }[]} */
let requestLog = [];

function resetLog() {
    requestLog = [];
}

function logRequest(method, url) {
    requestLog.push({ method, url, at: Date.now() });
}

function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(text);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRequest(req, res) {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    logRequest(req.method || 'GET', url.pathname + url.search);

    if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }

    if (url.pathname === '/mock/reset' && req.method === 'POST') {
        resetLog();
        res.writeHead(204);
        res.end();
        return;
    }

    if (url.pathname === '/mock/requests' && req.method === 'GET') {
        sendJson(res, 200, { requests: requestLog });
        return;
    }

    if (url.pathname.endsWith('/query')) {
        const layerPath = url.pathname.replace(/\/query\/?$/, '');
        const layerKey = parseLayerKeyFromPathname(layerPath);
        if (!layerKey) {
            sendJson(res, 404, { error: { code: 404, message: 'Not found' } });
            return;
        }
        const def = getLayerDef(layerKey);
        if (def?.behavior === 'slow-query') {
            await sleep(8_000);
        }
        const result = handleLayerQuery(layerKey, url.searchParams);
        if (result.malformed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{ not valid json');
            return;
        }
        sendJson(res, result.status, result.body);
        return;
    }

    const layerKey = parseLayerKeyFromPathname(url.pathname);
    if (layerKey && url.searchParams.get('f') === 'json') {
        const meta = layerMetadataJson(layerKey);
        if (meta?.error === 'http500') {
            sendJson(res, 500, { error: { code: 500, message: 'Server error' } });
            return;
        }
        if (meta?.error && typeof meta.error === 'object') {
            sendJson(res, 200, { error: meta.error });
            return;
        }
        if (!meta) {
            sendJson(res, 404, { error: { code: 404, message: 'Layer not found' } });
            return;
        }
        sendJson(res, 200, meta);
        return;
    }

    const serviceKey = parseServiceKeyFromPathname(url.pathname);
    if (serviceKey && url.searchParams.get('f') === 'json') {
        sendJson(res, 200, serviceMetadataJson(serviceKey));
        return;
    }

    sendJson(res, 404, { error: { code: 404, message: 'Not found' } });
}

const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
        console.error('[arcgis-mock]', err);
        sendJson(res, 500, { error: { code: 500, message: String(err.message) } });
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[arcgis-mock] listening on http://${HOST}:${PORT}`);
});
