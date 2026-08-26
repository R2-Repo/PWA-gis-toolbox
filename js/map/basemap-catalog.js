/** @typedef {'map' | 'satellite'} BasemapCategory */

/** @typedef {'carto-vector' | 'raster' | 'hybrid'} BasemapKind */

/**
 * @typedef {object} BasemapOption
 * @property {string} key
 * @property {string} name
 * @property {BasemapKind} kind
 * @property {string} [styleUrl]
 * @property {string} [overlayStyleUrl]
 * @property {boolean} [overlayLabelsOnly]
 * @property {string[]} [tiles]
 * @property {string} [attribution]
 * @property {number} [maxZoom] Native tile pyramid cap (source.maxzoom). The map overzooms past this.
 * @property {string} [previewColor] First-frame backdrop before the vector style loads.
 * @property {string} [sprite]
 */

/**
 * @typedef {object} BasemapCategoryConfig
 * @property {string} defaultKey
 * @property {string} label
 * @property {string} icon
 * @property {BasemapOption[]} options
 */

export const CARTO_VECTOR_STYLES = {
    voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    darkMatter: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
};

export const CARTO_SPRITE_URLS = {
    voyager: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/sprite',
    darkMatter: 'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite',
    positron: 'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/sprite'
};

const ESRI_IMAGERY_TILES = [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
];

const CARTO_ATTRIBUTION = '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
const ESRI_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics';

/** @type {Record<BasemapCategory, BasemapCategoryConfig>} */
export const BASEMAP_CATEGORIES = {
    map: {
        defaultKey: 'voyager',
        label: 'Map',
        icon: '🗺️',
        options: [
            {
                key: 'voyager',
                name: 'Voyager',
                kind: 'carto-vector',
                styleUrl: CARTO_VECTOR_STYLES.voyager,
                sprite: CARTO_SPRITE_URLS.voyager,
                attribution: CARTO_ATTRIBUTION,
                previewColor: '#fbf8f3'
            },
            {
                key: 'dark-matter',
                name: 'Dark Matter',
                kind: 'carto-vector',
                styleUrl: CARTO_VECTOR_STYLES.darkMatter,
                sprite: CARTO_SPRITE_URLS.darkMatter,
                attribution: CARTO_ATTRIBUTION,
                previewColor: '#0e0e0e'
            },
            {
                key: 'positron',
                name: 'Positron',
                kind: 'carto-vector',
                styleUrl: CARTO_VECTOR_STYLES.positron,
                sprite: CARTO_SPRITE_URLS.positron,
                attribution: CARTO_ATTRIBUTION,
                previewColor: '#fafafa'
            }
        ]
    },
    satellite: {
        defaultKey: 'satellite',
        label: 'Satellite',
        icon: '🛰️',
        options: [
            {
                key: 'satellite',
                name: 'Satellite',
                kind: 'raster',
                tiles: ESRI_IMAGERY_TILES,
                attribution: ESRI_ATTRIBUTION,
                maxZoom: 19
            },
            {
                key: 'satellite-labels',
                name: 'Satellite + Labels',
                kind: 'hybrid',
                tiles: ESRI_IMAGERY_TILES,
                overlayStyleUrl: CARTO_VECTOR_STYLES.voyager,
                overlayLabelsOnly: true,
                sprite: CARTO_SPRITE_URLS.voyager,
                attribution: `${ESRI_ATTRIBUTION} ${CARTO_ATTRIBUTION}`,
                maxZoom: 19
            }
        ]
    }
};

/** @type {Map<string, { category: BasemapCategory, option: BasemapOption }>} */
const KEY_INDEX = new Map();

for (const [category, config] of Object.entries(BASEMAP_CATEGORIES)) {
    for (const option of config.options) {
        KEY_INDEX.set(option.key, { category: /** @type {BasemapCategory} */ (category), option });
    }
}

/**
 * @param {string} key
 * @returns {BasemapOption | null}
 */
export function getBasemapConfig(key) {
    return KEY_INDEX.get(key)?.option ?? null;
}

/**
 * @param {string} key
 * @returns {BasemapCategory | null}
 */
export function getBasemapCategory(key) {
    return KEY_INDEX.get(key)?.category ?? null;
}

/**
 * @param {BasemapCategory} category
 * @returns {string}
 */
export function getCategoryDefaultKey(category) {
    return BASEMAP_CATEGORIES[category]?.defaultKey ?? 'voyager';
}

/**
 * @returns {string[]}
 */
