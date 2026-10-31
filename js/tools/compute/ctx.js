/**
 * Worker-safe progress / abort helpers for js/tools/compute (no TaskRunner / DOM).
 */

export function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

export function throwIfAbortedPeriodic(signal, index, every = 500) {
    if (index > 0 && index % every === 0) {
        throwIfAborted(signal);
    }
}

export function cloneDatasetOutput(data) {
    return structuredClone(data);
}

/**
 * @param {object} [context] signal + progress(fraction, msg?) or reportProgress({ progress, message })
 * @param {number} total
 */
export function createLoopProgress(context, total) {
    const signal = context?.signal;
    const progressFn = context?.progress;
    const reportProgress = context?.reportProgress;
    return (index, message) => {
        throwIfAborted(signal);
        if (index % 100 === 0 || index === total - 1) {
            const fraction = total > 0 ? index / total : 0;
            if (typeof progressFn === 'function') {
                progressFn(fraction, message);
            } else if (typeof reportProgress === 'function') {
                reportProgress({
                    progress: fraction,
                    processed: index,
                    total,
                    message
                });
            }
        }
    };
}
