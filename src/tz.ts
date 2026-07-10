/**
 * Timezone helpers for `exifreg timezone`: resolve an IANA zone from GPS
 * coordinates (offline, via tz-lookup's embedded map) and compute the UTC
 * offset string EXIF expects ("+HH:MM" / "-HH:MM").
 */

import tzlookup from "tz-lookup";

import type { Metadata } from "./engine.js";
import { exifDateParts } from "./pattern.js";

const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

export function validateOffset(offset: string): string {
  const cleaned = offset.trim();
  if (!OFFSET_RE.test(cleaned)) {
    throw new Error(
      `Could not understand the offset "${offset}". ` +
        'Use the form "+02:00" or "-03:00".',
    );
  }
  return cleaned;
}

/** IANA zone for coordinates, e.g. (-23.55, -46.63) -> America/Sao_Paulo. */
export function zoneForCoordinates(lat: number, lon: number): string {
  return tzlookup(lat, lon);
}

/**
 * UTC offset of `zone` at a given moment, as "+HH:MM".
 *
 * The capture datetime is treated as if it were UTC when picking the
 * moment; that is exact except within an hour of a DST switch, which is
 * close enough for photography.
 */
export function offsetForZone(zone: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  });
  const name = formatter
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  if (!name) throw new Error(`Could not compute the offset for "${zone}".`);
  // "GMT-03:00", "GMT+05:30" or plain "GMT" (UTC)
  const match = /GMT([+-]\d{2}:\d{2})?/.exec(name);
  if (!match) throw new Error(`Unexpected offset format "${name}" for "${zone}".`);
  return match[1] ?? "+00:00";
}

export interface GpsOffsetResult {
  zone: string;
  offset: string;
}

/**
 * Derive the capture-time UTC offset of a photo from its own GPS position.
 * Returns undefined when the file has no usable coordinates.
 */
export function offsetFromGps(metadata: Metadata): GpsOffsetResult | undefined {
  const lat = Number(metadata.GPSLatitude);
  const lon = Number(metadata.GPSLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  const zone = zoneForCoordinates(lat, lon);
  const parts = exifDateParts(metadata.DateTimeOriginal ?? metadata.CreateDate);
  const moment = parts
    ? new Date(
        Date.UTC(
          Number(parts.year), Number(parts.month) - 1, Number(parts.day),
          Number(parts.hour), Number(parts.minute), Number(parts.second),
        ),
      )
    : new Date();
  return { zone, offset: offsetForZone(zone, moment) };
}

/** ExifTool arguments that write the offset into all three offset tags. */
export function offsetTagArgs(offset: string): string[] {
  return [
    `-OffsetTimeOriginal=${offset}`,
    `-OffsetTimeDigitized=${offset}`,
    `-OffsetTime=${offset}`,
  ];
}
