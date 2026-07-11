# Changelog

All notable changes to exifregistry are documented here. This project follows
[Semantic Versioning](https://semver.org).

## [1.4.0]

### Added

- `config` command: save defaults (sign preset, backup destination, frame color) in `~/.config/exifregistry/config.json`. Read, set, unset, list keys, or print the file path.
- `history` command: a global log of every operation that changed your files, newest first. `--clear` and `--path` supported.
- `completion` command: prints a bash, zsh or fish completion script.
- Guided backup in interactive mode ("Back up a folder"), with a plan preview, checksum-verified copy, and an offer to remember the destination.
- Homebrew install via a tap: `brew install daviarndt/tap/exifregistry`.
- Automated npm publishing on version tags via GitHub Actions.

### Changed

- `frame` reads a default color from `config frame.color`; `backup` and `restore` read a default destination from `config backup.to`.
- Documentation examples now use the Sony ecosystem (A7 IV, FE lenses, .ARW).

## [1.3.0]

### Added

- `stats`: library analytics (cameras, lenses, focal lengths, ISO, shots per month and hour) with Markdown export.
- `find`: query files by metadata (`ISO>3200`, `Model~sony`) and print matching paths, pipe-friendly.
- `timezone`: write the UTC offset tags cameras omit, explicitly or derived from each photo's GPS (offline).
- `diff`: compare two files' metadata side by side.
- `sign`: stamp Artist and Copyright in bulk, with a saved preset.
- `contact`: render a contact sheet (thumbnail grid with EXIF labels) as one JPEG.

## [1.2.0]

### Added

- `backup`: verified, append-only backups with a SHA-256 manifest. Changed files are versioned, deletions never propagate, and `--verify` detects silent corruption (bit rot).
- `restore`: restore from a backup, whole or by capture date, never overwriting differing files.

## [1.1.1]

### Fixed

- `frame` captions now render in the bundled Space Mono on every machine (vector paths via opentype.js, no fontconfig dependency).

## [1.1.0]

### Changed

- The CLI command is now `exifreg` (short); `exifregistry` remains as an alias.

## [1.0.0]

### Changed

- Project renamed from exif-kit to **exifregistry** (package, CLI, repository).

## [0.9.0]

### Added

- `show` detail levels: key fields by default, `--verbose` for every tag.
- Progress bars for frame, resize, dupes and backup-style batches.
- Root `--help` gained an examples section.

### Changed

- `frame` caption omits the camera model unless `--camera` is passed; `--size full` keeps native resolution; `--quality` is configurable.

## [0.8.0]

### Added

- `resize`: resize and convert into new files, including a `--max-size` target that finds the best quality that fits.

## [0.7.0]

### Added

- `frame`: render photos inside an aesthetic colored frame with an EXIF caption in Space Mono.

## [0.6.0]

### Added

- File organization suite: `organize`, `rename`, `ingest`, `split`, `dupes`. Dry-run by default, pairs and sidecars kept together, nothing overwritten, every batch undoable.

## [0.5.0]

### Added

- Markdown export for inspect reports.

## [0.4.0]

### Added

- `show` full report with curated fields first (including shutter count) followed by every remaining tag.

## [0.2.0] - [0.3.0]

### Changed

- Rewrote the tool in TypeScript on top of exiftool-vendored (ExifTool now bundled, no external install). Added `undo`.

## [0.1.0]

### Added

- Initial release: inspect and edit photo/video metadata (GPS, capture dates, modification dates) across JPEG, PNG, RAW and video.
