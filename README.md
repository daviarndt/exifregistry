# exif-kit

[![npm](https://img.shields.io/npm/v/exif-kit)](https://www.npmjs.com/package/exif-kit)
[![CI](https://github.com/daviarndt/exif-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/daviarndt/exif-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/exif-kit)](LICENSE)

A friendly command-line toolkit for photographers and filmmakers to **inspect and edit photo/video metadata** — EXIF, GPS location, capture dates and more.

Works with JPEG, PNG, TIFF, HEIC, all major RAW formats (CR2/CR3, NEF, ARW, DNG, RAF, ORF...) and video containers (MP4, MOV, AVI...), powered by the battle-tested [ExifTool](https://exiftool.org) — which comes **bundled**, so there is nothing else to install.

```
$ exifkit show IMG_4021.CR3
┌────────────────────────────┬─────────────────────────┐
│ File                       │ IMG_4021.CR3            │
│ Camera                     │ Canon EOS R6            │
│ Lens                       │ RF 35mm F1.8            │
│ ISO                        │ 400                     │
│ Aperture                   │ f/2.8                   │
│ Shutter                    │ 1/250s                  │
│ Taken (DateTimeOriginal)   │ 2024:06:01 14:30:00     │
│ GPS                        │ -23.550500, -46.633300  │
└────────────────────────────┴─────────────────────────┘
```

## Features

- 📷 **Inspect** — full report with what matters first (camera, **shutter count**, serial number, exposure, dates, GPS), followed by every remaining tag
- 📝 **Markdown export** — save any inspect report as a clean `.md` file to archive or share
- 📍 **GPS editing** — set location by pasting coordinates straight from Google/Apple Maps; remove GPS for privacy
- 🕑 **Date editing** — fix capture dates, modification dates, or **shift all dates** to fix a wrong camera clock/timezone
- 📋 **Copy metadata** between files (e.g. restore metadata after an export stripped it)
- 🧹 **Strip everything** for privacy-safe sharing
- ↩️ **Undo** — every edit keeps a backup by default; `exifkit undo` restores it
- 🗂 **Organize** — move/copy photos into folders derived from metadata: `{year}/{date}`, `{camera}/{date}`, even `{country}/{city}` (offline geolocation, no internet needed)
- ✏️ **Rename by pattern** — `{date}_{time}_{name}`, `{date}_{counter:3}` in shooting order
- 💾 **Ingest** — import memory cards into organized folders with SHA-256 copy verification
- 🔍 **Dupes** — find byte-identical duplicates before they clutter your library
- 🖼 **Frame** — re-render photos inside an aesthetic colored frame with their EXIF caption in Space Mono, ready for portfolios and social media (multiple aspect ratios, 21 named colors)
- 📐 **Resize & convert** — hit an exact file size ("make this 1MB") with the best quality that fits, resize by long edge/percent, convert JPEG/WebP/AVIF/PNG — originals never touched, EXIF preserved
- 🧭 **Interactive mode** — just run `exifkit` and follow the menus; zero flags to memorize
- 📦 **Self-contained** — ExifTool is bundled; `npm install` and you're done

All file operations are **dry-run by default** (they print the plan; `--apply` executes), RAW+JPEG pairs and `.xmp`/`.aae` sidecars always travel together, nothing is ever overwritten, and every executed batch can be reverted with `--undo`.

## Installation

Requires [Node.js](https://nodejs.org) 20.18 or newer.

```bash
npm install -g exif-kit
```

Or straight from GitHub:

```bash
npm install -g github:daviarndt/exif-kit
```

Verify everything is ready:

```bash
exifkit doctor
```

## Usage

### Interactive mode (easiest)

Just run it bare and follow the menus:

```bash
exifkit
```

### Direct commands

```bash
# Inspect metadata (key fields: camera, shutter count, exposure, dates, GPS)
exifkit show photo.jpg
exifkit show photo.jpg -v           # verbose: also list ALL remaining tags
exifkit show *.CR3                  # globs work
exifkit show ~/Photos/trip -r       # whole folders, recursively
exifkit show photo.jpg --all        # flat alphabetical dump instead
exifkit show photo.jpg --json       # machine-readable
exifkit show photo.jpg --export     # also save the report as photo.metadata.md
exifkit show *.CR3 -e shoot-day1.md # batch report into one custom .md file

# Set GPS location — paste coordinates straight from a maps app
exifkit gps photo.jpg --coords "-23.5505, -46.6333"
exifkit gps *.jpg --lat -23.5505 --lon -46.6333 --alt 760
exifkit gps clip.mp4 --coords "48.8566, 2.3522"   # videos too
exifkit gps photo.jpg --remove       # delete GPS data

# Edit dates
exifkit date photo.jpg --taken "2024-06-01 14:30"    # capture date
exifkit date photo.jpg --modified "2024-06-02 10:00" # edit date
exifkit date *.NEF --all "2024-06-01 14:30"          # all dates at once
exifkit date *.jpg --shift "+2h"                     # camera clock was 2h behind
exifkit date *.jpg --shift "-1d 30m"                 # shift back 1 day 30 min
exifkit date photo.jpg --taken "2024-06-01" --sync-file  # also sync file mtime

# Copy all metadata from one file to another
exifkit copy original.CR3 exported.jpg

# Strip ALL metadata (privacy)
exifkit strip photo.jpg

# Made a mistake? Restore the automatic backup
exifkit undo photo.jpg
exifkit undo ~/Photos/trip           # restore every backup in a folder
```

### Organizing files

Every command below previews its plan first — add `--apply` to execute.

```bash
# Move photos into folders derived from metadata
exifkit organize ~/Downloads/card --to ~/Photos --by "{year}/{date}"
exifkit organize . --by "{camera}/{date}"        # multi-camera shoots
exifkit organize . --by "{country}/{city}"       # GPS → city, fully offline
exifkit organize . --by "{year}/{month}" --copy  # copy instead of move
exifkit organize --undo --to ~/Photos            # revert the last batch

# Rename in place (RAW+JPEG pairs and sidecars keep matching names)
exifkit rename *.CR3 -p "{date}_{time}_{name}"
exifkit rename . -p "wedding_{counter:3}"        # wedding_001.CR3, _002... in shooting order
exifkit rename --undo .

# Import a memory card: copies (never deletes from the card), verified
exifkit ingest /Volumes/EOS_R6 --to ~/Photos --by "{year}/{date}" --verify --apply

# Sort a messy folder into Photos/, RAW/ and Videos/
exifkit split ~/Downloads/mixed --apply

# Find byte-identical duplicates
exifkit dupes ~/Photos -r
exifkit dupes ~/Photos -r --delete --apply       # keeps the first of each group
```

### Framing photos

Render photos inside a colored frame with their EXIF written underneath (or on top) in Space Mono — the classic "shot on" portfolio look:

```bash
exifkit frame photo.jpg                            # white frame, EXIF below
exifkit frame *.CR3 -c off-white --ratio 4:5       # RAW works (embedded preview)
exifkit frame photo.jpg -c charcoal --ratio 1:1 --caption top
exifkit frame photo.jpg -c "#1E2A44" --ratio 9:16  # any hex works too
exifkit frame trip/ -c cream -o framed/            # whole folders, custom output dir
exifkit frame --colors                             # see all 21 colors + hex codes
```

The caption reads like `CANON EOS R6` / `35mm · f/2.8 · 1/250s · ISO 400`, sized and centered automatically, with text color adapted to the frame. Output is high-resolution JPEG (long edge 3000px by default, `--size` to change; quality 95, 4:4:4), named `photo.framed.jpg`, and **keeps the original photo's EXIF**. Ratios: `1:1`, `4:5`, `9:16`, `3:2`, `16:9`, any `W:H`, or `original`. Margin is tunable with `--margin <pct>`.

Colors include everyday tones (white, off-white, cream, black, charcoal, gray...) and bolder ones (terracotta, sage, navy, burgundy, mustard, dusty-pink...). Space Mono is bundled under the [SIL Open Font License](assets/fonts/OFL.txt).

### Resizing & converting

Every resize writes a **new** file (`photo.resized.jpg`) — the original is never modified — and the output keeps the original's EXIF:

```bash
exifkit resize photo.jpg --max-size 1mb     # best quality that fits in 1 MB
exifkit resize *.jpg -s 500kb -o web/       # batch, into a folder
exifkit resize photo.jpg --long 2048        # long edge to 2048px
exifkit resize photo.jpg --percent 50       # half size
exifkit resize photo.jpg -f webp            # convert format (jpeg/webp/avif/png/tiff)
exifkit resize photo.heic -f jpeg           # HEIC → JPEG (macOS)
exifkit resize photo.jpg --long 1600 -f webp --suffix web   # photo.web.webp
```

`--max-size` runs a binary search over encoding quality (mozjpeg) to find the **highest quality that fits** your target — no guessing quality numbers. If even minimum quality can't reach it, dimensions are gently reduced until it does. The success line tells you exactly what happened: `photo.jpg (12.3 MB) → photo.resized.jpg (0.98 MB, 6000x4000, q74)`.

**Pattern placeholders:** `{year}` `{month}` `{day}` `{date}` `{hour}` `{minute}` `{second}` `{time}` `{camera}` `{lens}` `{type}` `{name}` `{ext}` `{city}` `{region}` `{country}` `{counter}` (pad with `{counter:4}`). Dates come from `DateTimeOriginal` (real capture time), falling back to file dates only when the metadata is missing.

### Backups

Every write keeps the untouched original next to the edited file with an `_original` suffix (e.g. `photo.jpg_original`). Restore it any time with `exifkit undo`, or skip backups entirely with `--no-backup`.

## Supported formats

| Type   | Formats |
|--------|---------|
| Images | JPEG, PNG, TIFF, HEIC/HEIF, WebP |
| RAW    | DNG, CR2, CR3 (Canon), NEF/NRW (Nikon), ARW (Sony), RAF (Fujifilm), ORF (Olympus), RW2 (Panasonic), PEF (Pentax), and more |
| Video  | MP4, MOV, M4V, AVI, MKV, MTS/M2TS |

Anything ExifTool understands can be read; write support follows ExifTool's [supported formats](https://exiftool.org/#supported).

## Development

```bash
git clone https://github.com/daviarndt/exif-kit.git
cd exif-kit
npm install
npm run build
npm test
npm run dev -- show photo.jpg   # run from source
```

## License

[MIT](LICENSE)
