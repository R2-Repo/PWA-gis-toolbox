import { describe, expect, it } from 'vitest';
import { formatIpsForClipboard, uniqueIps } from '../js/atlas/clipboard.js';

describe('atlas clipboard', () => {
    it('uniqueIps trims, drops empties, preserves order', () => {
        expect(uniqueIps([' 10.0.0.1 ', '', null, '10.0.0.2', '10.0.0.1', undefined])).toEqual([
            '10.0.0.1',
            '10.0.0.2'
        ]);
        expect(uniqueIps('10.1.1.1')).toEqual(['10.1.1.1']);
        expect(uniqueIps(null)).toEqual([]);
    });

    it('formatIpsForClipboard joins unique IPs', () => {
        expect(formatIpsForClipboard(['10.0.0.1', '10.0.0.2', '10.0.0.1'])).toBe('10.0.0.1\n10.0.0.2');
        expect(formatIpsForClipboard(['a', 'b'], { separator: ', ' })).toBe('a, b');
        expect(formatIpsForClipboard([])).toBe('');
    });
});
