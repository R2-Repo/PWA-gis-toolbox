import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { buildChannelSchematic } from '../../js/atlas/schematic.js';
import { getHubChannelSummary } from '../../js/atlas/hierarchy.js';
import { buildDashboardStats, exportDropsCsv, exportFindingsCsv, findingsTableHtml, openPrintableReport } from '../../js/atlas/export.js';
import { collectHubIps, findingsInScope, listScopedDropsByPing } from '../../js/atlas/triage.js';
import { formatPingAge, formatPingWhen, isPingStale } from '../../js/atlas/ping-format.js';
import { ChannelSchematic } from './ChannelSchematic.jsx';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function statusClass(status) {
    return `atlas-finding-sev atlas-finding-sev--${status || 'info'}`;
}

export function AtlasRightPanel({
    canPing,
    onPingChannel,
    onPingDrop,
    onPingHub,
    onSelect,
    onPingSelectedIps,
    onStartMonitor,
    onStopMonitor,
    onUpdateFinding,
    onUpdateFindingNotes,
    onAreaFromDraw,
    onAreaPolygon,
    onClearArea,
    onSelectFinding
}) {
    const [tick, setTick] = useState(0);
    const [findingFilter, setFindingFilter] = useState('Open');
    const [findingTypeFilter, setFindingTypeFilter] = useState('all');
    const [monitorInterval, setMonitorInterval] = useState(1);
    const [dashScope, setDashScope] = useState('network');
    const [triageMode, setTriageMode] = useState('unreachable');
    const [noteDrafts, setNoteDrafts] = useState({});

    const focusFindings = (type = 'all', status = 'Open') => {
        setFindingFilter(status);
        setFindingTypeFilter(type);
        // scroll reconciliation into view if present
        requestAnimationFrame(() => {
            document.getElementById('atlas-findings')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        });
    };

    useEffect(() => {
        const unsub = [
            bus.on('atlas:changed', () => setTick((t) => t + 1)),
            bus.on('atlas:selection', (sel) => {
                if (sel) setDashScope('selection');
                else setDashScope('network');
                setTick((t) => t + 1);
            }),
            bus.on('atlas:ping', () => setTick((t) => t + 1))
        ];
        return () => unsub.forEach((u) => u?.());
    }, []);

    const snap = useMemo(() => getAtlasSnapshot(), [tick]);
    const stats = useMemo(
        () => buildDashboardStats(snap, { scope: dashScope }),
        [snap, tick, dashScope]
    );
    const selection = snap.selection;

    const schematic = useMemo(() => {
        if (selection?.kind === 'channel') return buildChannelSchematic(selection.id);
        if (selection?.kind === 'drop') {
            const drop = snap.drops.find((d) => d.id === selection.id);
            if (drop?.channelId) return buildChannelSchematic(drop.channelId);
        }
        return null;
    }, [selection, snap, tick]);

    const hubSummary = useMemo(() => {
        if (selection?.kind !== 'hub') return null;
        return getHubChannelSummary(selection.id);
    }, [selection, tick]);

    const dropDetail = useMemo(() => {
        if (selection?.kind !== 'drop') return null;
        return snap.drops.find((d) => d.id === selection.id) || null;
    }, [selection, snap, tick]);

    const deviceDetail = useMemo(() => {
        if (selection?.kind !== 'device') return null;
        return snap.devices.find((d) => d.id === selection.id) || null;
    }, [selection, snap, tick]);

    const siteDetail = useMemo(() => {
        if (selection?.kind !== 'site') return null;
        return snap.sites.find((s) => s.id === selection.id) || null;
    }, [selection, snap, tick]);

    const siteDrops = useMemo(() => {
        if (!siteDetail) return [];
        return (snap.drops || []).filter((d) => d.siteId === siteDetail.id);
    }, [siteDetail, snap, tick]);

    const channelDetail = useMemo(() => {
        if (selection?.kind !== 'channel') return null;
        const channel = snap.channels.find((c) => c.id === selection.id);
        if (!channel) return null;
        const drops = (snap.drops || []).filter((d) => d.channelId === channel.id);
        return {
            channel,
            dropCount: drops.length,
            ipCount: drops.filter((d) => d.ip).length
        };
    }, [selection, snap, tick]);

    const scopedFindings = useMemo(
        () => findingsInScope(snap, dashScope),
        [snap, tick, dashScope]
    );

    const findingTypes = useMemo(() => {
        const set = new Set(scopedFindings.map((f) => f.findingType).filter(Boolean));
        return [...set].sort();
    }, [scopedFindings]);

    const findings = useMemo(() => {
        let list = scopedFindings;
        if (findingFilter !== 'all') list = list.filter((f) => f.status === findingFilter);
        if (findingTypeFilter !== 'all') list = list.filter((f) => f.findingType === findingTypeFilter);
        return list;
    }, [scopedFindings, findingFilter, findingTypeFilter]);

    const area = snap.areaResults;

    const triageRows = useMemo(
        () => listScopedDropsByPing(snap, { scope: dashScope, mode: triageMode }),
        [snap, tick, dashScope, triageMode]
    );

    const monitorTail = useMemo(() => {
        const log = snap.activeSession?.log || [];
        return log.slice(-8).reverse();
    }, [snap.activeSession, tick]);

    const dropPing = dropDetail?.ip ? snap.pingResults?.[dropDetail.ip] : null;
    const devicePing = deviceDetail?.ip ? snap.pingResults?.[deviceDetail.ip] : null;

    return (
        <div className="atlas-panel atlas-panel-right">
            <CollapsibleSection title="Dashboard" bodyId="atlas-dash">
                <div className="atlas-toolbar">
                    <button
                        type="button"
                        className={`btn btn-sm${dashScope === 'network' ? ' btn-secondary' : ' btn-ghost'}`}
                        onClick={() => setDashScope('network')}
                    >
                        Network
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm${dashScope === 'selection' ? ' btn-secondary' : ' btn-ghost'}`}
                        onClick={() => setDashScope('selection')}
                        disabled={!selection && !snap.areaResults}
                        title="Scope to selected hub/channel/drop or area results"
                    >
                        Selection{stats.scopeLabel && stats.scopeLabel !== 'Network' ? ` (${stats.scopeLabel})` : ''}
                    </button>
                </div>
                <div className="atlas-dash-grid">
                    <div className="atlas-dash-card"><span>Hubs</span><strong>{stats.hubs}</strong></div>
                    <div className="atlas-dash-card"><span>Channels</span><strong>{stats.channels}</strong></div>
                    <div className="atlas-dash-card"><span>Drops</span><strong>{stats.drops}</strong></div>
                    <div className="atlas-dash-card"><span>Devices</span><strong>{stats.devices}</strong></div>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('all', 'Open')}
                        title="Show open findings"
                    >
                        <span>Open findings</span><strong>{stats.openFindings}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('missing_site_id', 'Open')}
                        title="Filter missing Site IDs"
                    >
                        <span>Missing Site IDs</span><strong>{stats.missingSiteIds}</strong>
                    </button>
                    <button
                        type="button"
                        className="atlas-dash-card atlas-dash-card--action"
                        onClick={() => focusFindings('duplicate_ip', 'Open')}
                        title="Filter duplicate IPs"
                    >
                        <span>Duplicate IPs</span><strong>{stats.duplicateIps}</strong>
                    </button>
                    <div className="atlas-dash-card"><span>Ping up/down</span><strong>{stats.pingReachable}/{stats.pingUnreachable}</strong></div>
                </div>
                <div className="atlas-toolbar">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => exportDropsCsv(snap, { scope: dashScope })}
                    >
                        Export drops CSV ({dashScope === 'selection' ? stats.scopeLabel || 'selection' : 'network'})
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openPrintableReport({
                            title: 'ITS Network Atlas Report',
                            bodyHtml: `<p class="muted">Scope: ${stats.scopeLabel || (dashScope === 'selection' ? 'Selection' : 'Network')}</p>
                              <table><tr><th>Metric</th><th>Value</th></tr>
                              <tr><td>Hubs</td><td>${stats.hubs}</td></tr>
                              <tr><td>Channels</td><td>${stats.channels}</td></tr>
                              <tr><td>Drops</td><td>${stats.drops}</td></tr>
                              <tr><td>Devices</td><td>${stats.devices}</td></tr>
                              <tr><td>Open findings</td><td>${stats.openFindings}</td></tr>
                              <tr><td>Missing Site IDs</td><td>${stats.missingSiteIds}</td></tr>
                              <tr><td>Duplicate IPs</td><td>${stats.duplicateIps}</td></tr>
                              <tr><td>Ping up/down</td><td>${stats.pingReachable}/${stats.pingUnreachable}</td></tr></table>
                              <h2>Findings</h2>
                              ${findingsTableHtml(scopedFindings.filter((f) => f.status === 'Open'))}`
                        })}
                    >
                        Printable report
                    </button>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Details & schematic" bodyId="atlas-details" defaultOpen>
                {!selection && <p className="atlas-muted">Select a hub, channel, drop, device, or site.</p>}
                {dropDetail && (
                    <div className="atlas-detail-block">
                        <h4>{dropDetail.inventoryName || `Drop ${dropDetail.dropNumber}`}</h4>
                        <p>Channel {dropDetail.channelNumber} · Drop {dropDetail.dropNumber ?? '—'}</p>
                        <p>IP: {dropDetail.ip || '—'}</p>
                        <p>{[dropDetail.manufacturer, dropDetail.model].filter(Boolean).join(' · ') || '—'}</p>
                        {dropDetail.wireless ? <p className="atlas-tag">Wireless</p> : null}
                        <p className={dropPing && isPingStale(dropPing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                            Ping: {dropPing?.status || 'untested'}
                            {dropPing?.rttMs != null ? ` · ${dropPing.rttMs} ms` : ''}
                            {' · '}
                            {formatPingAge(dropPing?.at)}
                            {dropPing?.at ? ` (${formatPingWhen(dropPing.at)})` : ''}
                        </p>
                        {canPing && dropDetail.ip && (
                            <div className="atlas-toolbar">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingDrop?.(dropDetail.id)}>Ping once</button>
                                <select className="input-sm" value={monitorInterval} onChange={(e) => setMonitorInterval(Number(e.target.value) || e.target.value)}>
                                    <option value="continuous">Continuous (~5s)</option>
                                    <option value={1}>Every 1 min</option>
                                    <option value={2}>Every 2 min</option>
                                    <option value={5}>Every 5 min</option>
                                    <option value={30}>Every 30 min</option>
                                    <option value={60}>Every 60 min</option>
                                </select>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={!!snap.activeSession}
                                    title={snap.activeSession ? 'Stop the active monitor first' : 'Start temporary monitoring'}
                                    onClick={() => onStartMonitor?.({ targets: [dropDetail.ip], interval: monitorInterval, label: dropDetail.inventoryName })}
                                >
                                    Start monitor
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {deviceDetail && (
                    <div className="atlas-detail-block">
                        <h4>{deviceDetail.inventoryName || deviceDetail.ip || 'Device'}</h4>
                        <p>{[deviceDetail.deviceType, deviceDetail.manufacturer, deviceDetail.model].filter(Boolean).join(' · ') || '—'}</p>
                        <p>IP: {deviceDetail.ip || '—'}</p>
                        {deviceDetail.provisional ? <p className="atlas-tag atlas-tag--warn">Provisional</p> : null}
                        {(deviceDetail.gateway || deviceDetail.subnet || deviceDetail.subnetMask) && (
                            <p className="atlas-muted">
                                {[
                                    deviceDetail.gateway ? `GW ${deviceDetail.gateway}` : null,
                                    deviceDetail.subnet ? `Subnet ${deviceDetail.subnet}` : null,
                                    deviceDetail.subnetMask ? `Mask ${deviceDetail.subnetMask}` : null
                                ].filter(Boolean).join(' · ')}
                            </p>
                        )}
                        {deviceDetail.status && <p className="atlas-muted">Status: {deviceDetail.status}</p>}
                        <p className={devicePing && isPingStale(devicePing.at) ? 'atlas-stale-warn' : 'atlas-muted'}>
                            Ping: {devicePing?.status || 'untested'}
                            {devicePing?.rttMs != null ? ` · ${devicePing.rttMs} ms` : ''}
                            {' · '}
                            {formatPingAge(devicePing?.at)}
                        </p>
                        {canPing && deviceDetail.ip && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onPingSelectedIps?.([deviceDetail.ip])}
                            >
                                Ping device
                            </button>
                        )}
                    </div>
                )}
                {siteDetail && (
                    <div className="atlas-detail-block">
                        <h4>{siteDetail.inventoryName || siteDetail.siteId || 'Site'}</h4>
                        <p>Site ID: {siteDetail.siteId || '—'}</p>
                        <p className="atlas-muted">
                            {[siteDetail.lat, siteDetail.lon].every((n) => n != null)
                                ? `${siteDetail.lat}, ${siteDetail.lon}`
                                : 'No coordinates'}
                        </p>
                        <p><strong>Drops at site:</strong> {siteDrops.length}</p>
                        <ul className="atlas-simple-list">
                            {siteDrops.map((d) => (
                                <li key={d.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'drop', id: d.id })}>
                                        Ch {d.channelNumber || '?'} · D{d.dropNumber ?? '?'} · {d.ip || 'no IP'}
                                    </button>
                                    {canPing && d.ip && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(d.id)}>Ping</button>
                                    )}
                                </li>
                            ))}
                            {!siteDrops.length && <li className="atlas-muted">No linked drops.</li>}
                        </ul>
                        {canPing && siteDrops.some((d) => d.ip) && (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onPingSelectedIps?.(siteDrops.map((d) => d.ip).filter(Boolean))}
                            >
                                Ping site switches
                            </button>
                        )}
                    </div>
                )}
                {channelDetail && (
                    <div className="atlas-detail-block">
                        <h4>Channel {channelDetail.channel.channelNumber}</h4>
                        <p>
                            Primary hub: {channelDetail.channel.primaryHubCode || '—'}
                            {' · '}
                            Secondary hub: {channelDetail.channel.secondaryHubCode || '—'}
                        </p>
                        <p>{channelDetail.dropCount} drops · {channelDetail.ipCount} with IP</p>
                        {canPing && channelDetail.ipCount > 0 && (
                            <div className="atlas-toolbar">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => onPingChannel?.(channelDetail.channel.id)}
                                >
                                    Ping channel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={!!snap.activeSession}
                                    onClick={() => {
                                        const ips = (snap.drops || [])
                                            .filter((d) => d.channelId === channelDetail.channel.id && d.ip)
                                            .map((d) => d.ip);
                                        onStartMonitor?.({
                                            targets: ips,
                                            interval: monitorInterval,
                                            label: `Channel ${channelDetail.channel.channelNumber}`
                                        });
                                    }}
                                >
                                    Start monitor
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {hubSummary && (
                    <div className="atlas-detail-block">
                        <h4>{hubSummary.hub.name || hubSummary.hub.hubCode}</h4>
                        {canPing && (
                            <div className="atlas-toolbar">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'all')}>
                                    Ping all hub switches
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'primary')}>
                                    Ping primary
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingHub?.(hubSummary.hub.id, 'secondary')}>
                                    Ping secondary
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={!!snap.activeSession}
                                    onClick={() => {
                                        const ips = collectHubIps(hubSummary.hub.id, 'all', snap);
                                        onStartMonitor?.({
                                            targets: ips,
                                            interval: monitorInterval,
                                            label: hubSummary.hub.name || hubSummary.hub.hubCode
                                        });
                                    }}
                                >
                                    Start monitor
                                </button>
                            </div>
                        )}
                        <p><strong>Primary channels:</strong> {hubSummary.primary.length}</p>
                        <ul className="atlas-simple-list">
                            {hubSummary.primary.map((row) => (
                                <li key={row.channel.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'channel', id: row.channel.id })}>
                                        Ch {row.channel.channelNumber}
                                    </button>
                                    {' '}· {row.dropCount} drops
                                    {canPing && row.firstDrop?.ip && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(row.firstDrop.id)}>Ping first</button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <p><strong>Secondary channels:</strong> {hubSummary.secondary.length}</p>
                        <ul className="atlas-simple-list">
                            {hubSummary.secondary.map((row) => (
                                <li key={row.channel.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'channel', id: row.channel.id })}>
                                        Ch {row.channel.channelNumber}
                                    </button>
                                    {' '}· {row.dropCount} drops
                                    {canPing && row.lastDrop?.ip && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPingDrop?.(row.lastDrop.id)}>Ping last</button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <ChannelSchematic
                    schematic={schematic}
                    canPing={canPing}
                    onSelectDrop={(id) => onSelect?.({ kind: 'drop', id })}
                    onSelectHub={(id, hubCode) => {
                        const hub = (snap.hubs || []).find((h) => h.id === id)
                            || (snap.hubs || []).find((h) => h.hubCode === hubCode);
                        if (hub) onSelect?.({ kind: 'hub', id: hub.id });
                    }}
                    onPingChannel={onPingChannel}
                    onPingDrop={onPingDrop}
                />
            </CollapsibleSection>

            <CollapsibleSection title="Ping triage" bodyId="atlas-triage" defaultOpen>
                <div className="atlas-toolbar">
                    {[
                        ['unreachable', 'Unreachable'],
                        ['stale', 'Stale'],
                        ['untested', 'Untested'],
                        ['attention', 'Needs attention']
                    ].map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            className={`btn btn-sm${triageMode === mode ? ' btn-secondary' : ' btn-ghost'}`}
                            onClick={() => setTriageMode(mode)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <p className="atlas-muted">
                    {triageMode} in {dashScope === 'selection' ? 'current selection/area' : 'full network'} ({triageRows.length}).
                </p>
                {canPing && triageRows.length > 0 && (
                    <div className="atlas-toolbar">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onPingSelectedIps?.(triageRows.map((r) => r.ip))}
                        >
                            Re-ping list ({triageRows.length})
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={!!snap.activeSession}
                            title={snap.activeSession ? 'Stop the active monitor first' : 'Monitor triage IPs'}
                            onClick={() => onStartMonitor?.({
                                targets: triageRows.map((r) => r.ip),
                                interval: monitorInterval,
                                label: `Triage ${triageMode}`
                            })}
                        >
                            Start monitor
                        </button>
                        <select className="input-sm" value={monitorInterval} onChange={(e) => setMonitorInterval(Number(e.target.value) || e.target.value)}>
                            <option value="continuous">Continuous (~5s)</option>
                            <option value={1}>Every 1 min</option>
                            <option value={5}>Every 5 min</option>
                        </select>
                    </div>
                )}
                <ul className="atlas-simple-list">
                    {triageRows.slice(0, 60).map((row) => (
                        <li key={row.drop.id}>
                            <button
                                type="button"
                                className="atlas-linkish"
                                onClick={() => onSelect?.({ kind: 'drop', id: row.drop.id })}
                            >
                                Ch {row.drop.channelNumber || '?'} · D{row.drop.dropNumber ?? '?'} · {row.ip}
                            </button>
                            <span className={`atlas-muted${row.stale ? ' atlas-stale-warn' : ''}`}>
                                {' '}· {row.status} · {row.age}
                            </span>
                        </li>
                    ))}
                    {!triageRows.length && <li className="atlas-muted">No matches in this triage mode.</li>}
                </ul>
            </CollapsibleSection>

            <CollapsibleSection title="Area troubleshooting" bodyId="atlas-area" defaultOpen={false}>
                <p className="atlas-muted">Draw a rectangle or polygon on the map. Results switch the dashboard to Selection scope. Selecting a hub/channel/drop clears the area.</p>
                <div className="atlas-toolbar">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAreaFromDraw?.()}>
                        Draw rectangle
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAreaPolygon?.()}>
                        Draw polygon
                    </button>
                    {area && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClearArea?.()}>
                            Clear area
                        </button>
                    )}
                </div>
                {area && (
                    <div className="atlas-detail-block">
                        <p>{area.drops.length} drops · {area.channels.length} channels · {area.hubs.length} hubs</p>
                        {!!area.warnings?.length && (
                            <p className="atlas-stale-warn">{area.warnings.length} open finding(s) in this area</p>
                        )}
                        {canPing && (
                            <div className="atlas-toolbar">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => onPingSelectedIps?.(area.drops.map((d) => d.ip).filter(Boolean))}
                                >
                                    Ping area switches
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={!!snap.activeSession || !area.drops.some((d) => d.ip)}
                                    onClick={() => onStartMonitor?.({
                                        targets: area.drops.map((d) => d.ip).filter(Boolean),
                                        interval: monitorInterval,
                                        label: 'Area monitor'
                                    })}
                                >
                                    Start monitor
                                </button>
                            </div>
                        )}
                        {!!area.warnings?.length && (
                            <ul className="atlas-simple-list">
                                {area.warnings.slice(0, 20).map((f) => (
                                    <li key={f.id}>
                                        <button type="button" className="atlas-linkish" onClick={() => onSelectFinding?.(f)}>
                                            {f.findingType}: {f.description}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <ul className="atlas-simple-list">
                            {area.drops.slice(0, 40).map((d) => (
                                <li key={d.id}>
                                    <button type="button" className="atlas-linkish" onClick={() => onSelect?.({ kind: 'drop', id: d.id })}>
                                        {d.inventoryName || d.ip || d.id}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Monitoring" bodyId="atlas-monitor" defaultOpen={false}>
                {snap.activeSession ? (
                    <div>
                        <p>
                            {snap.activeSession.label || 'Monitor'}
                            {' · '}
                            {(snap.activeSession.targets || []).length} target(s)
                            {' · '}
                            {snap.activeSession.log?.length || 0} samples
                        </p>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStopMonitor?.(snap.activeSession.id)}>
                            Stop & export CSV
                        </button>
                        {!!monitorTail.length && (
                            <ul className="atlas-simple-list atlas-monitor-tail">
                                {monitorTail.map((row, i) => (
                                    <li key={`${row.timestamp || row.at}-${row.ip}-${i}`}>
                                        <span className="atlas-mono">{row.ip}</span>
                                        {' · '}
                                        {row.status}
                                        {row.rttMs != null ? ` · ${row.rttMs} ms` : ''}
                                        <span className="atlas-muted"> · {formatPingWhen(row.timestamp || row.at)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ) : (
                    <p className="atlas-muted">Start a monitor from a drop, triage list, or area results.</p>
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Reconciliation" bodyId="atlas-findings" defaultOpen={false}>
                <p className="atlas-muted">
                    {findings.length} finding{findings.length === 1 ? '' : 's'}
                    {dashScope === 'selection'
                        ? ` in ${stats.scopeLabel || 'selection'}`
                        : ' (full network)'}
                </p>
                <div className="atlas-toolbar">
                    <select className="input-sm" value={findingFilter} onChange={(e) => setFindingFilter(e.target.value)}>
                        <option value="Open">Open</option>
                        <option value="Reviewed">Reviewed</option>
                        <option value="Ignored">Ignored</option>
                        <option value="Resolved">Resolved</option>
                        <option value="all">All</option>
                    </select>
                    <select
                        className="input-sm"
                        value={findingTypeFilter}
                        onChange={(e) => setFindingTypeFilter(e.target.value)}
                        title="Finding type"
                    >
                        <option value="all">All types</option>
                        {findingTypes.map((t) => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportFindingsCsv(findings)}>Export CSV</button>
                </div>
                <ul className="atlas-findings-list">
                    {findings.slice(0, 100).map((f) => (
                        <li key={f.id}>
                            <span className={statusClass(f.severity)}>{f.severity}</span>
                            <div>
                                <button
                                    type="button"
                                    className="atlas-linkish atlas-finding-title"
                                    onClick={() => onSelectFinding?.(f)}
                                    disabled={!f.entityId && !f.ip}
                                    title={f.entityId || f.ip ? 'Show on map / details' : 'No linked entity'}
                                >
                                    <strong>{f.findingType}</strong>
                                </button>
                                <p>{f.description}</p>
                                {f.suggestedAction && (
                                    <p className="atlas-muted">Action: {f.suggestedAction}</p>
                                )}
                                <label className="atlas-finding-notes">
                                    <span className="atlas-muted">Notes</span>
                                    <textarea
                                        className="input-sm atlas-finding-notes-input"
                                        rows={2}
                                        value={noteDrafts[f.id] ?? f.notes ?? ''}
                                        onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [f.id]: e.target.value }))}
                                        onBlur={() => {
                                            const next = noteDrafts[f.id];
                                            if (next === undefined || next === (f.notes || '')) return;
                                            onUpdateFindingNotes?.(f.id, next);
                                        }}
                                        placeholder="Operator notes…"
                                    />
                                </label>
                                <div className="atlas-toolbar">
                                    {['Open', 'Reviewed', 'Ignored', 'Resolved'].map((st) => (
                                        <button
                                            key={st}
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            disabled={f.status === st}
                                            onClick={() => onUpdateFinding?.(f.id, st)}
                                        >
                                            {st}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </li>
                    ))}
                    {!findings.length && <li className="atlas-muted">No findings for this filter.</li>}
                </ul>
            </CollapsibleSection>
        </div>
    );
}
