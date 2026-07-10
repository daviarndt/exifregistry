/**
 * `exifreg stats`: library analytics computed from metadata.
 * Pure aggregation; reading and rendering live in the CLI/display layers.
 */

import type { Metadata } from "./engine.js";
import { captureDateParts } from "./pattern.js";

export type CountEntry = [label: string, count: number];

export interface LibraryStats {
  files: number;
  withCaptureDate: number;
  cameras: CountEntry[];
  lenses: CountEntry[];
  focalLengths: CountEntry[];
  isos: CountEntry[];
  apertures: CountEntry[];
  byMonth: CountEntry[];
  byHour: CountEntry[];
}

function top(map: Map<string, number>, limit: number): CountEntry[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function chronological(map: Map<string, number>): CountEntry[] {
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function computeStats(metadata: Metadata[], limit = 8): LibraryStats {
  const cameras = new Map<string, number>();
  const lenses = new Map<string, number>();
  const focals = new Map<string, number>();
  const isos = new Map<string, number>();
  const apertures = new Map<string, number>();
  const months = new Map<string, number>();
  const hours = new Map<string, number>();
  let withCaptureDate = 0;

  for (const m of metadata) {
    if (m.Model) bump(cameras, String(m.Model));
    const lens = m.LensModel ?? m.LensID ?? m.Lens;
    if (lens) bump(lenses, String(lens));
    const focal = Number(m.FocalLength);
    if (Number.isFinite(focal) && focal > 0) {
      bump(focals, `${Math.round(focal)}mm`);
    }
    const iso = Number(m.ISO);
    if (Number.isFinite(iso) && iso > 0) bump(isos, `ISO ${iso}`);
    const f = Number(m.FNumber);
    if (Number.isFinite(f) && f > 0) bump(apertures, `f/${f}`);

    const date = captureDateParts(m);
    const hasRealDate = Boolean(m.DateTimeOriginal ?? m.CreateDate);
    if (date && hasRealDate) {
      withCaptureDate += 1;
      bump(months, `${date.year}-${date.month}`);
      bump(hours, `${date.hour}h`);
    }
  }

  return {
    files: metadata.length,
    withCaptureDate,
    cameras: top(cameras, limit),
    lenses: top(lenses, limit),
    focalLengths: top(focals, limit),
    isos: top(isos, limit),
    apertures: top(apertures, limit),
    byMonth: chronological(months),
    byHour: chronological(hours),
  };
}

/** Render the stats as Markdown (mirrors the terminal sections). */
export function statsToMarkdown(stats: LibraryStats, title: string): string {
  const lines = [
    `# Library stats: ${title}`,
    "",
    `${stats.files} files, ${stats.withCaptureDate} with a capture date.`,
    "",
  ];
  const section = (name: string, entries: CountEntry[]) => {
    if (entries.length === 0) return;
    lines.push(`## ${name}`, "", "| | Count |", "| --- | --- |");
    for (const [label, count] of entries) lines.push(`| ${label} | ${count} |`);
    lines.push("");
  };
  section("Cameras", stats.cameras);
  section("Lenses", stats.lenses);
  section("Focal lengths", stats.focalLengths);
  section("ISO", stats.isos);
  section("Apertures", stats.apertures);
  section("Shots per month", stats.byMonth);
  section("Shots per hour of day", stats.byHour);
  return lines.join("\n");
}
