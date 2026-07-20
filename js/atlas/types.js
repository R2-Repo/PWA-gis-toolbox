/**
 * Shared Atlas domain types (JSDoc).
 */

/**
 * @typedef {Object} AtlasHub
 * @property {string} id
 * @property {string} hubCode
 * @property {string} [name]
 * @property {number|null} [lat]
 * @property {number|null} [lon]
 * @property {string} [regionId]
 */

/**
 * @typedef {Object} AtlasChannel
 * @property {string} id
 * @property {string} channelNumber
 * @property {string} [primaryHubId]
 * @property {string} [secondaryHubId]
 * @property {string} [primaryHubCode]
 * @property {string} [secondaryHubCode]
 */

/**
 * @typedef {Object} AtlasSite
 * @property {string} id
 * @property {string} [inventoryName]
 * @property {string} [siteId]
 * @property {number|null} [lat]
 * @property {number|null} [lon]
 */

/**
 * @typedef {Object} AtlasDrop
 * @property {string} id
 * @property {string} channelId
 * @property {string} [channelNumber]
 * @property {number|null} dropNumber
 * @property {string} [siteId]
 * @property {string} [inventoryName]
 * @property {number|null} [lat]
 * @property {number|null} [lon]
 * @property {string} [deviceId]
 * @property {string} [ip]
 * @property {string} [model]
 * @property {string} [manufacturer]
 * @property {boolean} [wireless]
 */

/**
 * @typedef {Object} AtlasDevice
 * @property {string} id
 * @property {string} [dropId]
 * @property {string} [ip]
 * @property {string} [deviceType]
 * @property {string} [manufacturer]
 * @property {string} [model]
 * @property {string} [status]
 * @property {string} [inventoryName]
 * @property {string} [gateway]
 * @property {string} [subnet]
 * @property {string} [subnetMask]
 * @property {string} [priHub]
 * @property {string} [secHub]
 * @property {string} [source]
 */

/**
 * @typedef {Object} AtlasFinding
 * @property {string} id
 * @property {string} findingType
 * @property {string} severity
 * @property {string} description
 * @property {string} [suggestedAction]
 * @property {string} status
 * @property {string} [notes]
 * @property {string} createdAt
 * @property {string|null} [resolvedAt]
 * @property {string[]} [sourceRecordIds]
 * @property {string} [entityId]
 */

/**
 * @typedef {'reachable'|'unreachable'|'pending'|'warning'|'untested'} PingReachability
 */

/**
 * @typedef {Object} PingStatusEntry
 * @property {PingReachability} status
 * @property {number|null} [rttMs]
 * @property {string} [error]
 * @property {string} [at]
 */

/**
 * @typedef {Object} AtlasSelection
 * @property {'hub'|'channel'|'drop'|'device'|'site'} kind
 * @property {string} id
 */

/**
 * @typedef {Object} AtlasSnapshot
 * @property {boolean} loaded
 * @property {AtlasHub[]} hubs
 * @property {AtlasChannel[]} channels
 * @property {AtlasDrop[]} drops
 * @property {AtlasDevice[]} devices
 * @property {AtlasSite[]} sites
 * @property {AtlasFinding[]} findings
 * @property {Record<string, PingStatusEntry>} pingResults
 * @property {AtlasSelection|null} selection
 * @property {object|null} areaResults
 * @property {object|null} activeSession
 * @property {object|null} stats
 */

export {};
