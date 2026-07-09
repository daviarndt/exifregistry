/**
 * Pure helpers shared by the CLI and interactive mode.
 *
 * Everything here has no I/O, which keeps it easy to unit test. Functions
 * either parse forgiving human input into ExifTool's formats or build the
 * tag payloads applied by engine.applyEdit().
 */

export const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".mts", ".m2ts",
]);

export const RAW_EXTENSIONS = new Set([
  ".dng", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".raf", ".orf",
  ".rw2", ".pef", ".srw", ".x3f", ".3fr", ".fff", ".iiq", ".gpr",
]);

export const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp",
  ...RAW_EXTENSIONS,
]);

/** Companion files that must always travel with their photo/video. */
export const SIDECAR_EXTENSIONS = new Set([".xmp", ".aae"]);

export const SUPPORTED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

/** A metadata edit: typed tag assignments plus raw ExifTool arguments. */
export interface Edit {
  tags: Record<string, unknown>;
  extraArgs: string[];
}

export function extensionOf(path: string): string {
  const match = /\.[^./\\]+$/.exec(path);
  return match ? match[0].toLowerCase() : "";
}

export function isVideo(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(path));
}

export function isRaw(path: string): boolean {
  return RAW_EXTENSIONS.has(extensionOf(path));
}

const ISO_DATETIME =
  /^(\d{4})[-:](\d{1,2})[-:](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DMY_DATETIME =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function buildExifDate(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
): string {
  const date = new Date(year, month - 1, day, hour, minute, second);
  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second;
  if (!valid) {
    throw new RangeError("not a real calendar date/time");
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}:${pad(month)}:${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/**
 * Parse a human-friendly date/time into ExifTool's `YYYY:MM:DD HH:MM:SS`.
 *
 * Accepts ISO-style ("2024-06-01 14:30"), EXIF-style ("2024:06:01 14:30:00"),
 * bare dates (time defaults to 00:00:00) and "DD/MM/YYYY" forms.
 */
export function parseDatetime(text: string): string {
  const cleaned = text.trim();
  let match = ISO_DATETIME.exec(cleaned);
  let year: number, month: number, day: number;
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = DMY_DATETIME.exec(cleaned);
    if (match) {
      [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    }
  }
  if (match) {
    const hour = match[4] === undefined ? 0 : Number(match[4]);
    const minute = match[5] === undefined ? 0 : Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    try {
      return buildExifDate(year!, month!, day!, hour, minute, second);
    } catch {
      // fall through to the error below
    }
  }
  throw new Error(
    `Could not understand the date "${text}". ` +
      'Try formats like "2024-06-01", "2024-06-01 14:30" or "01/06/2024 14:30".',
  );
}

const SHIFT_UNITS: Record<string, string> = {
  y: "years",
  mo: "months",
  d: "days",
  h: "hours",
  m: "minutes",
  s: "seconds",
};

const SHIFT_TOKEN = /(\d+)\s*(mo|y|d|h|m|s)/gi;

/**
 * Parse a time shift like "+2h", "-30m" or "+1d 2h30m".
 *
 * Returns `[operator, shift]` where operator is `"+="` or `"-="` and shift
 * is ExifTool's `Y:M:D H:M:S` format.
 */
export function parseShift(text: string): [string, string] {
  let cleaned = text.trim().replace(/,/g, " ");
  if (!cleaned) throw new Error("Empty shift expression.");

  let sign = "+";
  if (cleaned[0] === "+" || cleaned[0] === "-") {
    sign = cleaned[0];
    cleaned = cleaned.slice(1).trim();
  }

  const matches = [...cleaned.matchAll(SHIFT_TOKEN)];
  const consumed = cleaned.replace(SHIFT_TOKEN, "").trim();
  if (matches.length === 0 || consumed) {
    throw new Error(
      `Could not understand the shift "${text}". ` +
        'Use units y, mo, d, h, m, s — for example "+2h", "-30m" or "+1d 2h30m".',
    );
  }

  const amounts: Record<string, number> = {
    years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0,
  };
  for (const [, value, unit] of matches) {
    amounts[SHIFT_UNITS[unit.toLowerCase()]] += Number(value);
  }

  const shift =
    `${amounts.years}:${amounts.months}:${amounts.days} ` +
    `${amounts.hours}:${amounts.minutes}:${amounts.seconds}`;
  return [`${sign}=`, shift];
}

export function validateCoordinates(lat: number, lon: number): void {
  if (!(lat >= -90 && lat <= 90)) {
    throw new Error(`Latitude must be between -90 and 90 (got ${lat}).`);
  }
  if (!(lon >= -180 && lon <= 180)) {
    throw new Error(`Longitude must be between -180 and 180 (got ${lon}).`);
  }
}

/** Parse "lat, lon" (as copied from Google/Apple Maps) into numbers. */
export function parseCoordinates(text: string): [number, number] {
  const parts = text.trim().replace(/;/g, ",").split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(
      `Could not understand the coordinates "${text}". ` +
        'Paste them as "latitude, longitude", e.g. "-23.5505, -46.6333".',
    );
  }
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error(`Coordinates must be decimal numbers, got "${text}".`);
  }
  validateCoordinates(lat, lon);
  return [lat, lon];
}

/**
 * Build the edit that writes a GPS position.
 *
 * Signed decimals are enough: exiftool-vendored derives the hemisphere Ref
 * tags from the sign. QuickTime containers (MP4/MOV) additionally carry
 * location in a single GPSCoordinates tag.
 */
export function gpsEdit(
  lat: number,
  lon: number,
  altitude?: number,
  video = false,
): Edit {
  validateCoordinates(lat, lon);
  const tags: Record<string, unknown> = {
    GPSLatitude: lat,
    GPSLongitude: lon,
  };
  if (altitude !== undefined) tags.GPSAltitude = altitude;
  if (video) {
    let coords = `${lat}, ${lon}`;
    if (altitude !== undefined) coords += `, ${altitude}`;
    tags.GPSCoordinates = coords;
  }
  return { tags, extraArgs: [] };
}

/** Build the edit that deletes all GPS information. */
export function gpsRemoveEdit(video = false): Edit {
  const extraArgs = ["-GPS:all="];
  if (video) extraArgs.push("-GPSCoordinates=");
  return { tags: {}, extraArgs };
}

/** Set the capture (taken) date: DateTimeOriginal + CreateDate. */
export function captureDateEdit(exifDatetime: string): Edit {
  return {
    tags: { DateTimeOriginal: exifDatetime, CreateDate: exifDatetime },
    extraArgs: [],
  };
}

/** Set the edit/modification date stored in metadata. */
export function modifyDateEdit(exifDatetime: string): Edit {
  return { tags: { ModifyDate: exifDatetime }, extraArgs: [] };
}

/** Set DateTimeOriginal, CreateDate and ModifyDate at once. */
export function allDatesEdit(exifDatetime: string): Edit {
  return { tags: {}, extraArgs: [`-AllDates=${exifDatetime}`] };
}

/** Shift all dates forward or backward (e.g. timezone fixes). */
export function shiftEdit(operator: string, shift: string): Edit {
  return { tags: {}, extraArgs: [`-AllDates${operator}${shift}`] };
}

/** Make the filesystem modification date match the capture date. */
export function syncFileDateArgs(): string[] {
  return ["-FileModifyDate<DateTimeOriginal"];
}

/** Merge several edits into one (tags collide last-wins). */
export function mergeEdits(edits: Edit[]): Edit {
  const merged: Edit = { tags: {}, extraArgs: [] };
  for (const edit of edits) {
    Object.assign(merged.tags, edit.tags);
    merged.extraArgs.push(...edit.extraArgs);
  }
  return merged;
}
