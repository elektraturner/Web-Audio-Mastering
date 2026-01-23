/**
 * Meters Module
 * Handles level meters, peak displays, LUFS display, and overload indicators
 */

// ============================================================================
// State
// ============================================================================

export const meterState = {
  levels: [0, 0],                    // Current levels (dB)
  peakLevels: [-Infinity, -Infinity], // Peak hold in dB
  peakHoldTimes: [0, 0],             // When peak was set
  overload: false,
  overloadTime: 0,
  animationId: null,
  PEAK_HOLD_TIME: 1.5,               // seconds
  FALL_RATE: 25,                     // dB per second
  OVERLOAD_DISPLAY_TIME: 2.0         // seconds
};

// ============================================================================
// DOM Elements
// ============================================================================

const meterCanvas = document.getElementById('meterCanvas');
const meterCtx = meterCanvas ? meterCanvas.getContext('2d') : null;
const peakLDisplay = document.getElementById('peakL');
const peakRDisplay = document.getElementById('peakR');
const outputLufsDisplay = document.getElementById('outputLufs');
const overloadIndicator = document.getElementById('overloadIndicator');

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert amplitude to dB
 * @param {number} amplitude - Linear amplitude value
 * @returns {number} dB value
 */
export function amplitudeToDB(amplitude) {
  return 20 * Math.log10(amplitude < 1e-8 ? 1e-8 : amplitude);
}

// ============================================================================
// Level Meter Functions
// ============================================================================

/**
 * Update level meter from analyser nodes
 * @param {AnalyserNode} analyserL - Left channel analyser
 * @param {AnalyserNode} analyserR - Right channel analyser
 * @param {boolean} isPlaying - Whether audio is currently playing
 */
export function updateLevelMeter(analyserL, analyserR, isPlaying) {
  if (!analyserL || !meterCtx || !isPlaying) return;

  const time = performance.now() / 1000;

  // Get time domain data from L and R analysers
  const bufferLength = analyserL.fftSize;
  const dataArrayL = new Float32Array(bufferLength);
  const dataArrayR = new Float32Array(bufferLength);
  analyserL.getFloatTimeDomainData(dataArrayL);
  analyserR.getFloatTimeDomainData(dataArrayR);

  // Calculate peak for left and right channels separately
  let peakL = 0, peakR = 0;
  for (let i = 0; i < bufferLength; i++) {
    const absL = Math.abs(dataArrayL[i]);
    const absR = Math.abs(dataArrayR[i]);
    if (absL > peakL) peakL = absL;
    if (absR > peakR) peakR = absR;
  }

  const peaks = [peakL, peakR];
  const dbLevels = peaks.map(p => amplitudeToDB(p));

  // Update levels with fall rate
  const deltaTime = 1 / 60; // Approximate frame time
  for (let ch = 0; ch < 2; ch++) {
    const fallingLevel = meterState.levels[ch] - meterState.FALL_RATE * deltaTime;
    meterState.levels[ch] = Math.max(dbLevels[ch], Math.max(-96, fallingLevel));

    // Update peak hold
    if (dbLevels[ch] > meterState.peakLevels[ch]) {
      meterState.peakLevels[ch] = dbLevels[ch];
      meterState.peakHoldTimes[ch] = time;
    } else if (time > meterState.peakHoldTimes[ch] + meterState.PEAK_HOLD_TIME) {
      // Let peak fall after hold time
      const fallingPeak = meterState.peakLevels[ch] - meterState.FALL_RATE * deltaTime;
      meterState.peakLevels[ch] = Math.max(fallingPeak, meterState.levels[ch]);
    }
  }

  // Check overload
  if (peakL > 1.0 || peakR > 1.0) {
    meterState.overload = true;
    meterState.overloadTime = time;
  } else if (time > meterState.overloadTime + meterState.OVERLOAD_DISPLAY_TIME) {
    meterState.overload = false;
  }

  // Draw meter
  drawMeter();

  // Update peak displays
  if (peakLDisplay) {
    const peakLVal = meterState.peakLevels[0];
    peakLDisplay.textContent = `L: ${peakLVal > -96 ? peakLVal.toFixed(1) : '-\u221E'} dB`;
  }
  if (peakRDisplay) {
    const peakRVal = meterState.peakLevels[1];
    peakRDisplay.textContent = `R: ${peakRVal > -96 ? peakRVal.toFixed(1) : '-\u221E'} dB`;
  }

  // Update overload indicator
  if (overloadIndicator) {
    overloadIndicator.classList.toggle('active', meterState.overload);
  }
}

