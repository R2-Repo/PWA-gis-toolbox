/**
 * PDF page thumbnails and selected-page rasterization (pdf.js).
 */

import { WORKING_MAX_EDGE, buildSourceFingerprint } from './engine.js';
import { disposeSource } from './source-loader.js';

const THUMB_MAX_EDGE = 180;
const PAGE_MAX_EDGE = Math.min(WORKING_MAX_EDGE, 2048);

let pdfjsPromise = null;

async function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
            const pdfjs = await import('pdfjs-dist');
            const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
            pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
            return pdfjs;
        })();
    }
    return pdfjsPromise;
}

function revokeUrl(url) {
    if (url && String(url).startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* ignore */
        }
    }
}

async function renderPageToBlob(page, maxEdge, mime = 'image/png') {
    const base = page.getViewport({ scale: 1 });
    const scale = maxEdge / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale: Math.min(scale, 4) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not render this PDF page.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => {
            if (!value) reject(new Error('Could not rasterize this PDF page.'));
            else resolve(value);
        }, mime);
    });
    return { blob, width: canvas.width, height: canvas.height };
}

function explainPdfError(err) {
    const name = err?.name || '';
    const message = err?.message || '';
    if (name === 'PasswordException' || /password/i.test(message)) {
        return 'This PDF is password protected and cannot be opened.';
    }
    if (/Invalid PDF/i.test(message) || name === 'InvalidPDFException') {
        return 'This PDF is damaged or not a valid PDF.';
    }
    return message || 'This PDF could not be opened.';
}

/**
 * @param {File} file
 * @param {{ maxPages?: number }} [options]
 */
export async function openPdfSource(file, options = {}) {
    if (!file) throw new Error('Choose a PDF to georeference.');
    const pdfjs = await loadPdfjs();
    const maxPages = options.maxPages ?? 80;
    const data = new Uint8Array(await file.arrayBuffer());
    let pdf;
    try {
        pdf = await pdfjs.getDocument({ data, disableAutoFetch: true, disableStream: false }).promise;
    } catch (err) {
        throw new Error(explainPdfError(err));
    }

    const pageCount = pdf.numPages;
    const limit = Math.min(pageCount, maxPages);
    const thumbnails = [];
    for (let i = 1; i <= limit; i++) {
        const page = await pdf.getPage(i);
        const rendered = await renderPageToBlob(page, THUMB_MAX_EDGE, 'image/jpeg');
        thumbnails.push({
            pageIndex: i - 1,
            url: URL.createObjectURL(rendered.blob),
            width: rendered.width,
            height: rendered.height
        });
    }

    return {
        kind: 'pdf',
        name: file.name || 'document.pdf',
        mime: 'application/pdf',
        file,
        pdf,
        pageCount,
        thumbnails,
        fingerprintBase: `${file.name}|${file.size}|${file.lastModified}`,
        dispose() {
            for (const thumb of thumbnails) revokeUrl(thumb.url);
            try {
                pdf.cleanup?.();
                pdf.destroy?.();
            } catch {
                /* ignore */
            }
        }
    };
}

/**
 * @param {object} pdfSource
 * @param {number} pageIndex
 * @param {{ maxEdge?: number }} [options]
 */
export async function rasterizePdfPage(pdfSource, pageIndex, options = {}) {
    if (!pdfSource?.pdf) throw new Error('PDF is not loaded.');
    const index = Number(pageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= pdfSource.pageCount) {
        throw new Error('Choose a valid PDF page.');
    }
    const page = await pdfSource.pdf.getPage(index + 1);
    const rendered = await renderPageToBlob(page, options.maxEdge ?? PAGE_MAX_EDGE, 'image/png');
    const workingUrl = URL.createObjectURL(rendered.blob);
    return {
        kind: 'pdf-page',
        name: pdfSource.name,
        mime: 'image/png',
        file: pdfSource.file,
        width: rendered.width,
        height: rendered.height,
        workingWidth: rendered.width,
        workingHeight: rendered.height,
        workingUrl,
        workingBlob: rendered.blob,
        originalUrl: workingUrl,
        pageIndex: index,
        pageCount: pdfSource.pageCount,
        thumbnails: pdfSource.thumbnails,
        fingerprint: buildSourceFingerprint(pdfSource.file, rendered.width, rendered.height, index),
        dispose() {
            revokeUrl(workingUrl);
        }
    };
}

export function disposePdfSource(source) {
    disposeSource(source);
}

export default {
    openPdfSource,
    rasterizePdfPage,
    disposePdfSource
};
