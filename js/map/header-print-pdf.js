/**
 * Header print-menu choices for the map PDF.
 * Pure: no map, no jsPDF, no network.
 */

export function normalizeHeaderPrintPageSize(pageSize) {
    return String(pageSize ?? '').trim().toLowerCase() === 'tabloid' ? 'tabloid' : 'letter';
}

/**
 * Latest plan-project name stored on a widget session, if any.
 * @param {{ state?: { project?: { projectName?: string } } }[]} [widgets]
 */
export function readWidgetProjectName(widgets) {
    const list = Array.isArray(widgets) ? widgets : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const name = list[i]?.state?.project?.projectName;
        if (typeof name === 'string' && name.trim()) return name.trim();
    }
    return '';
}

export function defaultHeaderPdfTitle(projectName) {
    const name = String(projectName ?? '').trim();
    return name || 'Map';
}

/**
 * @param {{ pageSize?: string, title?: string, projectName?: string }} [input]
 * @returns {{ pageSize: 'letter'|'tabloid', title: string }}
 */
export function headerPdfDownloadOptions(input = {}) {
    const typed = String(input.title ?? '').trim();
    return {
        pageSize: normalizeHeaderPrintPageSize(input.pageSize),
        title: typed || defaultHeaderPdfTitle(input.projectName)
    };
}
