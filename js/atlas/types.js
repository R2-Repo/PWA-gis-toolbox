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
 * @property {string} [aka]
 * @property {string} [hubIp]
 * @property {string} [channelsSubnet]
 * @property {boolean} [isShed]
 * @property {boolean} [fromOfficialList]
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
 * @typedef {Object} AtlasConnectedBuilding
 * @property {string} id
 * @property {string} buildingName
 * @property {string|null} [buildingType]
 * @property {string|null} [provider]
 * @property {string|null} [status]
 * @property {string|null} [fromHub]
 * @property {string|null} [toHub]
 * @property {string|null} [address]
 * @property {number|null} [lat]
 * @property {number|null} [lon]
 * @property {string|null} [regionId]
 * @property {string|null} [switch1Ip]
 * @property {string|null} [switch2Ip]
 * @property {string|null} [desktop1Ip]
 * @property {string|null} [desktop2Ip]
 * @property {string|null} [decoder1Ip]
 * @property {string|null} [decoder2Ip]
 * @property {string|null} [decoder3Ip]
 * @property {string|null} [decoder4Ip]
 * @property {string|null} [decoder5Ip]
 * @property {string|null} [decoder6Ip]
 * @property {string|null} [decoder7Ip]
 * @property {string|null} [decoder8Ip]
 * @property {string|null} [decoder9Ip]
 * @property {string|null} [decoder10Ip]
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
 * @property {boolean} [provisional]
 * @property {number|null} [lat]
 * @property {number|null} [lon]
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
 * @typedef {'reachable'|'unreachable'|'pending'|'intermittent'|'untested'|'warning'|'stale_reachable'|'stale_unreachable'|'no_ip'|'mixed'} PingReachability
 */

/**
 * @typedef {Object} PingStatusEntry
 * @property {PingReachability} status
 * @property {number|null} [rttMs]
 * @property {string} [error]
 * @property {string} [at]
 * @property {number} [sent]
 * @property {number} [received]
 * @property {number} [lossPct]
 */

/**
 * @typedef {Object} PingSessionSummary
 * @property {string} id
 * @property {string|null} [label]
 * @property {string|null} [startedAt]
 * @property {string|null} [stoppedAt]
 * @property {number} [sampleCount]
 * @property {number} [targetCount]
 */

/**
 * @typedef {Object} PingSessionDetail
 * @property {PingSessionSummary} session
 * @property {Array<{ ip?: string, status?: string, rttMs?: number|null, error?: string, at?: string, timestamp?: string }>} results
 */

/**
 * @typedef {Object} AtlasSelection
 * @property {'hub'|'channel'|'drop'|'device'|'site'|'building'|'area'} kind
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
 * @property {AtlasConnectedBuilding[]} [connectedBuildings]
 * @property {AtlasFinding[]} findings
 * @property {Record<string, PingStatusEntry>} pingResults
 * @property {AtlasSelection|null} selection
 * @property {object|null} areaResults
 * @property {object|null} activeSession
 * @property {object|null} stats
 * @property {{ monitorInterval: number|string, dashScope: 'network'|'selection', triageMode: string, sessionsRetentionDays: number, mapPingFilter: string, pingCount: number }} [prefs]
 */

export {};
