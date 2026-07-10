/** Tests for the analytics/query/timezone/config/diff building blocks. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { configPath, loadConfig, saveConfig } from "../src/config.js";
import { buildDiffRows } from "../src/display.js";
import * as engine from "../src/engine.js";
import { matches, parseCondition } from "../src/query.js";
import { computeStats, statsToMarkdown } from "../src/stats.js";
import { offsetForZone, offsetFromGps, validateOffset, zoneForCoordinates } from "../src/tz.js";
import { makeScratchJpeg } from "./fixtures.js";

afterAll(async () => {
  await engine.end();
});

describe("query", () => {
  const meta = {
    ISO: 6400,
    Model: "Canon EOS R6",
    LensModel: "RF 35mm F1.8",
    DateTimeOriginal: "2026:07:05 14:30:00",
  };

  it.each([
    ["ISO>3200", true],
    ["ISO>6400", false],
    ["iso>=6400", true], // case-insensitive key
    ["Model=canon eos r6", true], // case-insensitive value
    ["Model!=Nikon", true],
    ["LensModel~35mm", true],
    ["LensModel~85mm", false],
    ["DateTimeOriginal>=2026:07", true],
    ["DateTimeOriginal<2026:01", false],
  ])("evaluates %s -> %s", (cond, expected) => {
    expect(matches(meta, [parseCondition(cond)])).toBe(expected);
  });

  it("ANDs multiple conditions", () => {
    const conds = [parseCondition("ISO>3200"), parseCondition("Model~canon")];
    expect(matches(meta, conds)).toBe(true);
    expect(matches(meta, [...conds, parseCondition("ISO<100")])).toBe(false);
  });

  it("missing tags never match", () => {
    expect(matches(meta, [parseCondition("GPSLatitude>0")])).toBe(false);
  });

  it("rejects nonsense conditions", () => {
    expect(() => parseCondition("what is this")).toThrow(/ISO>3200/);
  });
});

describe("stats", () => {
  const metadata = [
    { Model: "Canon EOS R6", FocalLength: 35, ISO: 400, FNumber: 2.8, DateTimeOriginal: "2026:07:05 14:30:00" },
    { Model: "Canon EOS R6", FocalLength: 35.2, ISO: 400, FNumber: 2.8, DateTimeOriginal: "2026:07:05 18:10:00" },
    { Model: "NIKON Z 6", LensModel: "NIKKOR 85mm", FocalLength: 85, ISO: 1600, FNumber: 1.8, DateTimeOriginal: "2026:06:01 09:00:00" },
    { FileName: "no-exif.png" },
  ];
  const stats = computeStats(metadata);

  it("aggregates cameras, focals and dates", () => {
    expect(stats.files).toBe(4);
    expect(stats.withCaptureDate).toBe(3);
    expect(stats.cameras[0]).toEqual(["Canon EOS R6", 2]);
    expect(stats.focalLengths).toContainEqual(["35mm", 2]); // 35 and 35.2 bucket together
    expect(stats.byMonth).toEqual([["2026-06", 1], ["2026-07", 2]]);
    expect(stats.byHour).toContainEqual(["14h", 1]);
  });

  it("renders markdown with tables", () => {
    const md = statsToMarkdown(stats, "test library");
    expect(md).toContain("# Library stats: test library");
    expect(md).toContain("| Canon EOS R6 | 2 |");
  });
});

describe("timezone", () => {
  it("validates offsets", () => {
    expect(validateOffset(" -03:00 ")).toBe("-03:00");
    expect(() => validateOffset("3h")).toThrow(/\+02:00/);
  });

  it("resolves zones from coordinates offline", () => {
    expect(zoneForCoordinates(-23.5505, -46.6333)).toBe("America/Sao_Paulo");
    expect(zoneForCoordinates(35.68, 139.76)).toBe("Asia/Tokyo");
  });

  it("computes offsets, including half-hour zones", () => {
    expect(offsetForZone("America/Sao_Paulo", new Date("2026-07-05T12:00:00Z"))).toBe("-03:00");
    expect(offsetForZone("Asia/Kolkata", new Date("2026-07-05T12:00:00Z"))).toBe("+05:30");
    expect(offsetForZone("UTC", new Date())).toBe("+00:00");
  });

  it("derives the offset from a photo's own GPS", () => {
    const result = offsetFromGps({
      GPSLatitude: 48.8566,
      GPSLongitude: 2.3522,
      DateTimeOriginal: "2026:01:15 10:00:00", // winter: Paris is +01:00
    });
    expect(result).toEqual({ zone: "Europe/Paris", offset: "+01:00" });
  });

  it("returns undefined without GPS", () => {
    expect(offsetFromGps({ ISO: 100 })).toBeUndefined();
  });

  it("round-trips offset tags through ExifTool", async () => {
    const { file } = makeScratchJpeg();
    const { offsetTagArgs } = await import("../src/tz.js");
    await engine.applyEdit(
      [file],
      { tags: {}, extraArgs: offsetTagArgs("-03:00") },
      { backup: false },
    );
    const [meta] = await engine.read([file]);
    expect(meta.OffsetTimeOriginal).toBe("-03:00");
  });
});

describe("config", () => {
  it("saves and loads under XDG_CONFIG_HOME", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-cfg-"));
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    try {
      expect(loadConfig()).toEqual({});
      saveConfig({ sign: { artist: "Davi Arndt", copyright: "© {year} Davi" } });
      expect(loadConfig().sign?.artist).toBe("Davi Arndt");
      expect(configPath().startsWith(dir)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});

describe("diff rows", () => {
  it("splits differing from identical, skipping volatile tags", () => {
    const a = { ISO: 400, Model: "R6", FileName: "a.jpg", SourceFile: "/x/a.jpg", FNumber: 2.8 };
    const b = { ISO: 800, Model: "R6", FileName: "b.jpg", SourceFile: "/x/b.jpg", FNumber: 2.8, Rating: 5 };
    const { differing, identical } = buildDiffRows(a, b);
    expect(differing).toContainEqual(["ISO", "400", "800"]);
    expect(differing).toContainEqual(["Rating", "(absent)", "5"]);
    expect(differing.map(([k]) => k)).not.toContain("FileName");
    expect(identical).toBe(2); // Model, FNumber
  });
});
