export function ChannelSchematic({ schematic, onSelectDrop, onPingChannel, onPingDrop, canPing }) {
    if (!schematic) {
        return <p className="atlas-muted">Select a channel to view its schematic.</p>;
    }
    const { channel, nodes } = schematic;
    return (
        <div className="atlas-schematic">
            <div className="atlas-schematic-header">
                <strong>Channel {channel.channelNumber}</strong>
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
                            className={`atlas-schematic-node atlas-schematic-node--${node.kind} atlas-ping--${node.ping?.status || 'untested'}`}
                            onClick={() => {
                                if (node.kind === 'drop') onSelectDrop?.(node.id);
                            }}
                            title={node.ip || node.label}
                        >
                            <span className="atlas-schematic-label">{node.label}</span>
                            {node.inventoryName && <span className="atlas-schematic-sub">{node.inventoryName}</span>}
                            {node.ip && <span className="atlas-schematic-sub">{node.ip}</span>}
                            {node.model && <span className="atlas-schematic-sub">{node.model}</span>}
                            {node.ping?.status && node.ping.status !== 'untested' && (
                                <span className="atlas-schematic-rtt">
                                    {node.ping.status}
                                    {node.ping.rttMs != null ? ` · ${node.ping.rttMs} ms` : ''}
                                </span>
                            )}
                        </button>
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
