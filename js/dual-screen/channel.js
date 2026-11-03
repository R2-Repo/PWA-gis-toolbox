/**
 * Dual Screen Mode — BroadcastChannel transport
 */
import { CHANNEL_NAME, classifyIncoming } from './protocol.js';

export class DualScreenChannel {
    /**
     * @param {'primary'|'secondary'} role
     * @param {(msg: object) => void} onMessage
     * @param {{ sessionId?: string | null, onProtocolMismatch?: (data: unknown) => void }} [options]
     */
    constructor(role, onMessage, options = {}) {
        this.role = role;
        this._onMessage = onMessage;
        this._sessionId = options.sessionId || null;
        this._onProtocolMismatch = options.onProtocolMismatch || null;
        this._bc = typeof BroadcastChannel !== 'undefined'
            ? new BroadcastChannel(CHANNEL_NAME)
            : null;
        this._closed = false;
        if (this._bc) {
            this._bc.onmessage = (ev) => {
                const result = classifyIncoming(ev.data, this._sessionId);
                if (result.status === 'version') {
                    try { this._onProtocolMismatch?.(ev.data); } catch (err) {
                        console.warn('[DualScreen] version notice failed', err);
                    }
                    return;
                }
                if (result.status !== 'ok') return;
                this._onMessage(result.message);
            };
        }
    }

    get supported() {
        return !!this._bc;
    }

    post(message) {
        if (this._closed || !this._bc) return;
        try {
            this._bc.postMessage(message);
        } catch (err) {
            console.warn('[DualScreen] post failed', err);
        }
    }

    close() {
        this._closed = true;
        if (this._bc) {
            this._bc.close();
            this._bc = null;
        }
    }
}
