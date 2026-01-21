/**
 * EQ Presets Module
 * Predefined EQ curves for common use cases
 */

/**
 * EQ preset definitions
 * Each preset defines gain values in dB for the 5-band EQ:
 * - low: 80Hz (lowshelf)
 * - lowMid: 250Hz (peaking)
 * - mid: 1kHz (peaking)
 * - highMid: 4kHz (peaking)
 * - high: 12kHz (highshelf)
 */
export const eqPresets = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  vocal: { low: -2, lowMid: -1, mid: 2, highMid: 3, high: 1 },
  bass: { low: 6, lowMid: 3, mid: 0, highMid: -1, high: -2 },
  bright: { low: -1, lowMid: 0, mid: 1, highMid: 3, high: 5 },
  warm: { low: 3, lowMid: 2, mid: 0, highMid: -2, high: -3 },
  aifix: { low: 1, lowMid: -2, mid: 1, highMid: -1, high: 2 }
};

/**
 * Output format presets
 */
export const outputPresets = {
  streaming: { sampleRate: 48000, bitDepth: 24 },  // 48k/24-bit preferred by distributors
  studio: { sampleRate: 48000, bitDepth: 24 }
};

/**
 * Get preset names for UI population
 * @returns {string[]} Array of preset names
 */
export function getPresetNames() {
  return Object.keys(eqPresets);
}

/**
 * Get a specific EQ preset
 * @param {string} name - Preset name
 * @returns {Object|null} Preset object or null if not found
 */
export function getPreset(name) {
  return eqPresets[name] || null;
}
