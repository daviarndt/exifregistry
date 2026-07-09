/**
 * Command-line interface for exif-kit.
 *
 * Running `exifkit` with no arguments opens the interactive guided mode;
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
  describeFiles,
  printAllTags,
  printDryRunHint,
  printError,
  printFullReport,
  printPlan,
  printSuccess,
} from "./display.js";
import { findDupes } from "./dupes.js";
import { defaultExportPath, metadataToMarkdown } from "./markdown.js";
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
import { captureDateParts, needsGeolocation } from "./pattern.js";
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
  const done = await executePlan(ops, { copy: opts.copy, verify: opts.verify });
  journalBatch(opts.journalRoot, command, done, opts.copy ?? false);
  printSuccess(
    `${done.length} file(s) ${opts.copy ? "copied" : command === "rename" ? "renamed" : "moved"}. ` +
      `Undo with: exifkit ${command} --undo${command === "rename" ? " <folder>" : ""}`,
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
    .name("exifkit")
    .description("Inspect and edit photo/video metadata (EXIF, GPS, dates).")
    .version(`exif-kit ${VERSION}`, "-V, --version")
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
        fail("Tell me what to organize, e.g.: exifkit organize ~/Downloads/card --to ~/Photos");
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
        fail('Tell me what to rename, e.g.: exifkit rename *.CR3 -p "{date}_{counter:3}"');
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
      const groups = await findDupes(files);
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
    .command("doctor")
    .description("Check that exif-kit is healthy.")
    .action(async () => {
      console.log(`exif-kit ${VERSION}`);
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
