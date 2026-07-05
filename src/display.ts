/** Rendering of metadata for the terminal. */

import Table from "cli-table3";
import pc from "picocolors";

import type { FullMetadata, Metadata } from "./engine.js";

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function defined(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function formatExposure(value: unknown): string {
  const seconds = asNumber(value);
  if (seconds === undefined) return String(value);
  if (seconds >= 1) return `${seconds}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

export function formatSize(value: unknown): string {
  let size = asNumber(value);
  if (size === undefined) return String(value);
  if (size < 1024) return `${size} B`;
  for (const unit of ["KB", "MB", "GB", "TB"]) {
    size /= 1024;
    if (size < 1024 || unit === "TB") return `${size.toFixed(1)} ${unit}`;
  }
  return String(value);
}

export function formatDuration(value: unknown): string {
  const total = asNumber(value);
  if (total === undefined) return String(value);
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

export function formatGps(metadata: Metadata): string | undefined {
  const lat = asNumber(metadata.GPSLatitude);
  const lon = asNumber(metadata.GPSLongitude);
  if (lat === undefined || lon === undefined) {
    const coords = metadata.GPSCoordinates; // QuickTime videos
    return coords ? String(coords) : undefined;
  }
  let text = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  const altitude = asNumber(metadata.GPSAltitude);
  if (altitude !== undefined) text += `  (altitude ${altitude.toFixed(1)}m)`;
  return text;
}

const GPS_KEYS = [
  "GPSLatitude", "GPSLongitude", "GPSAltitude",
  "GPSLatitudeRef", "GPSLongitudeRef", "GPSAltitudeRef",
  "GPSPosition", "GPSCoordinates",
];

// Shutter actuation counters vary by manufacturer (Nikon/Sony/Pentax use
// ShutterCount; others expose ImageCount or ImageNumber).
const SHUTTER_COUNT_KEYS = [
  "ShutterCount", "MechanicalShutterCount", "ImageCount", "ImageNumber",
];

const SERIAL_KEYS = ["SerialNumber", "InternalSerialNumber", "CameraSerialNumber"];

export interface ReportRows {
  /** Curated, photographer-relevant rows, most important first. */
  main: [string, string][];
  /** Every remaining tag, alphabetical. */
  other: [string, string][];
}

/** Build the full report: curated rows first, all remaining tags after. */
export function fullReportRows(full: FullMetadata): ReportRows {
  const { pretty: p, numeric: n } = full;
  const used = new Set<string>(["SourceFile"]);
  const main: [string, string][] = [];

  const add = (label: string, value: unknown, keys: string[]) => {
    for (const k of keys) used.add(k);
    if (defined(value)) main.push([label, String(value)]);
  };
  const firstPretty = (keys: string[]) => keys.map((k) => p[k]).find(defined);

  // File
  add("File", p.FileName, ["FileName"]);
  add("Folder", p.Directory, ["Directory"]);
  add("Type", p.FileType, ["FileType"]);
  add("Size", defined(n.FileSize) ? formatSize(n.FileSize) : undefined, ["FileSize"]);
  const width = asNumber(n.ImageWidth);
  const height = asNumber(n.ImageHeight);
  add(
    "Dimensions",
    width && height ? `${width} x ${height}` : undefined,
    ["ImageWidth", "ImageHeight", "ImageSize"],
  );
  add("Megapixels", p.Megapixels, ["Megapixels"]);

  // Camera & lens
  const camera = [p.Make, p.Model].filter(Boolean).join(" ");
  add("Camera", camera || undefined, ["Make", "Model"]);
  add("Serial number", firstPretty(SERIAL_KEYS), SERIAL_KEYS);
  const shutterCount = SHUTTER_COUNT_KEYS.map((k) => asNumber(n[k])).find(
    (v) => v !== undefined && v > 0,
  );
  add("Shutter count", shutterCount?.toLocaleString("en-US"), SHUTTER_COUNT_KEYS);
  add("Lens", firstPretty(["LensModel", "LensID", "Lens"]), [
    "LensModel", "LensID", "Lens",
  ]);

  // Exposure
  add("ISO", p.ISO, ["ISO"]);
  const fNumber = asNumber(n.FNumber);
  add("Aperture", fNumber !== undefined ? `f/${fNumber}` : undefined, ["FNumber"]);
  add(
    "Shutter",
    defined(n.ExposureTime) ? formatExposure(n.ExposureTime) : undefined,
    ["ExposureTime"],
  );
  const focal = asNumber(n.FocalLength);
  const focal35 = asNumber(n.FocalLengthIn35mmFormat);
  let focalText: string | undefined;
  if (focal !== undefined) {
    focalText = `${focal}mm`;
    if (focal35 !== undefined && focal35 !== focal) {
      focalText += `  (${focal35}mm in 35mm equiv.)`;
    }
  }
  add("Focal length", focalText, ["FocalLength", "FocalLengthIn35mmFormat"]);
  const ec = p.ExposureCompensation;
  add("Exposure comp.", defined(ec) && String(ec) !== "0" ? `${ec} EV` : undefined, [
    "ExposureCompensation",
  ]);
  add("Exposure program", p.ExposureProgram, ["ExposureProgram"]);
  add("Metering", p.MeteringMode, ["MeteringMode"]);
  add("Flash", p.Flash, ["Flash"]);
  add("White balance", p.WhiteBalance, ["WhiteBalance"]);
  add("Color space", p.ColorSpace, ["ColorSpace"]);
  add("Orientation", p.Orientation, ["Orientation"]);

  // Authorship
  add("Artist", p.Artist, ["Artist"]);
  add("Copyright", p.Copyright, ["Copyright"]);
  add("Rating", p.Rating, ["Rating"]);
  add("Software", p.Software, ["Software"]);

  // Dates
  add("Taken (DateTimeOriginal)", p.DateTimeOriginal, ["DateTimeOriginal"]);
  add("Created (CreateDate)", p.CreateDate, ["CreateDate"]);
  add("Modified (ModifyDate)", p.ModifyDate, ["ModifyDate"]);
  add("Timezone (OffsetTimeOriginal)", p.OffsetTimeOriginal, ["OffsetTimeOriginal"]);
  add("File modified", p.FileModifyDate, ["FileModifyDate"]);

  // Video
  add(
    "Duration",
    defined(n.Duration) ? formatDuration(n.Duration) : undefined,
    ["Duration"],
  );
  const fps = asNumber(n.VideoFrameRate);
  add("Frame rate", fps !== undefined ? `${fps} fps` : undefined, ["VideoFrameRate"]);
  add("Audio", p.AudioFormat, ["AudioFormat"]);

  // GPS (decimal degrees, ready to paste into a maps app)
  add("GPS", formatGps(n) ?? "— none —", GPS_KEYS);

  const other: [string, string][] = Object.keys(p)
    .filter((k) => !used.has(k))
    .sort()
    .map((k) => [k, String(p[k])]);

  return { main, other };
}

function newTable(head?: string[]): Table.Table {
  return new Table({
    head,
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [32, 60],
  });
}

export function printFullReport(full: FullMetadata): void {
  const { main, other } = fullReportRows(full);
  console.log(pc.bold(pc.cyan(String(full.pretty.FileName ?? ""))));
  const table = newTable();
  for (const [label, value] of main) table.push([pc.bold(label), value]);
  console.log(table.toString());

  if (other.length > 0) {
    console.log(pc.dim(`All other tags (${other.length}):`));
    const rest = newTable();
    for (const [key, value] of other) rest.push([pc.dim(key), pc.dim(value)]);
    console.log(rest.toString());
  }
}

export function printAllTags(metadata: Metadata): void {
  console.log(pc.bold(pc.cyan(String(metadata.FileName ?? ""))));
  const table = newTable([pc.bold("Tag"), pc.bold("Value")]);
  for (const key of Object.keys(metadata).sort()) {
    if (key === "SourceFile") continue;
    table.push([key, String(metadata[key])]);
  }
  console.log(table.toString());
}

export function printSuccess(message: string): void {
  console.log(`${pc.green(pc.bold("✓"))} ${message}`);
}

export function printError(message: string): void {
  console.error(pc.red(message));
}

export function describeFiles(paths: string[]): string {
  if (paths.length === 1) {
    const p = paths[0];
    return p.split(/[/\\]/).pop() ?? p;
  }
  return `${paths.length} files`;
}
