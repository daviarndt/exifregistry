import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  computeTargetDims,
  defaultFormatFor,
  parseByteSize,
  parseFormat,
  resizeImage,
} from "../src/resize.js";

describe("parseByteSize", () => {
  it.each([
    ["1mb", 1024 * 1024],
    ["500kb", 500 * 1024],
    ["2.5MB", Math.round(2.5 * 1024 * 1024)],
    ["2048", 2048],
  ])("parses %s", (text, expected) => {
    expect(parseByteSize(text)).toBe(expected);
  });

  it.each(["", "big", "10 potatoes", "100b"])("rejects %s", (text) => {
    expect(() => parseByteSize(text)).toThrow();
  });
});

describe("parseFormat / defaultFormatFor", () => {
  it("normalizes aliases", () => {
    expect(parseFormat("JPG")).toBe("jpeg");
    expect(parseFormat("tif")).toBe("tiff");
    expect(() => parseFormat("bmp")).toThrow(/jpeg/);
  });

  it("keeps the source format, but HEIC/RAW become jpeg", () => {
    expect(defaultFormatFor(".png")).toBe("png");
    expect(defaultFormatFor(".JPG")).toBe("jpeg");
    expect(defaultFormatFor(".heic")).toBe("jpeg");
    expect(defaultFormatFor(".cr3")).toBe("jpeg");
  });
});

describe("computeTargetDims", () => {
  it("resizes by long edge, preserving aspect", () => {
    expect(computeTargetDims(6000, 4000, { long: 3000 })).toEqual({ w: 3000, h: 2000 });
    expect(computeTargetDims(4000, 6000, { long: 3000 })).toEqual({ w: 2000, h: 3000 });
  });

  it("fits inside width/height", () => {
    expect(computeTargetDims(6000, 4000, { width: 1200 })).toEqual({ w: 1200, h: 800 });
    expect(computeTargetDims(6000, 4000, { width: 1200, height: 400 })).toEqual({
      w: 600, h: 400,
    });
  });

  it("scales by percent", () => {
    expect(computeTargetDims(6000, 4000, { percent: 50 })).toEqual({ w: 3000, h: 2000 });
  });

  it("keeps original dims when nothing is requested", () => {
    expect(computeTargetDims(6000, 4000, {})).toEqual({ w: 6000, h: 4000 });
  });
});

describe("resizeImage (integration)", () => {
  async function noisyJpeg(dir: string, w = 1600, h = 1200): Promise<string> {
    // Random noise compresses terribly -> a reliably large JPEG.
    const raw = crypto.randomBytes(w * h * 3);
    const file = path.join(dir, "big.jpg");
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(file);
    return file;
  }

  it("hits a target file size with the best quality that fits", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifkit-resize-"));
    const source = await noisyJpeg(dir);
    const originalSize = fs.statSync(source).size;
    const target = 200 * 1024;
    expect(originalSize).toBeGreaterThan(target); // premise

    const result = await resizeImage(source, {}, "jpeg", { maxBytes: target });
    expect(result.buffer.length).toBeLessThanOrEqual(target);
    expect(result.quality).toBeGreaterThanOrEqual(20);
  }, 60000);

  it("resizes by long edge and converts format", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifkit-resize-"));
    const source = await noisyJpeg(dir);
    const result = await resizeImage(source, { long: 800 }, "webp", { quality: 80 });
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(800);
  }, 60000);

  it("refuses --max-size for png", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifkit-resize-"));
    const source = await noisyJpeg(dir);
    await expect(
      resizeImage(source, {}, "png", { maxBytes: 100 * 1024 }),
    ).rejects.toThrow(/jpeg/);
  }, 60000);
});
