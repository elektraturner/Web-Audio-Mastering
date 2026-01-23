/**
 * DSP Worker Interface
 * Provides a Promise-based API for communicating with the DSP Web Worker
 *
 * Usage:
 *   const dspWorker = new DSPWorkerInterface();
 *   const { lufs } = await dspWorker.measureLUFS(audioBuffer);
 *   const { channels } = await dspWorker.normalize(audioBuffer, -14, -1, onProgress);
 */

export class DSPWorkerInterface {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 0;
    this.isReady = false;
  }

  /**
   * Initialize the worker
   * Call this before using any other methods
   */
  async init() {
    if (this.worker) return;

    return new Promise((resolve, reject) => {
      try {
        // Use import.meta.url for proper module worker resolution with Vite
        this.worker = new Worker(
          new URL('./dsp-worker.js', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (e) => this._handleMessage(e);
        this.worker.onerror = (e) => {
          console.error('[DSPWorker] Worker error:', e);
          reject(e);
        };

        // Give the worker a moment to initialize
        setTimeout(() => {
          this.isReady = true;
          console.log('[DSPWorker] Interface ready');
          resolve();
        }, 100);

      } catch (error) {
        console.error('[DSPWorker] Failed to create worker:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle messages from worker
   */
  _handleMessage(e) {
    const { id, type, success, result, error, progress, status } = e.data;

    // Handle progress updates
    if (type === 'PROGRESS') {
      const pending = this.pending.get(id);
      if (pending && pending.onProgress) {
        pending.onProgress(progress, status);
      }
      return;
    }

    // Handle completion
    const pending = this.pending.get(id);
    if (!pending) {
      console.warn('[DSPWorker] Received message for unknown id:', id);
      return;
    }

    this.pending.delete(id);

    if (success) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error || 'Unknown worker error'));
    }
  }

  /**
   * Send a message to the worker
   * @param {string} type - Message type
   * @param {object} data - Message data
   * @param {Function} onProgress - Progress callback (progress: 0-1, status: string)
   * @param {Transferable[]} transferables - Transferable objects
   * @returns {Promise}
   */
  _send(type, data, onProgress = null, transferables = []) {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not initialized. Call init() first.'));
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, onProgress });

      try {
        this.worker.postMessage({ type, id, data }, transferables);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Extract channel data from AudioBuffer for transfer to worker
   * @param {AudioBuffer} audioBuffer
   * @returns {{ channels: Float32Array[], sampleRate: number, transferables: ArrayBuffer[] }}
   */
  _extractChannelData(audioBuffer) {
    const channels = [];
    const transferables = [];

    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      // Create a copy of the channel data (getChannelData returns a view)
      const channelData = audioBuffer.getChannelData(i).slice();
      channels.push(channelData);
      transferables.push(channelData.buffer);
    }

    return {
      channels,
      sampleRate: audioBuffer.sampleRate,
      transferables
    };
  }

  /**
   * Create an AudioBuffer from channel data returned by worker
   * @param {Float32Array[]} channels
   * @param {number} sampleRate
   * @returns {AudioBuffer}
   */
  _createAudioBuffer(channels, sampleRate) {
    const length = channels[0].length;
    const numChannels = channels.length;

    const audioBuffer = new AudioBuffer({
      numberOfChannels: numChannels,
      length: length,
      sampleRate: sampleRate
    });

    for (let i = 0; i < numChannels; i++) {
      audioBuffer.copyToChannel(channels[i], i);
    }

    return audioBuffer;
  }

  /**
   * Measure LUFS of an AudioBuffer
   * @param {AudioBuffer} audioBuffer
   * @returns {Promise<{ lufs: number }>}
   */
  async measureLUFS(audioBuffer) {
    const { channels, sampleRate, transferables } = this._extractChannelData(audioBuffer);

    return this._send(
      'MEASURE_LUFS',
      { channels, sampleRate },
      null,
      transferables
    );
  }

  /**
   * Find true peak of an AudioBuffer
   * @param {AudioBuffer} audioBuffer
   * @returns {Promise<{ peakDB: number }>}
   */
  async findTruePeak(audioBuffer) {
    const { channels, sampleRate, transferables } = this._extractChannelData(audioBuffer);

    return this._send(
      'FIND_TRUE_PEAK',
      { channels, sampleRate },
      null,
      transferables
    );
  }

  /**
   * Normalize an AudioBuffer to target LUFS
   * @param {AudioBuffer} audioBuffer
   * @param {number} targetLUFS - Target loudness in LUFS (default -14)
   * @param {number} ceilingDB - True peak ceiling in dB (default -1)
   * @param {Function} onProgress - Progress callback (progress: 0-1, status: string)
   * @returns {Promise<{ audioBuffer: AudioBuffer, currentLUFS: number, finalLUFS: number, peakDB: number }>}
   */
  async normalize(audioBuffer, targetLUFS = -14, ceilingDB = -1, onProgress = null) {
    const { channels, sampleRate, transferables } = this._extractChannelData(audioBuffer);

    const result = await this._send(
      'NORMALIZE',
      { channels, sampleRate, targetLUFS, ceilingDB },
      onProgress,
      transferables
    );

    // Convert channels back to AudioBuffer
    const normalizedBuffer = this._createAudioBuffer(result.channels, sampleRate);

    return {
      audioBuffer: normalizedBuffer,
      currentLUFS: result.currentLUFS,
      finalLUFS: result.finalLUFS,
      peakDB: result.peakDB,
      gainApplied: result.gainApplied,
      limiterApplied: result.limiterApplied
    };
  }

  /**
   * Apply limiter to an AudioBuffer
   * @param {AudioBuffer} audioBuffer
   * @param {object} options - Limiter options
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<{ audioBuffer: AudioBuffer }>}
   */
  async applyLimiter(audioBuffer, options = {}, onProgress = null) {
    const { channels, sampleRate, transferables } = this._extractChannelData(audioBuffer);

    const result = await this._send(
      'APPLY_LIMITER',
      {
        channels,
        sampleRate,
        ceilingLinear: options.ceilingLinear,
        lookaheadMs: options.lookaheadMs,
        releaseMs: options.releaseMs,
        kneeDB: options.kneeDB,
        preserveTransients: options.preserveTransients
      },
      onProgress,
      transferables
    );

    const limitedBuffer = this._createAudioBuffer(result.channels, sampleRate);

    return { audioBuffer: limitedBuffer };
  }

  /**
   * Render the full DSP chain (for cached buffer architecture)
   * Runs: Denoise → Exciter → Multiband Saturation → Transient → Normalize → Limit
   * @param {AudioBuffer} audioBuffer - Input audio buffer
   * @param {Object} settings - Processing settings
   * @param {string} mode - 'preview' (fast, heavy FX only) or 'export' (full chain)
   * @param {Function} onProgress - Progress callback (progress: 0-1, status: string)
   * @returns {Promise<{ audioBuffer: AudioBuffer, lufs: number }>}
   */
  async renderFullChain(audioBuffer, settings, mode = 'preview', onProgress = null) {
    const { channels, sampleRate, transferables } = this._extractChannelData(audioBuffer);

    const result = await this._send(
      'RENDER_FULL_CHAIN',
      { channels, sampleRate, settings, mode },
      onProgress,
      transferables
    );

    // Convert channels back to AudioBuffer
    const processedBuffer = this._createAudioBuffer(result.channels, sampleRate);

    return {
      audioBuffer: processedBuffer,
      lufs: result.lufs,
      measuredLufs: result.measuredLufs
    };
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isReady = false;

      // Reject any pending promises
      for (const [id, pending] of this.pending) {
        pending.reject(new Error('Worker terminated'));
      }
      this.pending.clear();

      console.log('[DSPWorker] Terminated');
    }
  }
}

// Singleton instance for convenience
let sharedInstance = null;

/**
 * Get the shared DSP worker instance
 * @returns {DSPWorkerInterface}
 */
export function getDSPWorker() {
  if (!sharedInstance) {
    sharedInstance = new DSPWorkerInterface();
  }
  return sharedInstance;
}

/**
 * Initialize the shared DSP worker
 * @returns {Promise<DSPWorkerInterface>}
 */
export async function initDSPWorker() {
  const worker = getDSPWorker();
  await worker.init();
  return worker;
}
