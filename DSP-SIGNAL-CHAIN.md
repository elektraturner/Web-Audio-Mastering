# DSP Signal Chain Documentation

## Overview

This document describes the audio processing signal chain for the Web Audio Mastering application. The app is built around an **export-parity master preview**: FX ON playback, metering, and export all use the same full-chain render.

## Processing Architecture

The app keeps three core buffers:

- `originalBuffer`: decoded input audio (DC offset removed)
- `normalizedBuffer`: LUFS-normalized copy used only for FX OFF (Level Match) and as a last-resort fallback
- `cachedRenderBuffer`: full-chain mastered preview buffer (includes soft clip + final true peak limiter when enabled)

**Where full-chain rendering happens:**

- Preferred: Web Worker full-chain render (`web/workers/dsp-worker.js`, via `renderFullChain(..., mode: 'export')`)
- Fallback: main-thread offline render (`web/ui/renderer.js`)

## Signal Flow

### Playback routing (FX toggle)

- **FX ON (Master Preview):** `cachedRenderBuffer` -> output (direct)
- **FX OFF (Bypass):**
  - Level Match ON: `normalizedBuffer` -> output
  - Level Match OFF: `originalBuffer` -> output

Meters follow the audio that is actually playing, so when FX ON is active the meter includes the final limiter behavior because the limiter is baked into the preview buffer.

### Full-chain processing order (Master Preview + Export)

This is the canonical ordering for parity (Worker path).

1. Input Gain (pre-FX)
2. Dynamic Processor (De-harsh) (optional)
3. Exciter (Add Air) (optional)
4. Multiband Saturation (Tape Warmth) (optional)
5. Multiband Transient Shaper (Add Punch) (optional)
6. Final Filters (cleanup)
   - HPF 30 Hz (only when Clean Low End is enabled)
   - LPF 18 kHz (always)
7. EQ (5-band) + Cut Mud (optional)
8. Glue Compression (optional)
9. Stereo Processing
   - M/S Stereo Width
   - Center Bass (mono bass below ~200 Hz) (optional)
10. LUFS normalization (gain-only; peak control happens below) (optional)
11. Mastering soft clipper (optional, when True Peak Limit is enabled)
12. Lookahead true peak limiter (optional, when True Peak Limit is enabled)

---

## 1. Dynamic Processor (De-harsh)

**File:** `web/lib/dsp/dynamic-processor.js`

**Purpose:** Intelligent multiband dynamics processor that combines:
- **Multiband Compression** (7 bands with per-band attack/release)
- **Dynamic EQ** (resonance detection and surgical peak cutting)
- **De-esser behavior** (fast attack in 3-12kHz range)

**Default:** ENABLED - Essential for AI-generated audio

### Frequency Bands

| Band | Frequency Range | Attack | Release | Threshold | Ratio | Purpose |
|------|-----------------|--------|---------|-----------|-------|---------|
| **Sub** | 0-80 Hz | 30ms | 200ms | -12 dB | 2:1 | Gentle control |
| **Bass** | 80-250 Hz | 20ms | 150ms | -15 dB | 2.5:1 | Tighten low end |
| **Low-mid** | 250-1000 Hz | 10ms | 100ms | -18 dB | 3:1 | Control mud |
| **Mid** | 1-3 kHz | 8ms | 80ms | -20 dB | 3.5:1 | Presence control |
| **Presence** | 3-6 kHz | 3ms | 40ms | -24 dB | 5:1 | De-esser zone |
| **Brilliance** | 6-12 kHz | 2ms | 30ms | -26 dB | 6:1 | AI artifact zone |
| **Air** | 12-20 kHz | 5ms | 50ms | -22 dB | 3:1 | High freq control |

### Key Features

**Resonance Detection:**
- Tracks running average spectrum per bin
- Identifies peaks >1.5x the local average
- Applies surgical dynamic cuts to resonant frequencies

**AI Artifact Mode:**
- Extra 50% more aggressive processing in 5-12kHz range
- Where AI audio artifacts typically live

