/**
 * Command-line interface for exif-kit.
 *
 * Running `exifkit` with no arguments opens the interactive guided mode;
 * subcommands offer the same operations for direct/scripted use.
 */

import { createRequire } from "node:module";

import { confirm } from "@inquirer/prompts";
import { Command } from "commander";

import * as engine from "./engine.js";
import * as fields from "./fields.js";
import {
  describeFiles,
  printAllTags,
  printError,
  printFullReport,
  printSuccess,
} from "./display.js";
import { expandPaths } from "./paths.js";
import { planRestore, restore } from "./undo.js";

const require = createRequire(import.meta.url);
const VERSION: string = require("../package.json").version;

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
    .option("-a, --all", "flat alphabetical dump of every tag (raw values)")
    .option("--json", "output raw JSON (machine-readable)")
    .option("-r, --recursive", "recurse into subfolders")
    .action(async (files: string[], opts) => {
      const paths = resolveFiles(files, opts.recursive);
      if (opts.json) {
        console.log(JSON.stringify(await engine.read(paths), null, 2));
        return;
      }
      const metadata = await engine.readFull(paths);
      for (const item of metadata) {
        if (opts.all) printAllTags(item.pretty);
        else printFullReport(item);
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
