/**
 * Bridge workflow canvas/worker run context to js/tools/compute ctx helpers.
 */

/**
 * @param {object} [context] workflow execute context (signal + reportProgress)
 * @returns {object|undefined}
 */
export function adaptComputeContext(context) {
    if (!context) return context;
    const { signal, reportProgress, progress } = context;
    return {
        signal,
        reportProgress,
        progress:
            progress ??
            (typeof reportProgress === 'function'
                ? (fraction, message) => {
                      reportProgress({
                          progress: fraction,
                          message
                      });
                  }
                : undefined)
    };
}