/**
 * Draw the level meter on canvas
 */
export function drawMeter() {
  if (!meterCtx) return;

  const width = meterCanvas.width;
  const height = meterCanvas.height;
  const dbRange = 48; // -48 to 0 dB
  const dbStart = -48;
  const channelHeight = height / 2 - 1;

  // Clear canvas
  meterCtx.fillStyle = '#0a0a0a';
  meterCtx.fillRect(0, 0, width, height);

  // Draw each channel
  for (let ch = 0; ch < 2; ch++) {
    const y = ch * (height / 2);
    const level = meterState.levels[ch];
    const peakLevel = meterState.peakLevels[ch];

    // Create gradient
    const gradient = meterCtx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#22c55e');           // Green
    gradient.addColorStop(0.75, '#22c55e');        // Green until -12dB
    gradient.addColorStop(0.75, '#eab308');        // Yellow
    gradient.addColorStop(0.875, '#eab308');       // Yellow until -6dB
    gradient.addColorStop(0.875, '#ef4444');       // Red
    gradient.addColorStop(1, '#ef4444');           // Red

    // Draw level bar
    const levelWidth = Math.max(0, ((level - dbStart) / dbRange) * width);
    meterCtx.fillStyle = gradient;
    meterCtx.fillRect(0, y + 1, levelWidth, channelHeight);

    // Draw peak indicator
    if (peakLevel > -96) {
      const peakX = ((peakLevel - dbStart) / dbRange) * width;
      meterCtx.fillStyle = '#ffffff';
      meterCtx.fillRect(Math.max(0, peakX - 1), y + 1, 2, channelHeight);
    }
  }

  // Draw channel separator
  meterCtx.fillStyle = '#333';
  meterCtx.fillRect(0, height / 2 - 0.5, width, 1);
}

/**
 * Start the level meter animation loop
 * @param {AnalyserNode} analyserL - Left channel analyser
 * @param {AnalyserNode} analyserR - Right channel analyser
 * @param {Function} isPlayingFn - Function that returns current playing state
 */
export function startMeter(analyserL, analyserR, isPlayingFn) {
  if (!meterState.animationId) {
    // Reset meter state
    meterState.levels = [-96, -96];
    meterState.peakLevels = [-Infinity, -Infinity];
    meterState.overload = false;

    const animate = () => {
      updateLevelMeter(analyserL, analyserR, isPlayingFn());
      if (isPlayingFn()) {
        meterState.animationId = requestAnimationFrame(animate);
      } else {
        // Animation stopped naturally, clear the ID so it can restart
        meterState.animationId = null;
      }
    };
    animate();
  }
}

/**
 * Stop the level meter animation
 */
export function stopMeter() {
  if (meterState.animationId) {
    cancelAnimationFrame(meterState.animationId);
    meterState.animationId = null;
  }
  // Reset display
  meterState.levels = [-96, -96];
  meterState.peakLevels = [-Infinity, -Infinity];
  meterState.overload = false;
  drawMeter();
  if (peakLDisplay) peakLDisplay.textContent = 'L: -\u221E dB';
  if (peakRDisplay) peakRDisplay.textContent = 'R: -\u221E dB';
  if (overloadIndicator) overloadIndicator.classList.remove('active');
}

// ============================================================================
// LUFS Display Functions
// ============================================================================

/**
 * Update the output LUFS display
 * @param {number|null} lufs - LUFS value to display, or null for placeholder
 * @param {boolean} isRendering - Whether a render is in progress
 * @param {number|null} progress - Render progress (0-1), or null if not available
 */
export function updateLufsDisplay(lufs, isRendering = false, progress = null) {
  if (!outputLufsDisplay) return;

  if (lufs !== null && !isNaN(lufs)) {
    outputLufsDisplay.textContent = `${lufs.toFixed(1)} LUFS`;
  } else if (isRendering && progress !== null) {
    outputLufsDisplay.textContent = `${Math.round(progress * 100)}%`;
  } else if (isRendering) {
    outputLufsDisplay.textContent = '... LUFS';
  } else {
    outputLufsDisplay.textContent = '-- LUFS';
  }
}

/**
 * Show rendering progress in LUFS display
 * @param {number} progress - Progress value 0-1
 */
export function showRenderProgress(progress) {
  if (!outputLufsDisplay) return;
  outputLufsDisplay.textContent = `${Math.round(progress * 100)}%`;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup meter resources (call on window unload)
 */
export function cleanupMeter() {
  if (meterState.animationId) {
    cancelAnimationFrame(meterState.animationId);
    meterState.animationId = null;
  }
}
