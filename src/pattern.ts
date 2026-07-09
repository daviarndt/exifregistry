/**
 * Placeholder patterns used by organize/rename/ingest/split.
 *
 * A pattern like "{year}/{date}" or "{date}_{time}_{name}" is resolved
 * against a file's metadata. Pure module: no filesystem access.
 */

import * as path from "node:path";

import type { Metadata } from "./engine.js";
import { extensionOf, isRaw, isVideo } from "./fields.js";

export interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/**
 * Parse an EXIF date string ("YYYY:MM:DD HH:MM:SS", possibly with
 * sub-seconds/timezone) into parts. Returns undefined when unparsable.
 */
export function exifDateParts(value: unknown): DateParts | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return undefined;
  return {
    year: m[1],
    month: m[2],
    day: m[3],
    hour: m[4] ?? "00",
    minute: m[5] ?? "00",
    second: m[6] ?? "00",
  };
}

/** Best capture date available: metadata first, filesystem date last. */
export function captureDateParts(metadata: Metadata): DateParts | undefined {
  for (const key of [
    "DateTimeOriginal",
    "CreateDate",
    "MediaCreateDate",
    "FileModifyDate",
  ]) {
    const parts = exifDateParts(metadata[key]);
    if (parts) return parts;
  }
  return undefined;
}

/** Make a value safe as a single file/folder name component. */
export function sanitizeComponent(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return cleaned || "Unknown";
}

export const KNOWN_PLACEHOLDERS = [
  "year", "month", "day", "date",
  "hour", "minute", "second", "time",
  "camera", "lens", "type", "name", "ext",
  "city", "region", "country",
  "counter",
] as const;

export interface PatternContext {
  /** Source file path (for {name}, {ext}, {type}). */
  file: string;
  /** Numeric metadata (read with geolocation when {city} etc. are used). */
  metadata: Metadata;
  /** 1-based sequence number for {counter}. */
  counter?: number;
}

/** True when the pattern uses {city}/{region}/{country}. */
export function needsGeolocation(pattern: string): boolean {
  return /\{(city|region|country)(:\d+)?\}/.test(pattern);
}

function fileType(file: string): string {
  if (isVideo(file)) return "Videos";
  if (isRaw(file)) return "RAW";
  return "Photos";
}

function resolveOne(name: string, pad: number | undefined, ctx: PatternContext): string {
  const { metadata } = ctx;
  const date = captureDateParts(metadata);
  const meta = (key: string, fallback: string) => {
    const v = metadata[key];
    return v === undefined || v === null || v === ""
      ? fallback
      : sanitizeComponent(String(v));
  };

  switch (name) {
    case "year": return date?.year ?? "Unknown date";
    case "month": return date?.month ?? "Unknown date";
    case "day": return date?.day ?? "Unknown date";
    case "date":
      return date ? `${date.year}-${date.month}-${date.day}` : "Unknown date";
    case "hour": return date?.hour ?? "00";
    case "minute": return date?.minute ?? "00";
    case "second": return date?.second ?? "00";
    case "time":
      return date ? `${date.hour}${date.minute}${date.second}` : "000000";
    case "camera": {
      const model = metadata.Model ?? metadata.Make;
      return model ? sanitizeComponent(String(model)) : "Unknown camera";
    }
    case "lens":
      return meta("LensModel", meta("LensID", meta("Lens", "Unknown lens")));
    case "type": return fileType(ctx.file);
    case "name": return path.basename(ctx.file, path.extname(ctx.file));
    case "ext": return extensionOf(ctx.file).replace(/^\./, "");
    case "city": return meta("GeolocationCity", "Unknown location");
    case "region": return meta("GeolocationRegion", "Unknown location");
    case "country": return meta("GeolocationCountry", "Unknown location");
    case "counter":
      return String(ctx.counter ?? 1).padStart(pad ?? 3, "0");
    default:
      throw new Error(
        `Unknown placeholder "{${name}}". Valid placeholders: ` +
          KNOWN_PLACEHOLDERS.map((p) => `{${p}}`).join(", ") + ".",
      );
  }
}

/**
 * Resolve a pattern into a relative path ("/" separates folders).
 * Each resolved segment is sanitized; literal text is kept as-is.
 */
export function resolvePattern(pattern: string, ctx: PatternContext): string {
  const trimmed = pattern.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) throw new Error("Empty pattern.");
  return trimmed
    .split("/")
    .map((segment) =>
      segment.replace(/\{(\w+)(?::(\d+))?\}/g, (_, name: string, pad?: string) =>
        resolveOne(name, pad ? Number(pad) : undefined, ctx),
      ),
    )
    .join("/");
}
