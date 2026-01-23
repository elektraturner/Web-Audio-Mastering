# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.4] - 2026-01-21

### Fixed
- FX bypass could freeze the meter/scrubber after toggling while playing.
- Export progress could appear stuck during WAV writing; progress now updates smoothly through the encode stage.
- Browser warning spam from invalid compressor ratio values (clamped by Chromium).

### Changed
- Master preview (FX ON) uses a cached full-chain render for export parity; meters reflect the final limiter when enabled.
- GitHub Pages deployment builds and publishes `dist/` (bundled deps) instead of serving the raw `web/` folder.
- Repo structure cleanup: removed unused legacy `src/` and duplicate root assets in favor of `web/` as the single source of truth.

