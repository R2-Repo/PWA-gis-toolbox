import { describe, expect, it } from 'vitest';
import { formatBytes } from '../js/workspace/storage-summary.js';

describe('storage-summary', () => {
    it('formats byte sizes', () => {
        expect(formatBytes(500)).toBe('500 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    });
});