export function getAllBasemapKeys() {
    return [...KEY_INDEX.keys()];
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSatelliteBasemap(key) {
    return getBasemapCategory(key) === 'satellite';
}

/**
 * @param {string | BasemapOption | null | undefined} keyOrOption
 * @returns {boolean}
 */
export function isCartoVectorBasemap(keyOrOption) {
    const option = typeof keyOrOption === 'string' ? getBasemapConfig(keyOrOption) : keyOrOption;
    return option?.kind === 'carto-vector';
}

/**
 * @param {string | BasemapOption | null | undefined} keyOrOption
 * @returns {boolean}
 */
export function usesCartoVector(keyOrOption) {
    const option = typeof keyOrOption === 'string' ? getBasemapConfig(keyOrOption) : keyOrOption;
    return option?.kind === 'carto-vector' || option?.kind === 'hybrid';
}

/**
 * Flat map of basemap key -> tile config (for MapManager compatibility).
 * @returns {Record<string, BasemapOption>}
 */
export function getBasemapRegistry() {
    /** @type {Record<string, BasemapOption>} */
    const registry = {};
    for (const [key, entry] of KEY_INDEX) {
        registry[key] = entry.option;
    }
    return registry;
}

/**
 * Sync header basemap segment + dropdown item active states for a key.
 * Safe to call from React (segments) and vanilla dual-screen mounts.
 * @param {string} key
 * @returns {boolean}
 */
export function syncBasemapToggleActive(key) {
    const category = getBasemapCategory(key);
    if (!category) return false;

    document.querySelectorAll('#basemap-toggle .header-toggle-segment[data-category]').forEach((segment) => {
        segment.classList.toggle('active', segment.dataset.category === category);
    });

    document.querySelectorAll('#basemap-toggle .header-basemap-item').forEach((item) => {
        const value = item.dataset.value;
        if (!value) return;
        const isActive = value === key;
        item.classList.toggle('active', isActive);
        const name = getBasemapConfig(value)?.name || value;
        item.textContent = `${isActive ? '●' : '○'} ${name}`;
    });
    return true;
}

/**
 * Build basemap toggle segments into a container (dual-screen / vanilla JS).
 * @param {HTMLElement | null} root
 * @param {{ onSelect: (key: string) => void, getCurrentKey?: () => string }} handlers
 */
export function mountBasemapToggle(root, { onSelect, getCurrentKey }) {
    if (!root) return;

    root.innerHTML = '';
    root.classList.add('header-basemap-toggle');

    /** @type {HTMLElement | null} */
    let openDropdown = null;

    const closeDropdowns = () => {
        root.querySelectorAll('.header-basemap-dropdown.open').forEach((el) => el.classList.remove('open'));
        root.querySelectorAll('.header-toggle-caret[aria-expanded="true"]').forEach((el) => el.setAttribute('aria-expanded', 'false'));
        openDropdown = null;
    };

    for (const [category, config] of Object.entries(BASEMAP_CATEGORIES)) {
        const segment = document.createElement('div');
        segment.className = 'header-toggle-segment';
        segment.dataset.category = category;

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'header-toggle-option-main';
        mainBtn.dataset.category = category;
        mainBtn.dataset.value = config.defaultKey;
        mainBtn.textContent = `${config.icon} ${config.label}`;

        const caretBtn = document.createElement('button');
        caretBtn.type = 'button';
        caretBtn.className = 'header-toggle-caret';
        caretBtn.title = `More ${config.label.toLowerCase()} basemaps`;
        caretBtn.setAttribute('aria-haspopup', 'menu');
        caretBtn.setAttribute('aria-expanded', 'false');
        caretBtn.textContent = '▾';

        const dropdown = document.createElement('div');
        dropdown.className = 'header-basemap-dropdown header-print-dropdown';

        for (const option of config.options) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'header-print-item header-basemap-item';
            item.dataset.value = option.key;
            item.textContent = option.name;
            dropdown.appendChild(item);
        }

        segment.append(mainBtn, caretBtn, dropdown);
        root.appendChild(segment);
    }

    const refreshActiveItems = () => {
        const currentKey = getCurrentKey?.() ?? '';
        root.querySelectorAll('.header-basemap-item').forEach((item) => {
            const isActive = item.dataset.value === currentKey;
            item.classList.toggle('active', isActive);
            item.textContent = `${isActive ? '●' : '○'} ${getBasemapConfig(item.dataset.value)?.name || item.dataset.value}`;
        });
        syncBasemapToggleActive(currentKey);
    };

    root.addEventListener('click', (e) => {
        const caret = e.target.closest('.header-toggle-caret');
        if (caret) {
            e.stopPropagation();
            const dropdown = caret.parentElement?.querySelector('.header-basemap-dropdown');
            if (!dropdown) return;
            const willOpen = !dropdown.classList.contains('open');
            closeDropdowns();
            if (willOpen) {
                dropdown.classList.add('open');
                caret.setAttribute('aria-expanded', 'true');
                openDropdown = dropdown;
            }
            return;
        }

        const item = e.target.closest('.header-basemap-item');
        if (item?.dataset.value) {
            closeDropdowns();
            onSelect(item.dataset.value);
            refreshActiveItems();
            return;
        }

        const main = e.target.closest('.header-toggle-option-main');
        if (main?.dataset.category) {
            closeDropdowns();
            onSelect(getCategoryDefaultKey(/** @type {BasemapCategory} */ (main.dataset.category)));
            refreshActiveItems();
        }
    });

    document.addEventListener('click', (e) => {
        if (!openDropdown || root.contains(/** @type {Node} */ (e.target))) return;
        closeDropdowns();
    });

    refreshActiveItems();
}
