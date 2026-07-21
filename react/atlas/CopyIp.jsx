import { copyIpsToClipboard } from '../../js/atlas/clipboard.js';
import { atlasNotify } from '../../js/atlas/controller.js';

async function doCopy(ips) {
    const res = await copyIpsToClipboard(ips);
    if (!res.count) {
        atlasNotify('No IPs to copy', 'info');
        return;
    }
    if (res.ok) {
        atlasNotify(
            res.count === 1 ? `Copied ${res.text}` : `Copied ${res.count} IPs`,
            'success'
        );
    } else {
        atlasNotify('Could not copy to clipboard', 'error');
    }
}

/**
 * Clickable IP that copies itself.
 * @param {{ ip?: string|null, className?: string }} props
 */
export function CopyIp({ ip, className = '' }) {
    if (!ip) return <span className="atlas-muted">—</span>;
    return (
        <button
            type="button"
            className={`atlas-copy-ip atlas-mono${className ? ` ${className}` : ''}`}
            title="Copy IP"
            onClick={(e) => {
                e.stopPropagation();
                void doCopy([ip]);
            }}
        >
            {ip}
        </button>
    );
}

/**
 * Toolbar button to copy many IPs (newline-separated).
 * @param {{ ips?: Array<string|null|undefined>, label?: string, className?: string, disabled?: boolean }} props
 */
export function CopyIpsButton({
    ips = [],
    label = 'Copy IPs',
    className = 'btn btn-ghost btn-sm',
    disabled = false
}) {
    const count = (ips || []).filter(Boolean).length;
    return (
        <button
            type="button"
            className={className}
            disabled={disabled || !count}
            title={count ? `Copy ${count} IP${count === 1 ? '' : 's'} (one per line)` : 'No IPs'}
            onClick={() => void doCopy(ips)}
        >
            {label}{count ? ` (${count})` : ''}
        </button>
    );
}
