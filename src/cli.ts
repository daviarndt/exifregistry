/**
 * Command-line interface for exifregistry.
 *
 * Running `exifregistry` with no arguments opens the interactive guided mode;
 * subcommands offer the same operations for direct/scripted use.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { confirm } from "@inquirer/prompts";
import { Command } from "commander";

import * as engine from "./engine.js";
import * as fields from "./fields.js";
import {
  clearProgress,
  describeFiles,
  printAllTags,
  printDryRunHint,
  printError,
  printFullReport,
  printPlan,
  printSuccess,
  showProgress,
} from "./display.js";
import {
  assertRootOutsideSources,
  collectMirrorCandidates,
  executeBackup,
  executeRestore,
  loadManifest,
  planBackup,
  planRestoreFromBackup,
  verifyBackup,
  type Candidate,
  type FileFacts,
} from "./backup.js";
import { findDupes } from "./dupes.js";
import {
  FRAME_COLORS,
  parseRatio,
  prepareSource,
  renderFrame,
  resolveColor,
  type CaptionPosition,
  type FrameColor,
  type Ratio,
} from "./frame.js";
import { defaultExportPath, metadataToMarkdown } from "./markdown.js";
import {
  defaultFormatFor,
  extensionFor,
  parseByteSize,
  parseFormat,
  resizeImage,
  type DimensionOptions,
  type OutputFormat,
} from "./resize.js";
import {
  executePlan,
  groupWithCompanions,
  journalBatch,
  planOrganize,
  planRename,
  undoLastBatch,
  type FileGroup,
  type MoveOp,
} from "./organizer.js";
import { captureDateParts, needsGeolocation, resolvePattern } from "./pattern.js";
import { expandPaths } from "./paths.js";
import { planRestore, restore } from "./undo.js";

const require = createRequire(import.meta.url);
const VERSION: string = require("../package.json").version;

/** Write a Markdown metadata report, guarding against clobbering non-.md files. */
export function writeMarkdownReport(
  reports: Parameters<typeof metadataToMarkdown>[0],
  target: string,
): void {
  if (!target.toLowerCase().endsWith(".md")) {
    throw new UserError(
      `Export file must end in .md (got "${target}") — this protects you ` +
        "from accidentally overwriting a photo or video.",
    );
  }
  fs.writeFileSync(target, metadataToMarkdown(reports, { version: VERSION }));
}

/** An error whose message is meant for the user (no stack trace). */
export class UserError extends Error {}

function fail(message: string): never {
  throw new UserError(message);
}

function resolveFiles(inputs: string[], recursive = false): string[] {
  let paths: string[];
  try {
    paths = expandPaths(inputs, recursive);
  } catch (err) {
    fail((err as Error).message);
  }
  if (paths.length === 0) fail("No supported photo or video files found.");
  return paths;
}

export interface FrameRunOptions {
  color: FrameColor;
  ratio: Ratio | null;
  caption: CaptionPosition;
  marginPct: number;
  size: number | "full";
  quality?: number;
  showCamera?: boolean;
  outDir?: string;
}

function parseCaptionPosition(input: string): CaptionPosition {
  const cleaned = input.trim().toLowerCase();
  if (cleaned === "bottom" || cleaned === "top" || cleaned === "none") {
    return cleaned;
  }
  throw new Error(`Caption position must be "bottom", "top" or "none" (got "${input}").`);
}

