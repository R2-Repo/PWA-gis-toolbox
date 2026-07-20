/**
 * Atlas import inbox helpers (desktop via DatabaseService inbox methods).
 */
import { getPlatformBundle } from '../../platform/create-platform.js';
import { detectInboxPair } from './detect-inbox-files.js';

function atlasDb() {
    return getPlatformBundle().services?.atlasDb || null;
}

/**
 * Ensure inbox folder exists; return path.
 * @returns {Promise<string>}
 */
export async function ensureAtlasImportInbox() {
    const db = atlasDb();
    if (!db?.ensureImportInbox) {
        throw new Error('Atlas import inbox requires the Windows desktop app');
    }
    const res = await db.ensureImportInbox();
    return res.path;
}

/**
 * Open the Atlas import folder in Explorer.
 */
export async function openAtlasImportInbox() {
    const db = atlasDb();
    if (!db?.openImportInbox) {
        throw new Error('Open import folder requires the Windows desktop app');
    }
    await db.openImportInbox();
}

/**
 * List importable files in the inbox.
 * @returns {Promise<{ path: string, files: object[] }>}
 */
export async function listAtlasImportInbox() {
    const db = atlasDb();
    if (!db?.listImportInbox) {
        throw new Error('List import inbox requires the Windows desktop app');
    }
    return db.listImportInbox();
}

/**
 * Scan inbox and return detected workbook + ATMS pair.
 */
export async function scanAtlasImportInbox() {
    const listed = await listAtlasImportInbox();
    const pair = detectInboxPair(listed.files || []);
    return {
        inboxPath: listed.path,
        files: listed.files || [],
        workbook: pair.workbook,
        atms: pair.atms
    };
}

/**
 * Read inbox/native path into { name, buffer } or { name, text }.
 * @param {string} path
 * @param {'workbook'|'atms'} kind
 */
export async function readAtlasImportPath(path, kind) {
    const db = atlasDb();
    if (!db?.readImportFile) {
        throw new Error('Read import file requires the Windows desktop app');
    }
    const res = await db.readImportFile(path);
    const binary = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    if (kind === 'workbook') {
        return { name: res.name, buffer: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) };
    }
    const text = new TextDecoder('utf-8').decode(binary);
    return { name: res.name, text };
}