**Mastering Preset (Default):**
- Dynamic EQ sensitivity: 0.4
- Max cut: -8 dB
- Soft knees (+4 dB wider)
- 70% wet / 30% dry for transparency

### Algorithm

1. Split signal into 7 frequency bands via FFT
2. Per-band envelope followers track signal level
3. Soft-knee gain computers determine compression
4. Resonance detector finds peaks sticking out from average
5. Dynamic EQ applies additional cuts to resonant bins
6. Overlap-add reconstruction with gain applied per-bin

---

## 2. Exciter (Add Air)

**File:** `web/lib/dsp/exciter.js`

**Purpose:** Adds harmonic content to high frequencies for enhanced clarity and presence ("air").

**Default:** ENABLED

**Parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| `hpfFreq` | 3500 Hz | High-pass filter cutoff |
| `hpfSlope` | 12 dB/oct | Filter slope (LR2) |
| `drive` | 2.0 | Saturation drive amount |
| `bias` | 0.1 | Bias for even harmonics |
| `mix` | 18% | Parallel mix (additive) |

**Algorithm:**
1. High-pass filter isolates frequencies above 3.5kHz
2. Tanh saturation with bias generates harmonics
3. Parallel addition: `output = dry + (saturated * mix)`

**Character:** Adds presence and sparkle without harshness.

---

## 3. Multiband Saturation (Tape Warmth)

**File:** `web/lib/dsp/multiband-saturation.js`

**Purpose:** Warm harmonic coloring with frequency-dependent saturation.

**Default:** ENABLED

**Crossover Frequencies:**
| Band | Frequency Range |
|------|-----------------|
| Low | 0 - 200 Hz |
| Mid | 200 Hz - 4 kHz |
| High | 4 kHz+ |

**Tape Warmth Preset:**
| Band | Drive | Bias | Mix | Gain |
|------|-------|------|-----|------|
| Low | 0.2 | 0.0 | 30% | 0 dB |
| Mid | 0.4 | 0.1 | 50% | 0 dB |
| High | 0.3 | 0.05 | 40% | 0 dB |

**Bypass Envelope:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| Threshold | -24 dB | Below this, bypass saturation |
| Knee | 6 dB | Soft transition zone |
| Window | 100 ms | Analysis window |
| Lookahead | 5 ms | Envelope opens before transients |

**Algorithm:**
1. Linkwitz-Riley LR4 crossover (-24 dB/oct) splits into 3 bands
2. Each band: `wet = (tanh(drive * (sample + bias)) - biasOffset) * makeup`
3. Bypass envelope prevents saturating quiet sections (noise amplification)
4. Bands summed back together

---

## 4. Multiband Transient Shaper (Add Punch)

**File:** `web/lib/dsp/multiband-transient.js`

**Purpose:** Per-band transient enhancement for punch and snap.

**Default:** ENABLED

**Crossover Frequencies:**
| Band | Frequency Range |
|------|-----------------|
| Low | 0 - 200 Hz |
| Mid | 200 Hz - 4 kHz |
| High | 4 kHz+ |

**Band Settings:**
| Band | Fast Attack | Fast Release | Slow Attack | Slow Release | Transient Gain | Sustain Gain |
|------|-------------|--------------|-------------|--------------|----------------|--------------|
| Low | 5 ms | 50 ms | 25 ms | 250 ms | +5 dB | -2 dB |
| Mid | 3 ms | 40 ms | 20 ms | 200 ms | +4 dB | 0 dB |
| High | 5 ms | 30 ms | 15 ms | 150 ms | 0 dB | 0 dB |

**Algorithm:**
1. Fast and slow envelope followers track signal
2. Transient detection: `diff = fastEnv - slowEnv`
3. Positive diff = transient -> boost
4. Negative diff = sustain -> cut (optional)
5. 20ms smoothing prevents artifacts

**Character:**
- Low band: Adds kick/bass punch
- Mid band: Adds snare/vocal attack
- High band: Left alone (avoid harshness)

---

## 5. Final Filters

