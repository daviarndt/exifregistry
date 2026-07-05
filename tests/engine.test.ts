/** Integration tests: real ExifTool round-trips on a scratch JPEG. */

import * as fs from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import * as engine from "../src/engine.js";
import * as fields from "../src/fields.js";
import { makeScratchJpeg } from "./fixtures.js";

afterAll(async () => {
  await engine.end();
});

describe("engine round-trips", () => {
  it("writes and reads GPS", async () => {
    const { file } = makeScratchJpeg();
    await engine.applyEdit([file], fields.gpsEdit(-23.5505, -46.6333, 760), {
      backup: false,
    });
    const [metadata] = await engine.read([file]);
    expect(metadata.GPSLatitude).toBeCloseTo(-23.5505, 4);
    expect(metadata.GPSLongitude).toBeCloseTo(-46.6333, 4);
    expect(metadata.GPSAltitude).toBeCloseTo(760, 1);
  });

  it("removes GPS", async () => {
    const { file } = makeScratchJpeg();
    await engine.applyEdit([file], fields.gpsEdit(10, 20), { backup: false });
    await engine.applyEdit([file], fields.gpsRemoveEdit(), { backup: false });
    const [metadata] = await engine.read([file]);
    expect(metadata.GPSLatitude).toBeUndefined();
  });

  it("writes and reads the capture date", async () => {
    const { file } = makeScratchJpeg();
    await engine.applyEdit([file], fields.captureDateEdit("2024:06:01 14:30:00"), {
      backup: false,
    });
    const [metadata] = await engine.read([file]);
    expect(metadata.DateTimeOriginal).toBe("2024:06:01 14:30:00");
    expect(metadata.CreateDate).toBe("2024:06:01 14:30:00");
  });

  it("shifts dates", async () => {
    const { file } = makeScratchJpeg();
    await engine.applyEdit([file], fields.captureDateEdit("2024:06:01 14:30:00"), {
      backup: false,
    });
    const [operator, amount] = fields.parseShift("+2h");
    await engine.applyEdit([file], fields.shiftEdit(operator, amount), {
      backup: false,
    });
    const [metadata] = await engine.read([file]);
    expect(metadata.DateTimeOriginal).toBe("2024:06:01 16:30:00");
  });

  it("keeps a backup copy by default", async () => {
    const { file } = makeScratchJpeg();
    await engine.applyEdit([file], fields.captureDateEdit("2024:06:01 14:30:00"));
    expect(fs.existsSync(`${file}_original`)).toBe(true);
  });

  it("copies metadata between files", async () => {
    const { file } = makeScratchJpeg();
    const { file: target } = makeScratchJpeg("copy.jpg");
    await engine.applyEdit([file], fields.captureDateEdit("2024:06:01 14:30:00"), {
      backup: false,
    });
    await engine.copyMetadata(file, [target], { backup: false });
    const [metadata] = await engine.read([target]);
    expect(metadata.DateTimeOriginal).toBe("2024:06:01 14:30:00");
  });

  it("strips all metadata", async () => {
    const { file } = makeScratchJpeg();
    await engine.applyEdit([file], fields.gpsEdit(10, 20), { backup: false });
    await engine.stripMetadata([file], { backup: false });
    const [metadata] = await engine.read([file]);
    expect(metadata.GPSLatitude).toBeUndefined();
    expect(metadata.DateTimeOriginal).toBeUndefined();
  });
});
