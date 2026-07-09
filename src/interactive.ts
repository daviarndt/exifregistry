/**
 * Guided interactive mode — what you get when running `exifregistry` bare.
 *
 * Walks the user through each operation with menus and prompts, so no
 * flags need to be memorized. Every action maps 1:1 onto a CLI subcommand.
 */

import * as path from "node:path";

import { confirm, input, select } from "@inquirer/prompts";
import pc from "picocolors";

import * as engine from "./engine.js";
import * as fields from "./fields.js";
import { frameFiles, prepareGroups, resizeFiles, writeMarkdownReport } from "./cli.js";
import { parseByteSize, parseFormat } from "./resize.js";
import { FRAME_COLORS, parseRatio, resolveColor } from "./frame.js";
import { isVideo } from "./fields.js";
import {
  describeFiles,
  printError,
  printFullReport,
  printPlan,
  printSuccess,
} from "./display.js";
import { defaultExportPath } from "./markdown.js";
import { executePlan, journalBatch, planOrganize, planRename } from "./organizer.js";
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

async function actionOrganize(): Promise<void> {
  const paths = await askFiles("Organize which files? (path, folder, or glob)");
  if (!paths) return;
  const preset = await select({
    message: "Folder structure?",
    choices: [
      { name: "By date          → 2026/2026-07-05/", value: "{year}/{date}" },
      { name: "By month         → 2026/07/", value: "{year}/{month}" },
      { name: "By camera        → Canon EOS R6/2026-07-05/", value: "{camera}/{date}" },
      { name: "By location      → Brazil/Sao Paulo/", value: "{country}/{city}" },
      { name: "Custom pattern…", value: "custom" },
    ],
  });
  const pattern =
    preset === "custom"
      ? (await input({ message: "Pattern (e.g. {year}/{month}/{day}):" })).trim()
      : preset;
  if (!pattern) return;
  const destRoot = (
    await input({ message: "Destination root folder:", default: "." })
  ).trim() || ".";
  const copy = !(await confirm({
    message: "Move the files? (No = copy them instead)",
    default: true,
  }));

  const { groups, metadataByPrimary } = await prepareGroups(paths, pattern);
  let ops;
  try {
    ops = planOrganize(groups, metadataByPrimary, { pattern, destRoot });
  } catch (err) {
    printError((err as Error).message);
    return;
  }
  if (ops.length === 0) {
    console.log("Nothing to do — everything is already in place.");
    return;
  }
  printPlan(ops, copy ? "copy" : "move");
  if (!(await confirm({ message: "Execute this plan?", default: false }))) return;
  const done = await executePlan(ops, { copy });
  journalBatch(destRoot, "organize", done, copy);
  printSuccess(
    `${done.length} file(s) ${copy ? "copied" : "moved"}. ` +
      "Undo with: exifregistry organize --undo" +
      (destRoot === "." ? "" : ` --to ${destRoot}`),
  );
}

async function actionRename(): Promise<void> {
  const paths = await askFiles("Rename which files? (path, folder, or glob)");
  if (!paths) return;
  const pattern = (
    await input({
      message: "Filename pattern:",
      default: "{date}_{time}_{name}",
    })
  ).trim();
  if (!pattern) return;

  const { groups, metadataByPrimary } = await prepareGroups(paths, pattern);
  let ops;
  try {
    ops = planRename(groups, metadataByPrimary, { pattern });
  } catch (err) {
    printError((err as Error).message);
    return;
  }
  if (ops.length === 0) {
    console.log("Nothing to do — names already match the pattern.");
    return;
  }
  printPlan(ops, "rename");
  if (!(await confirm({ message: "Execute this plan?", default: false }))) return;
  const done = await executePlan(ops);
  journalBatch(path.dirname(done[0].source), "rename", done, false);
  printSuccess(`${done.length} file(s) renamed.`);
}

