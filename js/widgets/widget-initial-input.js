/**
 * Map Send-to initialInput onto widget dialog field ids.
 * @param {object | undefined} initialInput
 * @param {Record<string, string>} fieldByPort
 * @returns {Record<string, string>}
 */
export function mapInitialInputToFields(initialInput, fieldByPort) {
    if (!initialInput?.layerId || !initialInput.inputName) return {};
    const field = fieldByPort[initialInput.inputName];
    if (!field) return {};
    return { [field]: initialInput.layerId };
}

/**
 * @param {object | undefined} initialInput
 * @param {string} [fallback='']
 */
export function initialLayerFromInput(initialInput, fallback = '') {
    return initialInput?.layerId || fallback;
}
