/**
 * Guided interactive mode — what you get when running `exifkit` bare.
 *
 * Walks the user through each operation with menus and prompts, so no
 * flags need to be memorized. Every action maps 1:1 onto a CLI subcommand.
 */

import { confirm, input, select } from "@inquirer/prompts";
import pc from "picocolors";

import * as engine from "./engine.js";
import * as fields from "./fields.js";
import { writeMarkdownReport } from "./cli.js";
import { describeFiles, printError, printFullReport, printSuccess } from "./display.js";
import { defaultExportPath } from "./markdown.js";
import { expandPaths } from "./paths.js";
import { planRestore, restore } from "./undo.js";

async function askFiles(
  message = "Which file(s)? (path, folder, or glob like *.jpg)",
): Promise<string[] | undefined> {
  for (;;) {
    const answer = (await input({ message })).trim();
    if (!answer) return undefined;
    try {
      const paths = expandPaths([answer]);
      if (paths.length === 0) {
        printError("No supported photo or video files found there.");
        continue;
      }
      console.log(pc.dim(`Selected ${describeFiles(paths)}.`));
      return paths;
    } catch (err) {
      printError((err as Error).message);
    }
  }
}

async function askBackup(): Promise<boolean> {
  return confirm({
    message: "Keep a backup copy of the original file(s)?",
    default: true,
  });
}

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

async function actionInspect(): Promise<void> {
  const paths = await askFiles();
  if (!paths) return;
  const detail = await select({
    message: "How much detail?",
    choices: [
      { name: "Key fields only", value: "key" },
      { name: "Everything (verbose — all tags)", value: "verbose" },
    ],
  });
  const metadata = await engine.readFull(paths);
  for (const item of metadata) {
    printFullReport(item, detail === "verbose");
  }

  const wantsExport = await confirm({
    message: "Export this report to a Markdown (.md) file?",
    default: false,
  });
  if (!wantsExport) return;
  const target = (
    await input({
      message: "Save the report as:",
      default: defaultExportPath(paths),
    })
  ).trim();
  if (!target) return;
  try {
    writeMarkdownReport(metadata, target);
    printSuccess(`Exported metadata report to ${target}.`);
  } catch (err) {
    printError((err as Error).message);
  }
}

async function actionGps(): Promise<void> {
  const paths = await askFiles();
  if (!paths) return;
  const coordsText = await input({
    message: 'Coordinates (paste from a maps app, "lat, lon"):',
  });
  if (!coordsText.trim()) return;
  let lat: number, lon: number;
  try {
    [lat, lon] = fields.parseCoordinates(coordsText);
  } catch (err) {
    printError((err as Error).message);
    return;
  }
  const altText = (
    await input({ message: "Altitude in meters (optional, Enter to skip):" })
  ).trim();
  let altitude: number | undefined;
  if (altText) {
    altitude = Number(altText);
    if (Number.isNaN(altitude)) {
      printError("Altitude must be a number — skipping it.");
      altitude = undefined;
    }
  }
  const backup = await askBackup();
  await applyGroupedGps(paths, backup, (video) =>
    fields.gpsEdit(lat, lon, altitude, video),
  );
  printSuccess(`Set GPS of ${describeFiles(paths)} to ${lat}, ${lon}.`);
}

async function actionGpsRemove(): Promise<void> {
  const paths = await askFiles();
  if (!paths) return;
  const confirmed = await confirm({
    message: `Remove all GPS data from ${describeFiles(paths)}?`,
    default: false,
  });
  if (!confirmed) return;
  const backup = await askBackup();
  await applyGroupedGps(paths, backup, fields.gpsRemoveEdit);
  printSuccess(`Removed GPS data from ${describeFiles(paths)}.`);
}

