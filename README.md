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
- 🧭 **Interactive mode** — just run `exifkit` and follow the menus; zero flags to memorize
- 📦 **Self-contained** — ExifTool is bundled; `npm install` and you're done

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
