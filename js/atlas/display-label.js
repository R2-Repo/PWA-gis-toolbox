/**
 * Short primary + muted secondary lines for Atlas narrow panels.
 * Keep tree, search, schematic, and detail headers aligned.
 */

/**
 * @typedef {{ primary: string, secondary?: string|null, title?: string }} AtlasDisplayLines
 */

/**
 * @param {string|null|undefined} hubCode
 * @returns {string}
 */
export function formatHubTreeLabel(hubCode) {
    const code = hubCode != null ? String(hubCode).trim() : '';
    return code ? `hub${code}` : 'hub?';
}

/**
 * @param {string|null|undefined} dropNumber
 * @returns {string}
 */
export function formatDropPrimary(dropNumber) {
    return `D${dropNumber ?? '?'}`;
}

/**
 * @param {string|number|null|undefined} channelNumber
 * @returns {string}
 */
export function formatChannelPrimary(channelNumber) {
    return channelNumber != null && String(channelNumber).trim() !== ''
        ? `Ch ${channelNumber}`
        : 'Ch ?';
}

/**
 * @param {'hub'|'channel'|'drop'|'device'|'site'|string} kind
 * @param {object|null|undefined} entity
 * @returns {AtlasDisplayLines}
 */
export function formatAtlasEntityLines(kind, entity) {
    if (!entity) {
        return { primary: kind || 'Entity', secondary: null, title: kind || 'Entity' };
    }

    if (kind === 'hub') {
        const primary = formatHubTreeLabel(entity.hubCode);
        const secondary = entity.aka || entity.name || null;
        return {
            primary,
            secondary: secondary && secondary !== primary ? secondary : null,
            title: [primary, secondary].filter(Boolean).join(' · ')
        };
    }

    if (kind === 'channel') {
        const primary = formatChannelPrimary(entity.channelNumber);
        const secondary = entity.dropCount != null
            ? `${entity.dropCount} drop${entity.dropCount === 1 ? '' : 's'}`
            : [entity.primaryHubCode, entity.secondaryHubCode].filter(Boolean).join(' → ') || null;
        return {
            primary,
            secondary,
            title: [primary, secondary].filter(Boolean).join(' · ')
        };
    }

    if (kind === 'drop') {
        const primary = formatDropPrimary(entity.dropNumber);
        const secondary = entity.inventoryName || entity.ip || null;
        return {
            primary,
            secondary,
            title: [primary, entity.inventoryName, entity.ip].filter(Boolean).join(' · ')
        };
    }

    if (kind === 'device') {
        const primary = entity.ip || entity.model || 'device';
        const secondary = entity.inventoryName
            || [entity.model, entity.deviceType].filter(Boolean).join(' · ')
            || null;
        return {
            primary,
            secondary: secondary && secondary !== primary ? secondary : null,
            title: [primary, entity.inventoryName, entity.model].filter(Boolean).join(' · ')
        };
    }

    if (kind === 'site') {
        const primary = entity.siteId || entity.id || 'Site';
        const secondary = entity.inventoryName || null;
        return {
            primary: String(primary),
            secondary: secondary && secondary !== primary ? secondary : null,
            title: [entity.inventoryName, entity.siteId].filter(Boolean).join(' · ') || String(primary)
        };
    }

    if (kind === 'building') {
        const primary = entity.buildingName || entity.name || 'Building';
        const secondary = entity.address
            || [entity.fromHub, entity.toHub].filter(Boolean).join(' → ')
            || entity.buildingType
            || null;
        return {
            primary: String(primary),
            secondary: secondary && secondary !== primary ? secondary : null,
            title: [primary, entity.address, entity.buildingType].filter(Boolean).join(' · ')
        };
    }

    return {
        primary: String(entity.label || entity.name || kind),
        secondary: entity.meta || entity.secondary || null,
        title: String(entity.label || entity.name || kind)
    };
}
