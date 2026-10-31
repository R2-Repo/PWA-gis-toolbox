/**
 * Vitest setup — fail tests on any non-localhost network I/O.
 */
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';

const LOCAL_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]'
]);

function isLocalUrl(urlString) {
    try {
        const u = new URL(urlString);
        if (u.protocol === 'file:') return true;
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
        return LOCAL_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
}

function failNetwork(method, url) {
    throw new Error(
        `[network-block] ${method} to non-localhost URL blocked in tests: ${url}`
    );
}

const originalFetch = globalThis.fetch;
if (typeof originalFetch === 'function') {
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input?.url;
        if (url && !isLocalUrl(url)) {
            failNetwork('fetch', url);
        }
        return originalFetch(input, init);
    };
}

class BlockedXMLHttpRequest extends EventEmitter {
    open(method, url) {
        this._method = method;
        this._url = url;
    }

    send() {
        if (this._url && !isLocalUrl(this._url)) {
            failNetwork(`XMLHttpRequest.${this._method || 'GET'}`, this._url);
        }
    }

    setRequestHeader() {}

    abort() {}

    get readyState() {
        return 0;
    }
}

globalThis.XMLHttpRequest = BlockedXMLHttpRequest;

function wrapRequest(originalRequest) {
    return function request(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.href;
        if (url && !isLocalUrl(url)) {
            failNetwork('http.request', url);
        }
        return originalRequest.apply(this, args);
    };
}

http.request = wrapRequest(http.request);
http.get = wrapRequest(http.get);
https.request = wrapRequest(https.request);
https.get = wrapRequest(https.get);
