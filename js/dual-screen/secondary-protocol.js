/**
 * Popup side of the Dual Screen handshake.
 * Sends hello once, holds every other message until the handshake is ready,
 * then flushes that queue in order. Goodbye goes out immediately (pagehide).
 */
import { MessageType, createMessage } from './protocol.js';
import { isViewportEchoSuppressed } from './viewport-echo.js';

/**
 * @param {object} opts
 * @param {string | null} opts.sessionId
 * @param {(message: object) => void} opts.post
 * @param {(msg: object) => void} opts.onApply
 */
export function createSecondaryProtocol({ sessionId, post, onApply }) {
    let ready = false;
    let flushing = false;
    let helloSent = false;
    let byeSent = false;
    /** @type {object[]} */
    const inbound = [];
    /** @type {object[]} */
    const outbound = [];

    function deliver(message) {
        try {
            post(message);
        } catch (err) {
            console.warn('[DualScreen] popup post failed', err);
        }
    }

    function sendHello() {
        if (helloSent) return false;
        helloSent = true;
        deliver(createMessage('secondary', MessageType.HELLO, {}, sessionId));
        return true;
    }

    function sendGoodbye() {
        if (byeSent) return false;
        byeSent = true;
        deliver(createMessage('secondary', MessageType.BYE, {}, sessionId));
        return true;
    }

    /**
     * @param {string} type
     * @param {object} [payload]
     */
    function enqueueOutbound(type, payload = {}) {
        if (type === MessageType.HELLO) return;
        if (type === MessageType.VIEWPORT && isViewportEchoSuppressed()) return;
        if (type === MessageType.BYE) {
            sendGoodbye();
            return;
        }
        const message = createMessage('secondary', type, payload, sessionId);
        if (!ready || flushing) {
            outbound.push(message);
            return;
        }
        deliver(message);
    }

    function receive(msg) {
        if (!ready || flushing) {
            inbound.push(msg);
            return;
        }
        onApply(msg);
    }

    function flushQueues() {
        while (inbound.length || outbound.length) {
            const inboundBatch = inbound.splice(0, inbound.length);
            for (const msg of inboundBatch) onApply(msg);
            const outboundBatch = outbound.splice(0, outbound.length);
            for (const message of outboundBatch) deliver(message);
        }
    }

    function markHandshakeReady() {
        if (ready) return;
        sendHello();
        ready = true;
        flushing = true;
        try {
            flushQueues();
        } finally {
            flushing = false;
        }
    }

    /** pagehide: tell the main window this popup is gone. */
    function handlePageHide() {
        sendGoodbye();
    }

    return {
        sessionId,
        enqueueOutbound,
        receive,
        markHandshakeReady,
        sendHello,
        sendGoodbye,
        handlePageHide,
        get helloSent() { return helloSent; },
        get ready() { return ready; }
    };
}