**File:** `web/lib/dsp/final-filters.js` (applyFinalFilters)

**Purpose:** Clean up frequency extremes before loudness/peak control.

**Applied in the full-chain render:**
| Filter | Enabled When | Type | Frequency | Slope |
|--------|--------------|------|-----------|-------|
| HPF | Clean Low End | Highpass (biquad) | 30 Hz | 12 dB/oct |
| LPF | Always | Lowpass (1-pole) | 18 kHz | 6 dB/oct |

**Rationale:**
- HPF removes sub-bass rumble and DC offset remnants
- LPF removes ultrasonic content that can cause inter-sample peaks

---

## 6. LUFS Normalization

**File:** `web/lib/dsp/normalizer.js`, `web/lib/dsp/lufs.js`

**Purpose:** Normalize to target integrated loudness per ITU-R BS.1770-4.

**Default:** ENABLED

**Parameters:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| Target LUFS | -14 LUFS | User configurable (-16 to -6) |
| Ceiling | -1 dBTP | True peak ceiling |

**Algorithm (ITU-R BS.1770-4):**
1. K-weighting filters:
   - High shelf: 1681.97 Hz, +4 dB, Q=0.71
   - High pass: 38.14 Hz, Q=0.5
2. 400ms blocks with 75% overlap
3. Absolute gate: -70 LUFS
4. Relative gate: -10 dB below ungated mean
5. Integrated loudness from gated blocks

**Gain Application:**
1. Calculate required gain: `targetLUFS - currentLUFS`
2. Apply gain to all samples
3. Full-chain render applies gain only (`skipLimiter: true`); peak control happens in the soft clipper + final limiter stages below.

---

## 7. Soft Clipper

**File:** `web/lib/dsp/soft-clipper.js`

**Purpose:** Mastering-grade peak reduction using saturation curves with lookahead. Reduces the peak-to-loudness ratio before limiting, allowing louder masters without heavy limiter pumping.

**Default:** ENABLED (when True Peak Limit is on)

**Parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| `ceiling` | -1 dB | Target ceiling (matches limiter) |
| `lookaheadMs` | 0.5 ms | Very short lookahead for transients |
| `releaseMs` | 10 ms | Fast release for transparency |
| `drive` | 1.5 | Saturation intensity |

**Algorithm:**
1. **Gain Envelope Calculation:**
   - Scan all channels for peaks above threshold (ceiling + 3dB)
   - Calculate required gain reduction using tanh saturation curve
   - Apply lookahead window (0.5ms) to catch transients early
2. **Envelope Smoothing:**
   - Instant attack (gain reduction applied immediately)
   - Exponential release (10ms time constant)
   - Prevents gain pumping artifacts
3. **Final Safety Clip:**
   - Apply smoothed gain envelope to samples
   - Gentle tanh saturation for any remaining peaks above ceiling
   - Maximum 10% additional reduction for peaks

**Rationale:**
When normalizing quiet sources (e.g., -18 LUFS) to loud targets (e.g., -14 to -9 LUFS), the required gain can push peaks far above the ceiling. Without soft clipping, the limiter must do heavy lifting, causing pumping and squashing. The soft clipper gently shaves peaks before they hit the limiter, resulting in more transparent limiting.

---

## 8. True Peak Limiter

**File:** `web/lib/dsp/limiter.js`

**Purpose:** Transparent peak control with true-peak detection.

**Default:** ENABLED

**Parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| Ceiling | -1 dBTP | True peak ceiling (linear: 0.891) |
| Lookahead | 3 ms | See peaks before they arrive |
| Release | 100 ms | Gain recovery time |
| Knee | 3 dB | Soft knee width |
| Preserve Transients | true | Gentler limiting on transients |

**Two-Stage Architecture:**

**Stage 1: Lookahead Gain Reduction**
- 4x oversampled true-peak detection (Catmull-Rom interpolation)
- Gain envelope calculated with lookahead
- Smooth attack/release for transparency

**Stage 2: Soft-Knee Saturation Safety**
- Catches any remaining peaks
- Tanh sigmoid curve (no hard clipping)
- Oversampled to handle inter-sample peaks

