import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyTextToClipboard } from '../../js/atlas/clipboard.js';
import { atlasNotify } from '../../js/atlas/controller.js';
import { formatChannelPrimary } from '../../js/atlas/display-label.js';
import { displayPingStatus, formatPingAge } from '../../js/atlas/ping-format.js';
import { CopyIpsButton } from './CopyIp.jsx';

function formatDropCoords(node) {
    if (node?.lat == null || node?.lon == null) return '';
    const lat = Number(node.lat);
    const lon = Number(node.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

async function copyAndNotify(text, emptyMessage, successMessage) {
    const value = String(text || '').trim();
    if (!value) {
        atlasNotify(emptyMessage || 'Nothing to copy', 'info');
        return;
    }
    const ok = await copyTextToClipboard(value);
    if (ok) {
        atlasNotify(
            successMessage || (value.includes('\n') ? 'Copied drop details' : `Copied ${value}`),
            'success'
        );
    } else {
        atlasNotify('Could not copy to clipboard', 'error');
    }
}

function DropContextMenu({ menu, onDismiss }) {
    const menuRef = useRef(null);

    useEffect(() => {
        if (!menu) return undefined;
        const onPointer = (e) => {
            if (!menuRef.current?.contains(e.target)) onDismiss();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') onDismiss();
        };
        const onWheel = () => onDismiss();
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('contextmenu', onPointer);
        document.addEventListener('keydown', onKey);
        document.addEventListener('wheel', onWheel, { passive: true });
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('contextmenu', onPointer);
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('wheel', onWheel);
        };
    }, [menu, onDismiss]);

    useEffect(() => {
        if (!menu || !menuRef.current) return;
        const rect = menuRef.current.getBoundingClientRect();
        let { x, y } = menu;
        if (x + rect.width > window.innerWidth) x = Math.max(4, window.innerWidth - rect.width - 4);
        if (y + rect.height > window.innerHeight) y = Math.max(4, window.innerHeight - rect.height - 4);
        if (x !== menu.x || y !== menu.y) {
            menuRef.current.style.left = `${x}px`;
            menuRef.current.style.top = `${y}px`;
        }
    }, [menu]);

    if (!menu) return null;

    return createPortal(
        <div
            ref={menuRef}
            className="map-context-menu atlas-schematic-ctx"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            {menu.items.map((item, index) => (
                item.sep ? (
                    <div key={`sep-${index}`} className="ctx-sep" />
                ) : (
                    <button
                        key={`${item.label}-${index}`}
                        type="button"
                        className={`ctx-item atlas-schematic-ctx-item${item.disabled ? ' is-disabled' : ''}`}
                        disabled={!!item.disabled}
                        onClick={() => {
                            if (item.disabled) return;
                            onDismiss();
                            item.action?.();
                        }}
                    >
                        <span className="ctx-label">{item.label}</span>
                    </button>
                )
            ))}
        </div>,
        document.body
    );
}

export function ChannelSchematic({
    schematic,
    onSelectDrop,
    onSelectHub,
    onSelectFinding,
    onPingChannel,
    onPingDrop,
    onStartMonitor,
    monitorInterval,
    monitorActive,
    canPing
}) {
    const [ctxMenu, setCtxMenu] = useState(null);
    const dismissCtxMenu = useCallback(() => setCtxMenu(null), []);

    if (!schematic) {
        return <p className="atlas-muted">Select a channel to view its schematic.</p>;
    }
    const { channel, nodes, openFindings = 0, dropCount = 0 } = schematic;
    const copyIps = nodes.map((n) => n.ip).filter(Boolean);
    const dropIps = nodes.filter((n) => n.kind === 'drop' && n.ip).map((n) => n.ip);

    const openDropMenu = (e, node) => {
        e.preventDefault();
        e.stopPropagation();
        const name = String(node.inventoryName || '').trim();
        const ip = String(node.ip || '').trim();
        const coords = formatDropCoords(node);
        const allParts = [name, ip, coords].filter(Boolean);
        setCtxMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: 'Ping Drop',
                    disabled: !canPing || !ip,
                    action: () => onPingDrop?.(node.id)
                },
                {
                    label: 'Copy IP',
                    disabled: !ip,
                    action: () => void copyAndNotify(ip, 'No IP to copy')
                },
                {
                    label: 'Copy Name',
                    disabled: !name,
                    action: () => void copyAndNotify(name, 'No name to copy')
                },
                {
                    label: 'Copy coordinates',
                    disabled: !coords,
                    action: () => void copyAndNotify(coords, 'No coordinates to copy')
                },
                {
                    label: 'Copy all',
                    disabled: !allParts.length,
                    action: () => void copyAndNotify(allParts.join('\n'), 'Nothing to copy')
                }
            ]
        });
    };

    return (
        <div className="atlas-schematic">
            <div className="atlas-schematic-header">
                <div className="atlas-schematic-title">
                    <strong>{formatChannelPrimary(channel.channelNumber)}</strong>
                    <span className="atlas-muted">
                        {dropCount} drop{dropCount === 1 ? '' : 's'}
                        {dropIps.length > 0 ? ` · ${dropIps.length} with IP` : ''}
                    </span>
                    {openFindings > 0 && (
                        <span className="atlas-schematic-badge" title="Open findings on this channel">
                            {openFindings} open
                        </span>
                    )}
                </div>
                {(copyIps.length > 0 || canPing) && (
                    <div className="atlas-toolbar">
                        {copyIps.length > 0 && <CopyIpsButton ips={copyIps} />}
                        {canPing && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onPingChannel?.(channel.id)}
                            >
                                Ping channel
                            </button>
                        )}
                        {canPing && dropIps.length > 0 && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={!!monitorActive}
                                onClick={() => onStartMonitor?.({
                                    targets: dropIps,
                                    interval: monitorInterval,
                                    label: formatChannelPrimary(channel.channelNumber)
                                })}
                            >
                                Start monitor
                            </button>
                        )}
                    </div>
                )}
            </div>
            <div className="atlas-schematic-flow">
                {nodes.map((node, idx) => (
                    <div key={`${node.id}-${idx}`} className="atlas-schematic-node-wrap">
                        {idx > 0 && <div className="atlas-schematic-arrow" aria-hidden="true">↓</div>}
                        <button
                            type="button"
                            className={`atlas-schematic-node atlas-schematic-node--${node.kind} atlas-ping--${displayPingStatus(node.ping)}${node.warnings?.length ? ' atlas-schematic-node--warn' : ''}`}
                            onClick={() => {
                                if (node.kind === 'drop') onSelectDrop?.(node.id);
                                else if (node.kind === 'hub') onSelectHub?.(node.id, node.hubCode);
                            }}
                            onContextMenu={node.kind === 'drop' ? (e) => openDropMenu(e, node) : undefined}
                            title={[
                                node.inventoryName,
                                node.ip || node.label,
                                node.model,
                                node.wireless ? 'wireless' : null,
                                ...(node.warnings || []).map((w) => w.findingType)
                            ].filter(Boolean).join(' · ')}
                        >
                            <span className="atlas-schematic-label">{node.label}</span>
                            {node.inventoryName && (
                                <span className="atlas-schematic-sub" title={node.inventoryName}>
                                    {node.inventoryName}
                                </span>
                            )}
                            {node.ip && (
                                <span className="atlas-schematic-sub atlas-schematic-ip">{node.ip}</span>
                            )}
                            {node.model && (
                                <span className="atlas-schematic-sub atlas-schematic-model">{node.model}</span>
                            )}
                            {node.wireless ? <span className="atlas-schematic-warn">Wireless</span> : null}
                            {!!node.warnings?.length && (
                                <span className="atlas-schematic-warn">
                                    {node.warnings.length} finding{node.warnings.length === 1 ? '' : 's'}
                                </span>
                            )}
                            {node.ping?.status && node.ping.status !== 'untested' && (
                                <span className="atlas-schematic-rtt">
                                    {node.kind === 'hub' ? 'Hub rollup · ' : ''}
                                    {node.ping.status}
                                    {node.ping.rttMs != null ? ` · ${node.ping.rttMs} ms` : ''}
                                    {node.kind !== 'hub' && node.ping?.at
                                        ? ` · ${formatPingAge(node.ping.at)}`
                                        : ''}
                                </span>
                            )}
                        </button>
                        {!!node.warnings?.length && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                title={node.warnings[0].description || node.warnings[0].findingType}
                                onClick={() => onSelectFinding?.(node.warnings[0])}
                            >
                                Finding
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <DropContextMenu menu={ctxMenu} onDismiss={dismissCtxMenu} />
        </div>
    );
}
