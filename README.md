# exifregistry

[![npm](https://img.shields.io/npm/v/exifregistry)](https://www.npmjs.com/package/exifregistry)
[![CI](https://github.com/daviarndt/exifregistry/actions/workflows/ci.yml/badge.svg)](https://github.com/daviarndt/exifregistry/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/exifregistry)](LICENSE)

**Website: [exifregistry.com](https://exifregistry.com)** · Support the project: [Buy me a coffee](https://buymeacoffee.com/daviarndtx) ☕

A friendly command-line toolkit for photographers and filmmakers to **inspect and edit photo/video metadata**: EXIF, GPS location, capture dates and more.

Works with JPEG, PNG, TIFF, HEIC, all major RAW formats (ARW, CR2/CR3, NEF, DNG, RAF, ORF...) and video containers (MP4, MOV, AVI...), powered by the battle-tested [ExifTool](https://exiftool.org), which comes **bundled**, so there is nothing else to install.

```
$ exifreg show DSC02481.ARW
┌────────────────────────────┬─────────────────────────┐
│ File                       │ DSC02481.ARW            │
│ Camera                     │ Sony A7 IV              │
│ Lens                       │ FE 35mm F1.8            │
│ ISO                        │ 400                     │
│ Aperture                   │ f/2.8                   │
│ Shutter                    │ 1/250s                  │
│ Taken (DateTimeOriginal)   │ 2024:06:01 14:30:00     │
│ GPS                        │ -23.550500, -46.633300  │
└────────────────────────────┴─────────────────────────┘
```

## Features

- 📷 **Inspect**: full report with what matters first (camera, **shutter count**, serial number, exposure, dates, GPS), followed by every remaining tag
- 📝 **Markdown export**: save any inspect report as a clean `.md` file to archive or share
- 📍 **GPS editing**: set location by pasting coordinates straight from Google/Apple Maps; remove GPS for privacy
- 🕑 **Date editing**: fix capture dates, modification dates, or **shift all dates** to fix a wrong camera clock/timezone
- 📋 **Copy metadata** between files (e.g. restore metadata after an export stripped it)
- 🧹 **Strip everything** for privacy-safe sharing
- ↩️ **Undo**: every edit keeps a backup by default; `exifreg undo` restores it
- 🗂 **Organize**: move/copy photos into folders derived from metadata: `{year}/{date}`, `{camera}/{date}`, even `{country}/{city}` (offline geolocation, no internet needed)
- ✏️ **Rename by pattern**: `{date}_{time}_{name}`, `{date}_{counter:3}` in shooting order
- 💾 **Ingest**: import memory cards into organized folders with SHA-256 copy verification
- 🔍 **Dupes**: find byte-identical duplicates before they clutter your library
- 🗄 **Backup**: verified, append-only backups with a SHA-256 manifest: changed files are versioned (never overwritten), deletions never propagate, and `--verify` detects silent corruption years later
- 📊 **Stats**: library analytics: which lenses and focal lengths you actually use, ISO habits, shots per month
- 🔎 **Find**: query files by metadata (`ISO>3200`, `Model~canon`) and pipe the paths anywhere
- 🌍 **Timezone**: write the UTC offset cameras forget, even deriving it from each photo's own GPS (offline)
- ✍️ **Sign**: stamp your authorship (Artist + Copyright) in bulk, with a saved preset
- 🪞 **Diff**: compare two files' metadata side by side
- 🖼 **Contact sheets**: a client-ready thumbnail grid with EXIF labels, one JPEG
- 🖼 **Frame**: re-render photos inside an aesthetic colored frame with their EXIF caption in Space Mono, ready for portfolios and social media (multiple aspect ratios, 21 named colors)
- 📐 **Resize & convert**: hit an exact file size ("make this 1MB") with the best quality that fits, resize by long edge/percent, convert JPEG/WebP/AVIF/PNG. Originals never touched, EXIF preserved
- ⚙️ **Config**: save defaults once (your name for `sign`, a backup drive, a favorite frame color) and stop repeating flags
- 📜 **History**: `exifreg history` shows every operation that changed your files
- ⌨️ **Shell completion**: bash, zsh and fish
- 🧭 **Interactive mode**: just run `exifreg` and follow the menus; zero flags to memorize (backup included)
- 📦 **Self-contained**: ExifTool is bundled; `npm install` and you're done

All file operations are **dry-run by default** (they print the plan; `--apply` executes), RAW+JPEG pairs and `.xmp`/`.aae` sidecars always travel together, nothing is ever overwritten, and every executed batch can be reverted with `--undo`.

## Installation

### Homebrew (macOS/Linux)

```bash
brew install daviarndt/tap/exifregistry
```

### npm

Requires [Node.js](https://nodejs.org) 20.18 or newer.

```bash
npm install -g exifregistry
```

Either way you get the **`exifreg`** command (`exifregistry` also works as a long alias).

Or straight from GitHub:

```bash
npm install -g github:daviarndt/exifregistry
```

Enable tab completion for your shell:

```bash
exifreg completion zsh  > "${fpath[1]}/_exifreg"   # zsh
exifreg completion bash >> ~/.bashrc               # bash (or a completion.d file)
exifreg completion fish >  ~/.config/fish/completions/exifreg.fish
```

Verify everything is ready:

```bash
exifreg doctor
```

## Usage

### Interactive mode (easiest)

Just run it bare and follow the menus:

```bash
exifreg
```

### Direct commands

```bash
# Inspect metadata (key fields: camera, shutter count, exposure, dates, GPS)
exifreg show photo.jpg
exifreg show photo.jpg -v           # verbose: also list ALL remaining tags
exifreg show *.ARW                  # globs work
exifreg show ~/Photos/trip -r       # whole folders, recursively
exifreg show photo.jpg --all        # flat alphabetical dump instead
exifreg show photo.jpg --json       # machine-readable
exifreg show photo.jpg --export     # also save the report as photo.metadata.md
exifreg show *.ARW -e shoot-day1.md # batch report into one custom .md file

# Set GPS location: paste coordinates straight from a maps app
exifreg gps photo.jpg --coords "-23.5505, -46.6333"
exifreg gps *.jpg --lat -23.5505 --lon -46.6333 --alt 760
exifreg gps clip.mp4 --coords "48.8566, 2.3522"   # videos too
exifreg gps photo.jpg --remove       # delete GPS data

# Edit dates
exifreg date photo.jpg --taken "2024-06-01 14:30"    # capture date
exifreg date photo.jpg --modified "2024-06-02 10:00" # edit date
exifreg date *.ARW --all "2024-06-01 14:30"          # all dates at once
exifreg date *.jpg --shift "+2h"                     # camera clock was 2h behind
exifreg date *.jpg --shift "-1d 30m"                 # shift back 1 day 30 min
exifreg date photo.jpg --taken "2024-06-01" --sync-file  # also sync file mtime

# Copy all metadata from one file to another
exifreg copy original.ARW exported.jpg

# Strip ALL metadata (privacy)
exifreg strip photo.jpg

# Made a mistake? Restore the automatic backup
exifreg undo photo.jpg
exifreg undo ~/Photos/trip           # restore every backup in a folder
```

### Organizing files

Every command below previews its plan first. Add `--apply` to execute.

```bash
# Move photos into folders derived from metadata
exifreg organize ~/Downloads/card --to ~/Photos --by "{year}/{date}"
exifreg organize . --by "{camera}/{date}"        # multi-camera shoots
exifreg organize . --by "{country}/{city}"       # GPS → city, fully offline
exifreg organize . --by "{year}/{month}" --copy  # copy instead of move
exifreg organize --undo --to ~/Photos            # revert the last batch

# Rename in place (RAW+JPEG pairs and sidecars keep matching names)
exifreg rename *.ARW -p "{date}_{time}_{name}"
exifreg rename . -p "wedding_{counter:3}"        # wedding_001.ARW, _002... in shooting order
exifreg rename --undo .

# Import a memory card: copies (never deletes from the card), verified
exifreg ingest /Volumes/EOS_R6 --to ~/Photos --by "{year}/{date}" --verify --apply

# Sort a messy folder into Photos/, RAW/ and Videos/
exifreg split ~/Downloads/mixed --apply

# Find byte-identical duplicates
exifreg dupes ~/Photos -r
exifreg dupes ~/Photos -r --delete --apply       # keeps the first of each group
```

### Library intelligence

```bash
exifreg stats ~/Photos -r                    # cameras, lenses, focals, ISO, months
exifreg stats ~/Photos -r -e stats.md        # export the report to Markdown

exifreg find . -w "ISO>3200"                 # paths only: pipe-friendly
exifreg find . -w "Model~sony" -w "DateTimeOriginal>=2026:07"   # conditions AND
exifreg find . -w "LensModel~35mm" | xargs exifreg frame -c white

exifreg diff original.ARW exported.jpg       # what changed? side-by-side table
```

Query operators: `=` `!=` `>` `>=` `<` `<=` and `~` (contains). Values compare numerically when both sides are numbers; EXIF dates compare chronologically as strings.

### Authorship and timezones

```bash
exifreg sign *.jpg --artist "Davi Arndt" --copyright "© {year} Davi Arndt" --save-preset
exifreg sign wedding/                        # next time, the preset is enough

exifreg timezone *.jpg --offset "-03:00"     # write OffsetTime* tags explicitly
exifreg timezone trip/ --from-gps            # derive each photo's offset from its GPS, offline
```

### Contact sheets

```bash
exifreg contact wedding/ -c 5                # 5 columns, wedding-contact.jpg
exifreg contact selects/ --out client.jpg    # RAW files use their embedded previews
```

### Defaults and history

Save the things you would otherwise type every time:

```bash
exifreg config sign.artist "Davi Arndt"                 # your name for `sign`
exifreg config sign.copyright "© {year} Davi Arndt"     # {year} expands on use
exifreg config backup.to "/Volumes/Backup"              # default backup drive
exifreg config frame.color "off-white"                  # default frame color
exifreg config                                          # show current settings
exifreg config --path                                   # where the file lives
```

See what you have done lately:

```bash
exifreg history            # recent operations, newest first
exifreg history -n 50      # more of them
```

### Backing up

Photographer-shaped backups: local, verified, and honest about their own health.

```bash
exifreg backup ~/Photos --to /Volumes/Backup           # preview what would be copied
exifreg backup ~/Photos --to /Volumes/Backup --apply   # copy, every file checksum-verified
exifreg backup --verify --to /Volumes/Backup           # re-hash everything: detects bit rot
exifreg backup --status --to /Volumes/Backup           # size, file count, capture span
exifreg backup ~/Photos --to /Volumes/BK --by "{year}/{date}" --apply   # organized layout

exifreg restore /Volumes/Backup                        # put missing originals back
exifreg restore /Volumes/Backup --taken 2026-07        # just one month's photos
exifreg restore /Volumes/Backup --to ./recovered       # or into a separate folder
```

How it keeps your archive safe:

- **Append-only.** Deleting a photo at the source never deletes it from the backup. Sync tools propagate mistakes; backups should not.
- **Versioned, never overwritten.** When a file changes, the previous backup copy is archived under `_versions/` before the new one lands.
- **Every copy is atomic and verified.** Files are written to a temporary name, hashed on both sides, then renamed into place. A power cut cannot leave a half-file with a valid name.
- **A manifest records everything**: source path, size, SHA-256, capture date and camera for every file. `--verify` re-hashes the whole backup against it, catching the silent disk corruption (bit rot) that most people only discover the day they need the backup.
- **Restore is careful too.** Existing files with different content are conflicts and are never overwritten, and a backup copy that fails its own checksum is refused rather than restored.
- Incremental runs are fast: unchanged files are skipped by size and date (`--paranoid` re-hashes everything if you want the slow, certain answer).

### Framing photos

Render photos inside a colored frame with their EXIF written underneath (or on top) in Space Mono, the classic "shot on" portfolio look:

```bash
exifreg frame photo.jpg                            # white frame, EXIF below
exifreg frame *.ARW -c off-white --ratio 4:5       # RAW works (embedded preview)
exifreg frame photo.jpg -c charcoal --ratio 1:1 --caption top
exifreg frame photo.jpg -c sage --caption none     # no text at all, just the frame
exifreg frame photo.jpg --camera                   # add the camera model to the caption
exifreg frame photo.jpg -c "#1E2A44" --ratio 9:16  # any hex works too
exifreg frame trip/ -c cream -o framed/            # whole folders, custom output dir
exifreg frame --colors                             # see all 21 colors + hex codes
```

The caption reads like `35mm · f/2.8 · 1/250s · ISO 400`, sized and centered automatically, with text color adapted to the frame; add `--camera` to include the camera model above it. Output is high-resolution JPEG (long edge 3000px by default; `--size full` keeps the photo at its **native resolution**, `--quality` up to 100), named `photo.framed.jpg`, and **keeps the original photo's EXIF**. Ratios: `1:1`, `4:5`, `9:16`, `3:2`, `16:9`, any `W:H`, or `original`. Margin is tunable with `--margin <pct>`.

Colors include everyday tones (white, off-white, cream, black, charcoal, gray...) and bolder ones (terracotta, sage, navy, burgundy, mustard, dusty-pink...). Space Mono is bundled under the [SIL Open Font License](assets/fonts/OFL.txt).

### Resizing & converting

Every resize writes a **new** file (`photo.resized.jpg`), the original is never modified, and the output keeps the original's EXIF:

```bash
exifreg resize photo.jpg --max-size 1mb     # best quality that fits in 1 MB
exifreg resize *.jpg -s 500kb -o web/       # batch, into a folder
exifreg resize photo.jpg --long 2048        # long edge to 2048px
exifreg resize photo.jpg --percent 50       # half size
exifreg resize photo.jpg -f webp            # convert format (jpeg/webp/avif/png/tiff)
exifreg resize photo.heic -f jpeg           # HEIC → JPEG (macOS)
exifreg resize photo.jpg --long 1600 -f webp --suffix web   # photo.web.webp
```

`--max-size` runs a binary search over encoding quality (mozjpeg) to find the **highest quality that fits** your target. No guessing quality numbers. If even minimum quality can't reach it, dimensions are gently reduced until it does. The success line tells you exactly what happened: `photo.jpg (12.3 MB) → photo.resized.jpg (0.98 MB, 6000x4000, q74)`.

**Pattern placeholders:** `{year}` `{month}` `{day}` `{date}` `{hour}` `{minute}` `{second}` `{time}` `{camera}` `{lens}` `{type}` `{name}` `{ext}` `{city}` `{region}` `{country}` `{counter}` (pad with `{counter:4}`). Dates come from `DateTimeOriginal` (real capture time), falling back to file dates only when the metadata is missing.

### Backups

Every write keeps the untouched original next to the edited file with an `_original` suffix (e.g. `photo.jpg_original`). Restore it any time with `exifreg undo`, or skip backups entirely with `--no-backup`.

## Supported formats

| Type   | Formats |
|--------|---------|
| Images | JPEG, PNG, TIFF, HEIC/HEIF, WebP |
| RAW    | ARW (Sony), CR2/CR3 (Canon), NEF/NRW (Nikon), DNG, RAF (Fujifilm), ORF (Olympus), RW2 (Panasonic), PEF (Pentax), and more |
| Video  | MP4, MOV, M4V, AVI, MKV, MTS/M2TS |

Anything ExifTool understands can be read; write support follows ExifTool's [supported formats](https://exiftool.org/#supported).

## Development

```bash
git clone https://github.com/daviarndt/exifregistry.git
cd exifregistry
npm install
npm run build
npm test
npm run dev -- show photo.jpg   # run from source
```

## License

[MIT](LICENSE)