**Transient Preservation:**
- Analyzes crest factor (peak/RMS ratio)
- High crest factor = transient
- Transients get slightly higher effective ceiling (+0.5 dB max)

---

## Constants Reference

**File:** `web/lib/dsp/constants.js`

### K-Weighting (ITU-R BS.1770-4)
```javascript
HIGH_SHELF_FREQ: 1681.97 Hz
HIGH_SHELF_GAIN: 4.0 dB
HIGH_SHELF_Q: 0.71
HIGH_PASS_FREQ: 38.14 Hz
HIGH_PASS_Q: 0.5
```

### LUFS Measurement
```javascript
BLOCK_SIZE: 400 ms
BLOCK_OVERLAP: 75%
ABSOLUTE_GATE: -70 LUFS
RELATIVE_GATE: -10 dB
LOUDNESS_OFFSET: -0.691
```

### Limiter
```javascript
CEILING: -1 dBTP (0.891 linear)
LOOKAHEAD: 3 ms
RELEASE: 100 ms
KNEE: 3 dB
PRESERVE_TRANSIENTS: true
```

### Audio
```javascript
SAMPLE_RATE: 48000 Hz (default export)
BIT_DEPTH: 24 (default export)
TARGET_LUFS: -14
```

---

## Default Settings Summary

| Feature | Default | UI Control |
|---------|---------|------------|
| De-harsh | ON | Quick Fix panel |
| Clean Low End | ON | Quick Fix panel |
| Add Punch | ON | Quick Fix panel |
| Add Air | ON | Polish panel |
| Tape Warmth | ON | Polish panel |
| Mono Bass | ON | Stereo panel |
| Normalize Loudness | ON | Loudness panel |
| True Peak Limit | ON | Loudness panel |
| Target LUFS | -14 | Loudness slider |
| Ceiling | -1 dB | Loudness fader |
| Stereo Width | 100% | Stereo slider |
| Sample Rate | 48 kHz | Output panel |
| Bit Depth | 24-bit | Output panel |

---

## File Structure

```text
web/lib/dsp/
├── index.js                  # Main exports (barrel file)
├── constants.js              # All constants
├── utils.js                  # Utility functions (dB conversion, etc.)
├── fft.js                    # FFT processor
├── lufs.js                   # LUFS measurement
├── true-peak.js              # True peak detection
├── normalizer.js             # LUFS normalization
├── limiter.js                # Lookahead limiter
├── soft-clipper.js           # Mastering soft clipper with lookahead
├── dynamic-processor.js      # Hybrid multiband dynamics (De-harsh)
├── exciter.js                # High-frequency exciter
├── saturation.js             # Single-band saturation
├── multiband-saturation.js   # 3-band saturation (Tape Warmth)
├── multiband-transient.js    # 3-band transient shaper (Add Punch)
├── transient.js              # Single-band transient shaper
├── stereo.js                 # Stereo processing (M/S, width)
├── dynamic-leveler.js        # Dynamic range leveling
├── multiband.js              # Multiband compression
└── dc-offset.js              # DC offset removal

web/workers/
├── worker-interface.js       # Worker messaging + progress plumbing
└── dsp-worker.js             # Full-chain render implementation (preview/export parity)

web/ui/
├── renderer.js               # Main-thread offline render fallback
└── encoder.js                # WAV encoder (supports async/progress)
```

---

## Version History

- **v1.3.3** - Master preview uses full-chain cached render (export parity); export WAV encoding reports smooth progress
- **v1.3.2** - Added mastering soft clipper with lookahead before limiter
- **v1.3.1** - Hybrid Dynamic Processor (De-harsh) replaces Tame Harshness
- **v1.3.0** - Removed FFmpeg dependency, pure JavaScript LUFS + Web Audio export
- **v1.2.x** - Multiband transient shaper, cached buffer architecture
- **v1.1.x** - Multiband saturation, exciter
- **v1.0.x** - Initial release with basic chain