function reserveFrameOutput(source: string, outDir?: string): string {
  const dir = outDir ?? path.dirname(source);
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.basename(source, path.extname(source));
  let candidate = path.join(dir, `${stem}.framed.jpg`);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${stem}.framed_${i}.jpg`);
  }
  return candidate;
}

/** Render frames for a batch of photos (shared by CLI and interactive mode). */
export async function frameFiles(
  paths: string[],
  options: FrameRunOptions,
): Promise<void> {
  const metadata = await engine.read(paths);
  for (let i = 0; i < paths.length; i++) {
    const source = paths[i];
    showProgress(i + 1, paths.length, path.basename(source));
    const prepared = await prepareSource(source);
    try {
      const out = reserveFrameOutput(source, options.outDir);
      await renderFrame(prepared.path, metadata[i], out, options);
      try {
        // The render carries the original photo's EXIF; pixels are already
        // upright, so the copied Orientation tag is reset.
        await engine.applyEdit(
          [out],
          { tags: {}, extraArgs: ["-TagsFromFile", source, "-all:all", "-Orientation#=1"] },
          { backup: false },
        );
      } catch {
        /* metadata copy is best-effort; the render itself succeeded */
      }
      printSuccess(`Framed ${path.basename(source)} → ${out}`);
    } finally {
      prepared.cleanup();
    }
  }
}

export interface ResizeRunOptions {
  dims: DimensionOptions;
  format?: OutputFormat;
  quality?: number;
  maxBytes?: number;
  outDir?: string;
  suffix: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Resize/convert a batch of photos (shared by CLI and interactive mode). */
export async function resizeFiles(
  paths: string[],
  options: ResizeRunOptions,
): Promise<void> {
  for (let i = 0; i < paths.length; i++) {
    const source = paths[i];
    showProgress(i + 1, paths.length, path.basename(source));
    const prepared = await prepareSource(source);
    try {
      const format =
        options.format ?? defaultFormatFor(path.extname(source));
      const result = await resizeImage(prepared.path, options.dims, format, {
        quality: options.quality,
        maxBytes: options.maxBytes,
      });

      const dir = options.outDir ?? path.dirname(source);
      fs.mkdirSync(dir, { recursive: true });
      const stem = path.basename(source, path.extname(source));
      const dotSuffix = options.suffix ? `.${options.suffix}` : "";
      let out = path.join(dir, `${stem}${dotSuffix}${extensionFor(format)}`);
      for (let i = 1; fs.existsSync(out) || path.resolve(out) === path.resolve(source); i++) {
        out = path.join(dir, `${stem}${dotSuffix}_${i}${extensionFor(format)}`);
      }
      fs.writeFileSync(out, result.buffer);

      try {
        // Carry the original EXIF over; pixels are upright, reset Orientation.
        await engine.applyEdit(
          [out],
          { tags: {}, extraArgs: ["-TagsFromFile", source, "-all:all", "-Orientation#=1"] },
          { backup: false },
        );
      } catch {
        /* metadata copy is best-effort */
      }

      const before = fs.statSync(source).size;
      const after = fs.statSync(out).size;
      printSuccess(
        `${path.basename(source)} (${formatBytes(before)}) → ` +
          `${path.basename(out)} (${formatBytes(after)}, ${result.width}x${result.height}` +
          `${result.quality !== undefined ? `, q${result.quality}` : ""})`,
      );
    } finally {
      prepared.cleanup();
    }
  }
}

/** Group files with their companions and read pattern metadata for primaries. */
export async function prepareGroups(
  paths: string[],
  pattern: string,
): Promise<{ groups: FileGroup[]; metadataByPrimary: Map<string, engine.Metadata> }> {
  const groups = groupWithCompanions(paths);
  const primaries = groups.map((g) => g.primary);
  const metadata = await engine.read(primaries, {
    geolocation: needsGeolocation(pattern),
  });
  const metadataByPrimary = new Map(primaries.map((p, i) => [p, metadata[i]]));
  // Chronological order so {counter} follows shooting order.
  groups.sort((a, b) => {
    const dateOf = (g: FileGroup) => {
      const d = captureDateParts(metadataByPrimary.get(g.primary) ?? {});
      return d ? `${d.year}${d.month}${d.day}${d.hour}${d.minute}${d.second}` : "9";
    };
    return dateOf(a).localeCompare(dateOf(b)) || a.primary.localeCompare(b.primary);
  });
  return { groups, metadataByPrimary };
}

async function runMovePlan(
  command: string,
  ops: MoveOp[],
  opts: { apply: boolean; copy?: boolean; verify?: boolean; journalRoot: string },
): Promise<void> {
  if (ops.length === 0) {
    console.log("Nothing to do — everything is already in place.");
    return;
  }
  const verb = opts.copy ? "copy" : command === "rename" ? "rename" : "move";
  printPlan(ops, verb);
  if (!opts.apply) {
    printDryRunHint();
    return;
  }
  const done = await executePlan(ops, {
    copy: opts.copy,
    verify: opts.verify,
    onProgress: (current, total, op) =>
      showProgress(current, total, path.basename(op.source)),
  });
  clearProgress();
  journalBatch(opts.journalRoot, command, done, opts.copy ?? false);
  printSuccess(
    `${done.length} file(s) ${opts.copy ? "copied" : command === "rename" ? "renamed" : "moved"}. ` +
      `Undo with: exifreg ${command} --undo${command === "rename" ? " <folder>" : ""}`,
  );
}

function runUndoBatch(root: string): void {
  const batch = undoLastBatch(root);
  if (!batch) {
    fail(`No operations to undo in "${root}" (no journal found).`);
  }
  printSuccess(
    `Undid last ${batch.command} (${batch.ops.length} file(s) ` +
      `${batch.copy ? "removed" : "moved back"}).`,
  );
}

/** GPS lives in different tags for images vs QuickTime videos: two passes. */
async function applyGroupedGps(
  paths: string[],
  backup: boolean,
  build: (video: boolean) => fields.Edit,
): Promise<void> {
  const images = paths.filter((p) => !fields.isVideo(p));
  const videos = paths.filter((p) => fields.isVideo(p));
  if (images.length > 0) await engine.applyEdit(images, build(false), { backup });
  if (videos.length > 0) await engine.applyEdit(videos, build(true), { backup });
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("exifreg")
    .description(
      "Photo & video toolkit: inspect/edit metadata (EXIF, GPS, dates), " +
        "organize files, frame and resize photos.\n" +
        "Run bare `exifreg` for the interactive guided mode.",
    )
    .version(`exifregistry ${VERSION}`, "-V, --version")
    .addHelpText(
      "after",
      `
Examples:
  $ exifreg                                           interactive mode (menus)
  $ exifreg show photo.jpg                            key metadata (add -v for all tags)
  $ exifreg gps *.jpg --coords "-23.5505, -46.6333"   set GPS (paste from a maps app)
  $ exifreg date *.jpg --shift "+2h"                  fix a wrong camera clock
  $ exifreg organize card/ --to ~/Photos --by "{year}/{date}" --apply
  $ exifreg rename . -p "trip_{counter:3}" --apply    rename in shooting order
  $ exifreg ingest /Volumes/SD --to ~/Photos --verify --apply
  $ exifreg frame photo.jpg -c off-white --ratio 4:5  aesthetic EXIF frame
  $ exifreg resize photo.jpg --max-size 1mb           best quality under 1 MB
  $ exifreg backup ~/Photos --to /Volumes/BK --apply  verified append-only backup
  $ exifreg backup --verify --to /Volumes/BK          detect silent corruption
  $ exifreg undo photo.jpg                            restore a metadata backup

Run "exifreg <command> --help" for all options of a command.
File operations preview a plan first; add --apply to execute. Edits keep
backups by default. Full docs: https://github.com/daviarndt/exifregistry`,
    )
    .action(async () => {
      const { runInteractive } = await import("./interactive.js");
      await runInteractive();
    });

  program
    .command("show")
    .description("Show metadata for one or more files.")
    .argument("<files...>", "files, folders or glob patterns")
    .option("-v, --verbose", "also list every remaining tag ('All other tags')")
    .option("-a, --all", "flat alphabetical dump of every tag (raw values)")
    .option("--json", "output raw JSON (machine-readable)")
    .option("-r, --recursive", "recurse into subfolders")
    .option(
      "-e, --export [file.md]",
      "also export the full report to a Markdown file (default: <name>.metadata.md)",
    )
    .action(async (files: string[], opts) => {
      const paths = resolveFiles(files, opts.recursive);
      if (opts.json) {
        console.log(JSON.stringify(await engine.read(paths), null, 2));
        return;
      }
      const metadata = await engine.readFull(paths);
      for (const item of metadata) {
        if (opts.all) printAllTags(item.pretty);
        else printFullReport(item, opts.verbose);
      }
      if (opts.export) {
        const target =
          opts.export === true ? defaultExportPath(paths) : String(opts.export);
        writeMarkdownReport(metadata, target);
        printSuccess(`Exported metadata report to ${target}.`);
      }
    });

  program
    .command("gps")
    .description("Set (or remove) the GPS location of photos and videos.")
    .argument("<files...>", "files, folders or glob patterns")
    .option("--lat <degrees>", "latitude in decimal degrees", parseFloat)
    .option("--lon <degrees>", "longitude in decimal degrees", parseFloat)
    .option(
      "-c, --coords <coords>",
      'coordinates pasted from a maps app, e.g. "-23.5505, -46.6333"',
    )
    .option("--alt <meters>", "altitude in meters", parseFloat)
    .option("--remove", "delete all GPS data instead")
    .option("--no-backup", "do not keep '_original' backup copies")
    .action(async (files: string[], opts) => {
      const paths = resolveFiles(files);
      let lat: number | undefined = opts.lat;
      let lon: number | undefined = opts.lon;

      if (opts.remove) {
        if (lat !== undefined || lon !== undefined || opts.coords) {
          fail("--remove cannot be combined with coordinates.");
        }
        await applyGroupedGps(paths, opts.backup, fields.gpsRemoveEdit);
        printSuccess(`Removed GPS data from ${describeFiles(paths)}.`);
        return;
      }

      if (opts.coords) {
        if (lat !== undefined || lon !== undefined) {
          fail("Use either --coords or --lat/--lon, not both.");
        }
        try {
          [lat, lon] = fields.parseCoordinates(opts.coords);
        } catch (err) {
          fail((err as Error).message);
        }
      }
      if (lat === undefined || lon === undefined) {
        fail('Provide a location with --coords "lat, lon" (or --lat and --lon).');
      }
      try {
        fields.validateCoordinates(lat, lon);
      } catch (err) {
        fail((err as Error).message);
      }

      await applyGroupedGps(paths, opts.backup, (video) =>
        fields.gpsEdit(lat, lon, opts.alt, video),
      );
      printSuccess(`Set GPS of ${describeFiles(paths)} to ${lat}, ${lon}.`);
    });

  program
    .command("date")
    .description("Edit capture/modification dates, or shift them to fix timezones.")
    .argument("<files...>", "files, folders or glob patterns")
    .option("-t, --taken <datetime>", 'capture date, e.g. "2024-06-01 14:30"')
    .option("-m, --modified <datetime>", "metadata modification date (ModifyDate)")
    .option("--all <datetime>", "set taken, created and modified dates at once")
    .option(
      "-s, --shift <amount>",
      'shift all dates, e.g. "+2h", "-30m", "+1d 2h30m" (timezone fixes)',
    )
    .option(
      "--sync-file",
      "also set the file's modification date to match the capture date",
    )
    .option("--no-backup", "do not keep '_original' backup copies")
    .action(async (files: string[], opts) => {
      const paths = resolveFiles(files);
      const edits: fields.Edit[] = [];
      try {
        if (opts.all && (opts.taken || opts.modified)) {
          fail("--all already covers --taken and --modified; use one or the other.");
        }
        if (opts.taken) {
          edits.push(fields.captureDateEdit(fields.parseDatetime(opts.taken)));
        }
        if (opts.modified) {
          edits.push(fields.modifyDateEdit(fields.parseDatetime(opts.modified)));
        }
        if (opts.all) {
          edits.push(fields.allDatesEdit(fields.parseDatetime(opts.all)));
        }
        if (opts.shift) {
          if (opts.taken || opts.modified || opts.all) {
            fail("--shift cannot be combined with absolute dates.");
          }
          const [operator, amount] = fields.parseShift(opts.shift);
          edits.push(fields.shiftEdit(operator, amount));
        }
      } catch (err) {
        if (err instanceof UserError) throw err;
        fail((err as Error).message);
      }

      const edit = fields.mergeEdits(edits);
      if (opts.syncFile) edit.extraArgs.push(...fields.syncFileDateArgs());

      if (Object.keys(edit.tags).length === 0 && edit.extraArgs.length === 0) {
        fail("Nothing to do. Use --taken, --modified, --all, --shift or --sync-file.");
      }

      await engine.applyEdit(paths, edit, { backup: opts.backup });
      printSuccess(`Updated dates on ${describeFiles(paths)}.`);
    });

  program
    .command("copy")
    .description("Copy all metadata from one file onto others (e.g. after export).")
    .argument("<source>", "file to copy metadata from")
    .argument("<targets...>", "files to copy metadata onto")
    .option("--no-backup", "do not keep '_original' backup copies")
    .action(async (source: string, targets: string[], opts) => {
      const [sourcePath] = resolveFiles([source]);
      const targetPaths = resolveFiles(targets);
      await engine.copyMetadata(sourcePath, targetPaths, { backup: opts.backup });
      printSuccess(
        `Copied metadata from ${describeFiles([sourcePath])} to ${describeFiles(targetPaths)}.`,
      );
    });

  program
    .command("strip")
    .description("Remove ALL metadata (camera, dates, GPS) — for privacy-safe sharing.")
    .argument("<files...>", "files, folders or glob patterns")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--no-backup", "do not keep '_original' backup copies")
    .action(async (files: string[], opts) => {
      const paths = resolveFiles(files);
      if (!opts.yes) {
        const confirmed = await confirm({
          message: `Remove all metadata from ${describeFiles(paths)}?`,
          default: false,
        });
        if (!confirmed) return;
      }
      await engine.stripMetadata(paths, { backup: opts.backup });
      printSuccess(`Stripped all metadata from ${describeFiles(paths)}.`);
    });

  program
    .command("undo")
    .description("Restore files from the '_original' backups left by edits.")
    .argument("<files...>", "edited files, their '_original' backups, or folders")
    .action(async (files: string[]) => {
      let plans;
      try {
        plans = planRestore(files);
      } catch (err) {
        fail((err as Error).message);
      }
      if (plans.length === 0) {
        fail("No '_original' backups found to restore.");
      }
      restore(plans);
      printSuccess(
        `Restored ${describeFiles(plans.map((p) => p.target))} from backup.`,
      );
    });

  program
    .command("organize")
    .description("Move (or copy) photos/videos into folders derived from their metadata.")
    .argument("[paths...]", "files, folders or glob patterns")
    .option("--to <dir>", "destination root the folders are created under", ".")
    .option(
      "--by <pattern>",
      'folder pattern, e.g. "{year}/{date}", "{camera}/{date}", "{city}/{date}"',
      "{year}/{date}",
    )
    .option("--copy", "copy instead of move")
    .option("-r, --recursive", "recurse into subfolders")
    .option("--apply", "execute the plan (default is a dry-run preview)")
    .option("--undo", "undo the last organize/ingest executed under --to")
    .action(async (paths: string[], opts) => {
      if (opts.undo) {
        runUndoBatch(opts.to);
        return;
      }
      if (paths.length === 0) {
        fail("Tell me what to organize, e.g.: exifreg organize ~/Downloads/card --to ~/Photos");
      }
      const files = resolveFiles(paths, opts.recursive);
      const { groups, metadataByPrimary } = await prepareGroups(files, opts.by);
      let ops: MoveOp[];
      try {
        ops = planOrganize(groups, metadataByPrimary, {
          pattern: opts.by,
          destRoot: opts.to,
        });
      } catch (err) {
        fail((err as Error).message);
      }
      await runMovePlan("organize", ops, {
        apply: opts.apply,
        copy: opts.copy,
        journalRoot: opts.to,
      });
    });

  program
    .command("rename")
    .description("Rename photos/videos in place using a metadata pattern.")
    .argument("[files...]", "files, folders or glob patterns")
    .option(
      "-p, --pattern <pattern>",
      'filename pattern, e.g. "{date}_{time}_{name}" or "{date}_{counter:3}"',
      "{date}_{time}_{name}",
    )
    .option("-r, --recursive", "recurse into subfolders")
    .option("--apply", "execute the plan (default is a dry-run preview)")
    .option("--undo", "undo the last rename journaled in the given folder")
    .action(async (files: string[], opts) => {
      if (opts.undo) {
        runUndoBatch(files[0] ?? ".");
        return;
      }
      if (files.length === 0) {
        fail('Tell me what to rename, e.g.: exifreg rename *.CR3 -p "{date}_{counter:3}"');
      }
      const paths = resolveFiles(files, opts.recursive);
      const { groups, metadataByPrimary } = await prepareGroups(paths, opts.pattern);
      let ops: MoveOp[];
      try {
        ops = planRename(groups, metadataByPrimary, { pattern: opts.pattern });
      } catch (err) {
        fail((err as Error).message);
      }
      const journalRoot =
        ops.length > 0 ? path.dirname(ops[0].source) : ".";
      await runMovePlan("rename", ops, {
        apply: opts.apply,
        journalRoot,
      });
    });

  program
    .command("ingest")
    .description("Import from a memory card: copy into organized folders, verified.")
    .argument("<source>", "card/folder to import from")
    .option("--to <dir>", "destination root (required)", "")
    .option("--by <pattern>", "folder pattern under --to", "{year}/{date}")
    .option("--verify", "verify each copy with SHA-256 checksums")
    .option("--move", "move instead of copy (default copies; the card keeps its files)")
    .option("--apply", "execute the plan (default is a dry-run preview)")
    .option("--undo", "undo the last ingest executed under --to")
    .action(async (source: string, opts) => {
      if (!opts.to) fail("Tell me where to import to with --to <dir>.");
      if (opts.undo) {
        runUndoBatch(opts.to);
        return;
      }
      const files = resolveFiles([source], true);
      const { groups, metadataByPrimary } = await prepareGroups(files, opts.by);
      let ops: MoveOp[];
      try {
        ops = planOrganize(groups, metadataByPrimary, {
          pattern: opts.by,
          destRoot: opts.to,
        });
      } catch (err) {
        fail((err as Error).message);
      }
      await runMovePlan("ingest", ops, {
        apply: opts.apply,
        copy: !opts.move,
        verify: opts.verify,
        journalRoot: opts.to,
      });
    });

  program
    .command("split")
    .description("Sort a mixed folder into Photos/, RAW/ and Videos/ subfolders.")
    .argument("<dir>", "folder to split")
    .option("--apply", "execute the plan (default is a dry-run preview)")
    .option("--undo", "undo the last split executed in this folder")
    .action(async (dir: string, opts) => {
      if (opts.undo) {
        runUndoBatch(dir);
        return;
      }
      const files = resolveFiles([dir]);
      const { groups, metadataByPrimary } = await prepareGroups(files, "{type}");
      const ops = planOrganize(groups, metadataByPrimary, {
        pattern: "{type}",
        destRoot: dir,
      });
      await runMovePlan("split", ops, { apply: opts.apply, journalRoot: dir });
    });

  program
    .command("dupes")
    .description("Find byte-identical duplicate files (safe: reports only by default).")
    .argument("<paths...>", "files, folders or glob patterns")
    .option("-r, --recursive", "recurse into subfolders")
    .option("--delete", "plan deletion of duplicates (keeps the first of each group)")
    .option("--apply", "with --delete: actually delete (there is NO undo for this)")
    .action(async (paths: string[], opts) => {
      const files = resolveFiles(paths, opts.recursive);
      const groups = await findDupes(files, (current, total, file) =>
        showProgress(current, total, path.basename(file)),
      );
      clearProgress();
      if (groups.length === 0) {
        printSuccess("No duplicates found.");
        return;
      }
      let wasted = 0;
      for (const group of groups) {
        console.log(`${group.files[0]}  (${group.files.length} identical copies)`);
        for (const file of group.files.slice(1)) {
          console.log(`  = ${file}`);
          wasted += group.size;
        }
      }
      console.log(
        `${groups.length} duplicate group(s), ` +
          `${(wasted / 1024 / 1024).toFixed(1)} MB reclaimable.`,
      );
      if (!opts.delete) return;
      const doomed = groups.flatMap((g) => g.files.slice(1));
      if (!opts.apply) {
        console.log(`Would delete ${doomed.length} file(s), keeping the first of each group.`);
        printDryRunHint();
        return;
      }
      const confirmed = await confirm({
        message: `Permanently delete ${doomed.length} duplicate file(s)? This cannot be undone.`,
        default: false,
      });
      if (!confirmed) return;
      for (const file of doomed) fs.rmSync(file);
      printSuccess(`Deleted ${doomed.length} duplicate file(s).`);
    });

  program
    .command("frame")
    .description("Re-render photos inside an aesthetic colored frame with an EXIF caption.")
    .argument("[files...]", "photos (RAW works too — the embedded preview is used)")
    .option("-c, --color <color>", 'frame color by name (or "#RRGGBB")', "white")
    .option("--ratio <ratio>", '"1:1", "4:5", "9:16", "3:2"... or "original"', "original")
    .option("--caption <position>", "EXIF caption: bottom, top or none", "bottom")
    .option("--camera", "include the camera model in the caption")
    .option("--margin <percent>", "margin around the photo (% of frame)", "6")
    .option(
      "--size <pixels|full>",
      'long edge of the final render; "full" keeps the photo at native resolution',
      "3000",
    )
    .option("-q, --quality <1-100>", "JPEG quality of the render", "95")
    .option("-o, --out <dir>", "output folder (default: next to each photo)")
    .option("--colors", "list all frame colors with their hex codes")
    .action(async (files: string[], opts) => {
      if (opts.colors) {
        for (const c of FRAME_COLORS) {
          const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
          console.log(
            `\u001b[48;2;${r};${g};${b}m      \u001b[0m  ${c.name.padEnd(12)} ${c.hex}`,
          );
        }
        return;
      }
      if (files.length === 0) {
        fail('Tell me what to frame, e.g.: exifreg frame photo.jpg -c off-white --ratio 4:5');
      }
      let options: FrameRunOptions;
      try {
        options = {
          color: resolveColor(opts.color),
          ratio: parseRatio(opts.ratio),
          caption: parseCaptionPosition(opts.caption),
          marginPct: Number(opts.margin),
          size: opts.size === "full" ? "full" : Number(opts.size),
          quality: Number(opts.quality),
          showCamera: Boolean(opts.camera),
          outDir: opts.out,
        };
      } catch (err) {
        fail((err as Error).message);
      }
      if (
        !Number.isFinite(options.marginPct) ||
        (options.size !== "full" && !Number.isFinite(options.size)) ||
        !Number.isFinite(options.quality)
      ) {
        fail('--margin and --quality must be numbers; --size a number or "full".');
      }
      const paths = resolveFiles(files).filter((p) => !fields.isVideo(p));
      if (paths.length === 0) fail("No photos to frame (videos are not supported).");
      await frameFiles(paths, options);
    });

  program
    .command("resize")
    .description("Resize/convert photos into NEW files (originals are never touched).")
    .argument("<files...>", "photos (JPEG, PNG, WebP, TIFF, HEIC; RAW uses its preview)")
    .option("--long <px>", "resize the long edge to this many pixels", parseFloat)
    .option("--width <px>", "fit within this width", parseFloat)
    .option("--height <px>", "fit within this height", parseFloat)
    .option("--percent <n>", "scale by percentage", parseFloat)
    .option(
      "-s, --max-size <size>",
      'target file size, e.g. "1mb" or "500kb" (finds the best quality that fits)',
    )
    .option("-f, --format <fmt>", "convert: jpeg, png, webp, avif, tiff (default: keep)")
    .option("-q, --quality <1-100>", "encoding quality (default 85)", parseFloat)
    .option("-o, --out <dir>", "output folder (default: next to each photo)")
    .option("--suffix <text>", "inserted before the extension", "resized")
    .action(async (files: string[], opts) => {
      let options: ResizeRunOptions;
      try {
        options = {
          dims: {
            long: opts.long,
            width: opts.width,
            height: opts.height,
            percent: opts.percent,
          },
          format: opts.format ? parseFormat(opts.format) : undefined,
          quality: opts.quality,
          maxBytes: opts.maxSize ? parseByteSize(opts.maxSize) : undefined,
          outDir: opts.out,
          suffix: opts.suffix,
        };
      } catch (err) {
        fail((err as Error).message);
      }
      const hasDims =
        opts.long !== undefined || opts.width !== undefined ||
        opts.height !== undefined || opts.percent !== undefined;
      if (!hasDims && !options.maxBytes && !options.format && opts.quality === undefined) {
        fail(
          "Nothing to do. Use --long, --width/--height, --percent, " +
            "--max-size, --quality or --format.",
        );
      }
      const paths = resolveFiles(files).filter((p) => !fields.isVideo(p));
      if (paths.length === 0) fail("No photos to resize (videos are not supported).");
      try {
        await resizeFiles(paths, options);
      } catch (err) {
        fail((err as Error).message);
      }
    });

  program
    .command("backup")
    .description("Verified, append-only backup of photo folders (SHA-256 manifest).")
    .argument("[sources...]", "folders (or files) to back up")
    .option("--to <dir>", "backup destination root (e.g. an external drive)")
    .option("--by <pattern>", 'organize the backup by pattern (e.g. "{year}/{date}") instead of mirroring folders')
    .option("--paranoid", "re-hash every file instead of trusting size and date")
    .option("--verify", "re-hash the whole backup at --to against its manifest (bit-rot check)")
    .option("--status", "show a summary of the backup at --to")
    .option("--apply", "execute the plan (default is a dry-run preview)")
    .action(async (sources: string[], opts) => {
      if (!opts.to) fail("Tell me where the backup lives with --to <dir>.");

      if (opts.verify) {
        const result = await verifyBackup(opts.to, {
          onProgress: (c, t, f) => showProgress(c, t, f),
        });
        clearProgress();
        if (result.checked === 0) fail(`No backup manifest found at "${opts.to}".`);
        console.log(`${result.ok}/${result.checked} files verified OK.`);
        for (const rel of result.corrupted) {
          printError(`CORRUPTED (bytes changed since backup): ${rel}`);
        }
        for (const rel of result.missingFiles) {
          printError(`MISSING from backup: ${rel}`);
        }
        if (result.corrupted.length + result.missingFiles.length > 0) {
          fail(
            `${result.corrupted.length + result.missingFiles.length} problem(s) found. ` +
              "The affected files should be re-copied from a healthy source.",
          );
        }
        printSuccess("Backup is healthy: every file matches its recorded checksum.");
        return;
      }

      if (opts.status) {
        const manifest = loadManifest(opts.to);
        const entries = Object.values(manifest.entries);
        if (entries.length === 0) fail(`No backup manifest found at "${opts.to}".`);
        const bytes = entries.reduce((n, e) => n + e.size, 0);
        const versions = entries.reduce((n, e) => n + (e.versions?.length ?? 0), 0);
        const dated = entries.filter((e) => e.takenAt).map((e) => e.takenAt!).sort();
        console.log(`Backup at ${opts.to}`);
        console.log(`  files:        ${entries.length} (${formatBytes(bytes)})`);
        console.log(`  versions:     ${versions} archived under _versions/`);
        if (dated.length > 0) {
          console.log(`  capture span: ${dated[0].slice(0, 10)} to ${dated[dated.length - 1].slice(0, 10)}`);
        }
        console.log(`  last updated: ${manifest.updated}`);
        return;
      }

      if (sources.length === 0) {
        fail("Tell me what to back up, e.g.: exifreg backup ~/Photos --to /Volumes/Backup");
      }
      try {
        assertRootOutsideSources(opts.to, sources);
      } catch (err) {
        fail((err as Error).message);
      }

      let candidates: Candidate[];
      try {
        if (opts.by) {
          const files = resolveFiles(sources, true);
          const { groups, metadataByPrimary } = await prepareGroups(files, opts.by);
          candidates = groups.flatMap((group) => {
            const folder = resolvePattern(opts.by, {
              file: group.primary,
              metadata: metadataByPrimary.get(group.primary) ?? {},
            });
            return group.members.map((member) => ({
              source: member,
              relPath: `${folder}/${path.basename(member)}`,
            }));
          });
        } else {
          candidates = collectMirrorCandidates(sources);
        }
      } catch (err) {
        fail((err as Error).message);
      }

      const manifest = loadManifest(opts.to);
      const plan = planBackup(candidates, manifest, { paranoid: opts.paranoid });

      console.log(
        `${plan.items.filter((i) => i.reason === "new").length} new, ` +
          `${plan.items.filter((i) => i.reason === "modified").length} changed, ` +
          `${plan.unchanged} unchanged (${formatBytes(plan.totalBytes)} to copy).`,
      );
      if (plan.missing.length > 0) {
        console.log(
          `${plan.missing.length} file(s) no longer exist at the source; ` +
            "their backup copies are kept.",
        );
      }
      if (plan.items.length === 0) {
        printSuccess("Backup is up to date.");
        return;
      }
      if (!opts.apply) {
        printDryRunHint();
        return;
      }

      // Best-effort EXIF facts for the manifest (capture date, camera).
      const facts = new Map<string, FileFacts>();
      try {
        const mediaSources = plan.items.map((i) => i.source);
        const metadata = await engine.read(mediaSources);
        mediaSources.forEach((source, i) => {
          const m = metadata[i] ?? {};
          const takenAt = m.DateTimeOriginal ?? m.CreateDate;
          facts.set(path.resolve(source), {
            ...(typeof takenAt === "string" ? { takenAt } : {}),
            ...(m.Model ? { camera: String(m.Model) } : {}),
          });
        });
      } catch {
        /* facts are optional; the backup itself never depends on them */
      }

      const result = await executeBackup(opts.to, manifest, plan, {
        facts,
        onProgress: (c, t, f) => showProgress(c, t, f),
      });
      clearProgress();
      printSuccess(
        `${result.copied} file(s) copied and verified (${formatBytes(result.bytes)})` +
          (result.versioned ? `, ${result.versioned} previous version(s) archived` : "") +
          (result.refreshed ? `, ${result.refreshed} unchanged after checksum` : "") +
          ". Check integrity anytime with: exifreg backup --verify --to " + opts.to,
      );
    });

  program
    .command("restore")
    .description("Restore files from a backup made with 'exifreg backup'.")
    .argument("<backup>", "backup root (the folder that holds the manifest)")
    .option("--to <dir>", "restore into this folder instead of the original locations")
    .option("--taken <date>", 'only files captured then, e.g. "2026", "2026-07" or "2026-07-05"')
    .option("--apply", "execute the plan (default is a dry-run preview)")
    .action(async (backupRoot: string, opts) => {
      let items;
      try {
        items = await planRestoreFromBackup(backupRoot, {
          to: opts.to,
          taken: opts.taken,
          onProgress: (c, t, f) => showProgress(c, t, f),
        });
      } catch (err) {
        fail((err as Error).message);
      }
      clearProgress();
      const restore = items.filter((i) => i.action === "restore");
      const there = items.filter((i) => i.action === "already-there");
      const conflicts = items.filter((i) => i.action === "conflict");
      if (items.length === 0) {
        fail(
          opts.taken
            ? `Nothing in this backup matches --taken ${opts.taken}.`
            : `No backup manifest found at "${backupRoot}".`,
        );
      }
      console.log(
        `${restore.length} to restore, ${there.length} already in place, ` +
          `${conflicts.length} conflict(s).`,
      );
      for (const c of conflicts.slice(0, 10)) {
        console.log(`  conflict (exists with different content, kept): ${c.to}`);
      }
      if (conflicts.length > 10) console.log(`  … and ${conflicts.length - 10} more`);
      if (restore.length === 0) {
        printSuccess("Nothing to restore.");
        return;
      }
      if (!opts.apply) {
        printDryRunHint();
        return;
      }
      const result = await executeRestore(items, {
        onProgress: (c, t, f) => showProgress(c, t, f),
      });
      clearProgress();
      for (const rel of result.corruptedInBackup) {
        printError(`NOT restored (backup copy is corrupted): ${rel}`);
      }
      printSuccess(`${result.restored} file(s) restored and checksum-verified.`);
      if (result.corruptedInBackup.length > 0) {
        fail(
          `${result.corruptedInBackup.length} backup cop(ies) failed their checksum ` +
            "and were NOT restored. Run: exifreg backup --verify --to " + backupRoot,
        );
      }
    });

  program
    .command("doctor")
    .description("Check that exifregistry is healthy.")
    .action(async () => {
      console.log(`exifregistry ${VERSION}`);
      const version = await engine.exiftoolVersion();
      printSuccess(`Bundled ExifTool ${version} is working.`);
      console.log("Everything looks good.");
    });

  return program;
}

/** CLI entry point. Parses argv, reports errors, always shuts ExifTool down. */
export async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof UserError) {
      printError(err.message);
    } else if (
      err instanceof Error &&
      err.constructor.name === "ExitPromptError"
    ) {
      // User pressed Ctrl+C inside a prompt — not an error.
    } else {
      printError((err as Error).message ?? String(err));
    }
    process.exitCode = 1;
  } finally {
    await engine.end();
  }
}
