export class JobCanceledError extends Error {
    /**
     * @param {string} [message]
     */
    constructor(message = 'Job canceled') {
        super(message);
        this.name = 'JobCanceledError';
        this.code = 'JOB_CANCELED';
    }
}

export class JobFailedError extends Error {
    /**
     * @param {string} message
     * @param {{ operation?: string, details?: unknown }} [extra]
     */
    constructor(message, extra = {}) {
        super(message);
        this.name = 'JobFailedError';
        this.code = 'JOB_FAILED';
        this.operation = extra.operation;
        this.details = extra.details;
    }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isJobCanceledError(err) {
    return Boolean(
        err &&
        (err.name === 'JobCanceledError' ||
            err.code === 'JOB_CANCELED' ||
            (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError'))
    );
}
