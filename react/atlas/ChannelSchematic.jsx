import { formatPingAge, isPingStale } from '../../js/atlas/ping-format.js';

export function ChannelSchematic({
    schematic,
    onSelectDrop,
    onSelectHub,
    onSelectFinding,
    onPingChannel,
    onPingDrop,
    canPing
}) {
    if (!schematic) {
        return <p className="atlas-muted">Select a channel to view its schematic.</p>;
    }
    const { channel, nodes, openFindings = 0 } = schematic;
    return (
        <div className="atlas-schematic">
            <div className="atlas-schematic-header">
                <strong>Channel {channel.channelNumber}</strong>
                {openFindings > 0 && (
                    <span className="atlas-schematic-badge" title="Open findings on this channel">
                        {openFindings} open
                    </span>
                )}
                {canPing && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingChannel?.(channel.id)}>
                        Ping channel
                    </button>
                )}
            </div>
            <div className="atlas-schematic-flow">
                {nodes.map((node, idx) => (
                    <div key={`${node.id}-${idx}`} className="atlas-schematic-node-wrap">
                        {idx > 0 && <div className="atlas-schematic-arrow" aria-hidden="true">→</div>}
                        <button
                            type="button"
                            className={`atlas-schematic-node atlas-schematic-node--${node.kind} atlas-ping--${node.ping?.status || 'untested'}${node.kind === 'drop' && isPingStale(node.ping?.at) ? ' atlas-ping--stale' : ''}${node.warnings?.length ? ' atlas-schematic-node--warn' : ''}`}
                            onClick={() => {
                                if (node.kind === 'drop') onSelectDrop?.(node.id);
                                else if (node.kind === 'hub') onSelectHub?.(node.id, node.hubCode);
                            }}
                            title={[
                                node.ip || node.label,
                                node.wireless ? 'wireless' : null,
                                ...(node.warnings || []).map((w) => w.findingType)
                            ].filter(Boolean).join(' · ')}
                        >
                            <span className="atlas-schematic-label">{node.label}</span>
                            {node.inventoryName && <span className="atlas-schematic-sub">{node.inventoryName}</span>}
                            {node.ip && <span className="atlas-schematic-sub">{node.ip}</span>}
                            {node.model && <span className="atlas-schematic-sub">{node.model}</span>}
                            {node.wireless ? <span className="atlas-schematic-warn">Wireless</span> : null}
                            {!!node.warnings?.length && (
                                <span className="atlas-schematic-warn">
                                    {node.warnings.length} finding{node.warnings.length === 1 ? '' : 's'}
                                </span>
                            )}
                            {node.ping?.status && node.ping.status !== 'untested' && (
                                <span className="atlas-schematic-rtt">
                                    {node.ping.status}
                                    {node.ping.rttMs != null ? ` · ${node.ping.rttMs} ms` : ''}
                                    {' · '}
                                    {formatPingAge(node.ping.at)}
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
                        {canPing && node.kind === 'drop' && node.ip && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => onPingDrop?.(node.id)}
                            >
                                Ping
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
