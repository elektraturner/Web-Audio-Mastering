/**
 * Transport Module
 * Handles audio playback controls: play, pause, stop, seek, timeline
 */

// ============================================================================
// State
// ============================================================================

export const playerState = {
  isPlaying: false,
  isBypassed: false,
  isSeeking: false,
  startTime: 0,
  pauseTime: 0,
  seekUpdateInterval: null,
  seekTimeout: null
};

// ============================================================================
// DOM Elements
// ============================================================================

const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const bypassBtn = document.getElementById('bypassBtn');

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format seconds as MM:SS
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Update play/pause icon visibility
 * @param {boolean} isPlaying - Whether audio is playing
 */
export function updatePlayPauseIcon(isPlaying) {
  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? 'none' : 'flex';
    pauseIcon.style.display = isPlaying ? 'flex' : 'none';
  }
}

/**
 * Update duration display and seek bar max
 * @param {number} duration - Duration in seconds
 */
export function updateDuration(duration) {
  if (durationEl) durationEl.textContent = formatTime(duration);
  if (seekBar) seekBar.max = duration;
}

/**
 * Update current time display
 * @param {number} time - Current time in seconds
 */
export function updateCurrentTime(time) {
  if (currentTimeEl) currentTimeEl.textContent = formatTime(time);
  if (seekBar) seekBar.value = time;
}

/**
 * Reset transport to initial state
 */
export function resetTransport() {
  playerState.pauseTime = 0;
  if (seekBar) seekBar.value = 0;
  if (currentTimeEl) currentTimeEl.textContent = '0:00';
}

// ============================================================================
// Playback Control Functions
// ============================================================================

/**
 * Start audio playback
 * @param {Object} audioNodes - Audio nodes object from app
 * @param {AudioBuffer} playbackBuffer - Buffer to play
 * @param {Function} connectFn - Function to connect audio chain
 * @param {Function} onMeterStart - Callback to start meter
 * @param {Function} onPlaybackEnd - Callback when playback ends
 * @param {Function} updateWaveSurfer - Callback to update waveform progress
 */
export function playAudio(audioNodes, playbackBuffer, connectFn, onMeterStart, onPlaybackEnd, updateWaveSurfer) {
  if (!audioNodes.context) return;
  if (!playbackBuffer) return;

  if (audioNodes.context.state === 'suspended') {
    audioNodes.context.resume();
  }

  stopAudio(audioNodes);

  audioNodes.source = audioNodes.context.createBufferSource();
  audioNodes.source.buffer = playbackBuffer;

  // Connect through provided function
  connectFn(audioNodes.source);

  audioNodes.source.onended = () => {
    if (playerState.isPlaying) {
      playerState.isPlaying = false;
      updatePlayPauseIcon(false);
      clearInterval(playerState.seekUpdateInterval);
      if (onPlaybackEnd) onPlaybackEnd();
    }
  };

  const offset = playerState.pauseTime;
  playerState.startTime = audioNodes.context.currentTime - offset;
  audioNodes.source.start(0, offset);
  playerState.isPlaying = true;
  updatePlayPauseIcon(true);

  if (onMeterStart) onMeterStart();

  clearInterval(playerState.seekUpdateInterval);
  playerState.seekUpdateInterval = setInterval(() => {
    if (playerState.isPlaying && playbackBuffer && !playerState.isSeeking) {
      const currentTime = audioNodes.context.currentTime - playerState.startTime;
      if (currentTime >= playbackBuffer.duration) {
        stopAudio(audioNodes);
        playerState.pauseTime = 0;
        updateCurrentTime(0);
        if (onPlaybackEnd) onPlaybackEnd();
      } else {
        updateCurrentTime(currentTime);
        if (updateWaveSurfer) updateWaveSurfer(currentTime);
      }
    }
  }, 100);
}

/**
 * Pause audio playback
 * @param {Object} audioNodes - Audio nodes object from app
 * @param {Function} onMeterStop - Callback to stop meter
 */
export function pauseAudio(audioNodes, onMeterStop) {
  if (!playerState.isPlaying) return;

  playerState.pauseTime = audioNodes.context.currentTime - playerState.startTime;
  stopAudio(audioNodes);
  if (onMeterStop) onMeterStop();
}

/**
 * Stop audio playback (internal - doesn't reset pauseTime)
 * @param {Object} audioNodes - Audio nodes object from app
 */
export function stopAudio(audioNodes) {
  if (audioNodes.source) {
    try {
      audioNodes.source.stop();
      audioNodes.source.disconnect();
    } catch (e) {}
    audioNodes.source = null;
  }
  playerState.isPlaying = false;
  updatePlayPauseIcon(false);
  clearInterval(playerState.seekUpdateInterval);
}

