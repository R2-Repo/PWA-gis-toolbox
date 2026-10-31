/**
 * @vitest-environment jsdom
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { RunPreviewFooter } from '../react/widgets/shared/RunPreviewFooter.jsx';

const __dir = dirname(fileURLToPath(import.meta.url));
const WIDGETS_ROOT = join(__dir, '../react/widgets');

function listWidgetJsxFiles(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const st = statSync(path);
        if (st.isDirectory()) {
            if (name === 'shared') continue;
            listWidgetJsxFiles(path, acc);
        } else if (name.endsWith('.jsx') && !name.startsWith('mount')) {
            acc.push(path);
        }
    }
    return acc;
}

describe('RunPreviewFooter', () => {
    it('renders Cancel then primary Run with standard classes', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(RunPreviewFooter, {
                onCancel: () => {},
                onRun: () => {},
                runLabel: 'Run Query'
            }));
        });

        const footer = container.querySelector('[data-testid="widget-run-preview-footer"]');
        expect(footer).toBeTruthy();
        expect(footer.querySelector('.cancel-btn')?.textContent).toBe('Cancel');
        expect(footer.querySelector('.apply-btn')?.textContent).toBe('Run Query');

        const buttons = footer.querySelectorAll('button');
        expect(buttons[0].classList.contains('cancel-btn')).toBe(true);
        expect(buttons[buttons.length - 1].classList.contains('apply-btn')).toBe(true);
    });

    it('orders Preview before primary Run when both shown', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(RunPreviewFooter, {
                onCancel: () => {},
                showPreview: true,
                onPreview: () => {},
                onRun: () => {},
                runLabel: 'Copy Link'
            }));
        });

        const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
        expect(labels).toEqual(['Cancel', 'Preview', 'Copy Link']);
    });
});

describe('widget dialog footers', () => {
    it('does not hand-roll modal-footer in widget dialogs', () => {
        const offenders = [];
        for (const file of listWidgetJsxFiles(WIDGETS_ROOT)) {
            const source = readFileSync(file, 'utf8');
            if (/className=["'`][^"'`]*modal-footer/.test(source)) {
                offenders.push(file.replace(`${WIDGETS_ROOT}/`, ''));
            }
        }
        expect(offenders).toEqual([]);
    });

    it('requires RunPreviewFooter when a dialog sets footer=', () => {
        const offenders = [];
        for (const file of listWidgetJsxFiles(WIDGETS_ROOT)) {
            const source = readFileSync(file, 'utf8');
            if (!/\bfooter=\{/.test(source)) continue;
            if (/footer=\{null\}/.test(source)) continue;
            if (!source.includes('RunPreviewFooter')) {
                offenders.push(file.replace(`${WIDGETS_ROOT}/`, ''));
            }
        }
        expect(offenders).toEqual([]);
    });
});
