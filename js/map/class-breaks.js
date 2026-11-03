/**
 * Class breaks for graduated symbology.
 * Natural breaks use Fisher–Jenks (minimize within-class variance).
 */

const JENKS_SAMPLE_LIMIT = 400;

/**
 * @param {number} lo
 * @param {number} hi
 * @returns {string}
 */
export function formatClassRangeLabel(lo, hi) {
    return `${Number(lo).toFixed(1)} \u2013 ${Number(hi).toFixed(1)}`;
}

/**
 * @param {number[]} sorted ascending finite numbers
 * @param {number} limit
 * @returns {number[]}
 */
function downsampleSorted(sorted, limit) {
    if (sorted.length <= limit) return sorted;
    const out = [];
    const step = (sorted.length - 1) / (limit - 1);
    for (let i = 0; i < limit; i++) out.push(sorted[Math.round(i * step)]);
    return out;
}

function rangeVariance(prefix, prefixSq, i, j) {
    const len = j - i + 1;
    if (len <= 0) return Infinity;
    const sum = prefix[j + 1] - prefix[i];
    const sumSq = prefixSq[j + 1] - prefixSq[i];
    return sumSq - (sum * sum) / len;
}

/**
 * @param {number[]} values
 * @param {number} classCount
 * @returns {{ min: number, max: number, upper: number[] }|null}
 */
export function jenksUpperBreaks(values, classCount) {
    const sorted = [];
    for (const value of values || []) {
        const n = Number(value);
        if (Number.isFinite(n)) sorted.push(n);
    }
    sorted.sort((a, b) => a - b);
    if (sorted.length < 2) return null;
    const k = Math.max(2, Math.min(Math.floor(classCount) || 2, sorted.length));
    const data = downsampleSorted(sorted, JENKS_SAMPLE_LIMIT);
    if (data.length < k) return null;

    const n = data.length;
    const prefix = [0];
    const prefixSq = [0];
    for (let i = 0; i < n; i++) {
        prefix.push(prefix[i] + data[i]);
        prefixSq.push(prefixSq[i] + data[i] * data[i]);
    }

    const dp = Array.from({ length: k + 1 }, () => Array(n).fill(Infinity));
    const prev = Array.from({ length: k + 1 }, () => Array(n).fill(-1));
    for (let j = 0; j < n; j++) dp[1][j] = rangeVariance(prefix, prefixSq, 0, j);

    for (let c = 2; c <= k; c++) {
        for (let j = c - 1; j < n; j++) {
            for (let i = c - 2; i < j; i++) {
                const cost = dp[c - 1][i] + rangeVariance(prefix, prefixSq, i + 1, j);
                if (cost < dp[c][j]) {
                    dp[c][j] = cost;
                    prev[c][j] = i;
                }
            }
        }
    }
    if (!Number.isFinite(dp[k][n - 1])) return null;

    const upper = [];
    let end = n - 1;
    for (let c = k; c >= 1; c--) {
        upper.push(data[end]);
        if (c === 1) break;
        const cut = prev[c][end];
        if (cut < 0) return null;
        end = cut;
    }
    upper.reverse();
    return { min: data[0], max: data[n - 1], upper };
}

/**
 * Equal-interval upper bounds from min to max.
 * @param {number} min
 * @param {number} max
 * @param {number} classCount
 * @returns {number[]}
 */
export function equalIntervalUpperBreaks(min, max, classCount) {
    const count = Math.max(1, Math.floor(classCount) || 1);
    const step = (max - min) / count;
    const upper = [];
    for (let i = 0; i < count; i++) {
        upper.push(i === count - 1 ? max : min + step * (i + 1));
    }
    return upper;
}