async function actionDates(): Promise<void> {
  const paths = await askFiles();
  if (!paths) return;
  const mode = await select({
    message: "What do you want to change?",
    choices: [
      { name: "Capture date (when the photo was taken)", value: "taken" },
      { name: "Modification date (when it was edited)", value: "modified" },
      { name: "All dates at once", value: "all" },
      { name: "Shift all dates (fix a wrong timezone/clock)", value: "shift" },
      { name: "Back", value: "back" },
    ],
  });
  if (mode === "back") return;

  let edit: fields.Edit;
  try {
    if (mode === "shift") {
      const shiftText = await input({
        message: 'Shift amount (e.g. "+2h", "-30m", "+1d 2h30m"):',
      });
      if (!shiftText.trim()) return;
      const [operator, amount] = fields.parseShift(shiftText);
      edit = fields.shiftEdit(operator, amount);
    } else {
      const dateText = await input({ message: 'New date (e.g. "2024-06-01 14:30"):' });
      if (!dateText.trim()) return;
      const exifDt = fields.parseDatetime(dateText);
      if (mode === "taken") edit = fields.captureDateEdit(exifDt);
      else if (mode === "modified") edit = fields.modifyDateEdit(exifDt);
      else edit = fields.allDatesEdit(exifDt);
    }
  } catch (err) {
    printError((err as Error).message);
    return;
  }

  if (
    (mode === "taken" || mode === "all") &&
    (await confirm({
      message: "Also set the file's modification date to match?",
      default: false,
    }))
  ) {
    edit.extraArgs.push(...fields.syncFileDateArgs());
  }

  const backup = await askBackup();
  await engine.applyEdit(paths, edit, { backup });
  printSuccess(`Updated dates on ${describeFiles(paths)}.`);
}

async function actionCopy(): Promise<void> {
  const source = (await input({ message: "Copy metadata FROM which file?" })).trim();
  if (!source) return;
  let sourcePath: string;
  try {
    const resolved = expandPaths([source]);
    if (resolved.length !== 1) {
      printError("Pick exactly one source file.");
      return;
    }
    sourcePath = resolved[0];
  } catch (err) {
    printError((err as Error).message);
    return;
  }
  const targets = await askFiles("Copy metadata TO which file(s)?");
  if (!targets) return;
  const backup = await askBackup();
  await engine.copyMetadata(sourcePath, targets, { backup });
  printSuccess(
    `Copied metadata from ${describeFiles([sourcePath])} to ${describeFiles(targets)}.`,
  );
}

async function actionStrip(): Promise<void> {
  const paths = await askFiles();
  if (!paths) return;
  const confirmed = await confirm({
    message:
      `Remove ALL metadata from ${describeFiles(paths)}? ` +
      "This includes camera info, dates and GPS.",
    default: false,
  });
  if (!confirmed) return;
  const backup = await askBackup();
  await engine.stripMetadata(paths, { backup });
  printSuccess(`Stripped all metadata from ${describeFiles(paths)}.`);
}

async function actionUndo(): Promise<void> {
  const answer = (
    await input({
      message: "Restore which file(s)? (edited file, '_original' backup, or folder)",
    })
  ).trim();
  if (!answer) return;
  try {
    const plans = planRestore([answer]);
    if (plans.length === 0) {
      printError("No '_original' backups found to restore.");
      return;
    }
    restore(plans);
    printSuccess(
      `Restored ${describeFiles(plans.map((p) => p.target))} from backup.`,
    );
  } catch (err) {
    printError((err as Error).message);
  }
}

export async function runInteractive(): Promise<void> {
  console.log(
    `${pc.bold(pc.cyan("exif-kit"))} — photo & video metadata toolkit`,
  );
  console.log(pc.dim("Ctrl+C or 'Quit' to leave at any time.\n"));

  const actions: Record<string, () => Promise<void>> = {
    inspect: actionInspect,
    gps: actionGps,
    gpsRemove: actionGpsRemove,
    dates: actionDates,
    copy: actionCopy,
    strip: actionStrip,
    undo: actionUndo,
  };

  for (;;) {
    let choice: string;
    try {
      choice = await select({
        message: "What would you like to do?",
        choices: [
          { name: "📷  Inspect metadata", value: "inspect" },
          { name: "📍  Set GPS location", value: "gps" },
          { name: "🚫  Remove GPS location", value: "gpsRemove" },
          { name: "🕑  Edit dates", value: "dates" },
          { name: "📋  Copy metadata between files", value: "copy" },
          { name: "🧹  Strip all metadata (privacy)", value: "strip" },
          { name: "↩️   Undo (restore from backup)", value: "undo" },
          { name: "👋  Quit", value: "quit" },
        ],
      });
    } catch {
      break; // Ctrl+C inside the prompt
    }
    if (choice === "quit") break;
    try {
      await actions[choice]();
    } catch (err) {
      if (err instanceof Error && err.constructor.name === "ExitPromptError") {
        break;
      }
      printError((err as Error).message);
    }
    console.log();
  }
  console.log(pc.dim("Bye!"));
}