async function actionFrame(): Promise<void> {
  const all = await askFiles("Frame which photo(s)? (path, folder, or glob)");
  if (!all) return;
  const paths = all.filter((p) => !isVideo(p));
  if (paths.length === 0) {
    printError("No photos to frame (videos are not supported).");
    return;
  }
  const colorName = await select({
    message: "Frame color?",
    choices: FRAME_COLORS.map((c) => ({
      name: `${c.name.padEnd(12)} ${c.hex}`,
      value: c.name,
    })),
    pageSize: 12,
  });
  const ratioText = await select({
    message: "Aspect ratio?",
    choices: [
      { name: "Original (follow the photo)", value: "original" },
      { name: "1:1  (square)", value: "1:1" },
      { name: "4:5  (portrait feed)", value: "4:5" },
      { name: "9:16 (stories/reels)", value: "9:16" },
      { name: "3:2  (classic print)", value: "3:2" },
      { name: "16:9 (widescreen)", value: "16:9" },
    ],
  });
  const caption = await select({
    message: "EXIF caption?",
    choices: [
      { name: "Below the photo", value: "bottom" as const },
      { name: "Above the photo", value: "top" as const },
      { name: "No caption", value: "none" as const },
    ],
  });
  const showCamera =
    caption !== "none" &&
    (await confirm({
      message: "Include the camera model in the caption?",
      default: false,
    }));
  const fullRes = await confirm({
    message: "Keep the photo at native resolution? (No = 3000px long edge)",
    default: false,
  });
  await frameFiles(paths, {
    color: resolveColor(colorName),
    ratio: parseRatio(ratioText),
    caption,
    showCamera,
    marginPct: 6,
    size: fullRes ? "full" : 3000,
  });
}

async function actionResize(): Promise<void> {
  const all = await askFiles("Resize which photo(s)? (path, folder, or glob)");
  if (!all) return;
  const paths = all.filter((p) => !isVideo(p));
  if (paths.length === 0) {
    printError("No photos to resize (videos are not supported).");
    return;
  }
  const mode = await select({
    message: "Resize how?",
    choices: [
      { name: "Target file size (e.g. 1mb — best quality that fits)", value: "size" },
      { name: "Long edge in pixels (e.g. 2048)", value: "long" },
      { name: "Percentage (e.g. 50)", value: "percent" },
      { name: "Just convert format / re-encode", value: "convert" },
    ],
  });

  let maxBytes: number | undefined;
  const dims: { long?: number; percent?: number } = {};
  try {
    if (mode === "size") {
      const text = await input({ message: 'Target size (e.g. "1mb", "500kb"):' });
      if (!text.trim()) return;
      maxBytes = parseByteSize(text);
    } else if (mode === "long") {
      const text = await input({ message: "Long edge in pixels:", default: "2048" });
      if (!text.trim()) return;
      dims.long = Number(text);
    } else if (mode === "percent") {
      const text = await input({ message: "Scale percentage:", default: "50" });
      if (!text.trim()) return;
      dims.percent = Number(text);
    }
    const formatChoice = await select({
      message: "Output format?",
      choices: [
        { name: "Keep the same format", value: "keep" },
        { name: "JPEG", value: "jpeg" },
        { name: "WebP", value: "webp" },
        { name: "AVIF", value: "avif" },
        { name: "PNG", value: "png" },
      ],
    });
    await resizeFiles(paths, {
      dims,
      maxBytes,
      format: formatChoice === "keep" ? undefined : parseFormat(formatChoice),
      suffix: "resized",
    });
  } catch (err) {
    printError((err as Error).message);
  }
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
    `${pc.bold(pc.cyan("exifregistry"))} — photo & video metadata toolkit`,
  );
  console.log(pc.dim("Ctrl+C or 'Quit' to leave at any time.\n"));

  const actions: Record<string, () => Promise<void>> = {
    inspect: actionInspect,
    gps: actionGps,
    gpsRemove: actionGpsRemove,
    dates: actionDates,
    copy: actionCopy,
    strip: actionStrip,
    organize: actionOrganize,
    rename: actionRename,
    frame: actionFrame,
    resize: actionResize,
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
          { name: "🗂   Organize into folders", value: "organize" },
          { name: "✏️   Rename by pattern", value: "rename" },
          { name: "🖼   Frame photos (EXIF caption)", value: "frame" },
          { name: "📐  Resize / convert photos", value: "resize" },
          { name: "↩️   Undo metadata edit (restore backup)", value: "undo" },
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