/**
 * Stop and reset playback (user-facing stop)
 * @param {Object} audioNodes - Audio nodes object from app
 * @param {Function} onMeterStop - Callback to stop meter
 */
export function stopAndReset(audioNodes, onMeterStop) {
  stopAudio(audioNodes);
  if (onMeterStop) onMeterStop();
  resetTransport();
}

/**
 * Seek to a specific time
 * @param {number} time - Time to seek to
 * @param {Object} audioNodes - Audio nodes object from app
 * @param {Function} connectFn - Function to connect audio chain
 * @param {Function} updateWaveSurfer - Callback to update waveform progress
 */
export function seekTo(time, audioNodes, connectFn, updateWaveSurfer) {
  // Prevent race condition from rapid seeks
  if (playerState.isSeeking) return;
  playerState.isSeeking = true;

  playerState.pauseTime = time;

  if (playerState.isPlaying) {
    if (audioNodes.source) {
      try {
        const oldSource = audioNodes.source;
        audioNodes.source = null;
        oldSource.onended = null;
        oldSource.stop();
        oldSource.disconnect();
      } catch (e) {}
    }
    clearInterval(playerState.seekUpdateInterval);

    audioNodes.source = audioNodes.context.createBufferSource();
    audioNodes.source.buffer = audioNodes.buffer;
    connectFn(audioNodes.source);

    audioNodes.source.onended = () => {
      if (playerState.isPlaying) {
        playerState.isPlaying = false;
        updatePlayPauseIcon(false);
        clearInterval(playerState.seekUpdateInterval);
      }
    };

    playerState.startTime = audioNodes.context.currentTime - time;
    audioNodes.source.start(0, time);

    playerState.seekUpdateInterval = setInterval(() => {
      if (playerState.isPlaying && audioNodes.buffer && !playerState.isSeeking) {
        const currentTime = audioNodes.context.currentTime - playerState.startTime;
        if (currentTime >= audioNodes.buffer.duration) {
          stopAudio(audioNodes);
          resetTransport();
        } else {
          updateCurrentTime(currentTime);
          if (updateWaveSurfer) updateWaveSurfer(currentTime);
        }
      }
    }, 100);
  } else {
    updateCurrentTime(time);
    if (updateWaveSurfer) updateWaveSurfer(time);
  }

  // Release seek lock after a brief delay
  if (playerState.seekTimeout) {
    clearTimeout(playerState.seekTimeout);
  }
  playerState.seekTimeout = setTimeout(() => {
    playerState.isSeeking = false;
    playerState.seekTimeout = null;
  }, 50);
}

// ============================================================================
// Event Listener Setup
// ============================================================================

/**
 * Setup transport control event listeners
 * @param {Object} handlers - Event handler callbacks
 */
export function setupTransportListeners(handlers = {}) {
  const {
    onPlay,
    onStop,
    onSeek,
    onBypassToggle
  } = handlers;

  // Play/Pause button
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (onPlay) onPlay(playerState.isPlaying);
    });
  }

  // Stop button
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (onStop) onStop();
    });
  }

  // Seek bar (hidden but kept for programmatic updates)
  if (seekBar) {
    seekBar.addEventListener('input', () => {
      const time = parseFloat(seekBar.value);
      if (currentTimeEl) currentTimeEl.textContent = formatTime(time);
    });
  }

  // Bypass button
  if (bypassBtn) {
    bypassBtn.addEventListener('click', () => {
      playerState.isBypassed = !playerState.isBypassed;
      const bypassLabel = bypassBtn.querySelector('.bypass-label');
      if (bypassLabel) {
        bypassLabel.textContent = playerState.isBypassed ? 'OFF' : 'FX';
      }
      bypassBtn.classList.toggle('active', playerState.isBypassed);
      if (onBypassToggle) onBypassToggle(playerState.isBypassed);
    });
  }
}

/**
 * Enable/disable transport controls
 * @param {boolean} enabled - Whether controls should be enabled
 */
export function setTransportEnabled(enabled) {
  if (playBtn) playBtn.disabled = !enabled;
  if (stopBtn) stopBtn.disabled = !enabled;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup transport resources (call on window unload)
 */
export function cleanupTransport() {
  if (playerState.seekUpdateInterval) {
    clearInterval(playerState.seekUpdateInterval);
    playerState.seekUpdateInterval = null;
  }
  if (playerState.seekTimeout) {
    clearTimeout(playerState.seekTimeout);
    playerState.seekTimeout = null;
  }
}
