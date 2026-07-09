import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  buildCaption,
  captionColorFor,
  computeLayout,
  FRAME_COLORS,
  parseRatio,
  renderFrame,
  resolveColor,
} from "../src/frame.js";

describe("resolveColor", () => {
  it("resolves palette names", () => {
    expect(resolveColor("white")).toEqual({ name: "white", hex: "#FFFFFF" });
    expect(resolveColor("Off-White").hex).toBe("#FAF4EC");
  });

  it("accepts raw hex values", () => {
    expect(resolveColor("#a1b2c3")).toEqual({ name: "custom", hex: "#A1B2C3" });
  });

  it("rejects unknown names, listing the palette", () => {
    expect(() => resolveColor("vermelho")).toThrow(/off-white/);
  });

  it("every palette color has a valid hex", () => {
    for (const c of FRAME_COLORS) {
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("captionColorFor", () => {
  it("uses dark text on light frames and light text on dark frames", () => {
    expect(captionColorFor("#FFFFFF")).toBe("#3A3A3A");
    expect(captionColorFor("#000000")).toBe("#EDEDED");
    expect(captionColorFor("#1E2A44")).toBe("#EDEDED"); // navy
  });
});

describe("parseRatio", () => {
  it.each([
    ["1:1", { w: 1, h: 1 }],
    ["4:5", { w: 4, h: 5 }],
    ["16x9", { w: 16, h: 9 }],
  ])("parses %s", (text, expected) => {
    expect(parseRatio(text)).toEqual(expected);
  });

  it("returns null for original", () => {
    expect(parseRatio("original")).toBeNull();
  });

  it("rejects nonsense", () => {
    expect(() => parseRatio("wide")).toThrow(/1:1/);
  });
});

describe("computeLayout", () => {
  it("builds a square canvas with a centered photo", () => {
    const layout = computeLayout({
      imgW: 2000, imgH: 1000, ratio: { w: 1, h: 1 },
      marginPct: 10, caption: "none", size: 1000,
    });
    expect(layout.canvasW).toBe(1000);
    expect(layout.canvasH).toBe(1000);
    expect(layout.photo.width).toBe(800); // fills the box width
    expect(layout.photo.left).toBe(100);
    // vertically centered
    expect(layout.photo.top).toBeGreaterThan(250);
    expect(layout.captionRegion).toBeUndefined();
  });

  it("reserves a bottom strip for the caption", () => {
    const layout = computeLayout({
      imgW: 1000, imgH: 1000, ratio: { w: 1, h: 1 },
      marginPct: 6, caption: "bottom", size: 1000,
    });
    const region = layout.captionRegion!;
    expect(region.top).toBeGreaterThan(layout.photo.top + layout.photo.height - 1);
    expect(region.top + region.height).toBeLessThanOrEqual(layout.canvasH);
  });

  it("puts the caption above the photo when asked", () => {
    const layout = computeLayout({
      imgW: 1000, imgH: 1000, ratio: { w: 1, h: 1 },
      marginPct: 6, caption: "top", size: 1000,
    });
    expect(layout.captionRegion!.top).toBeLessThan(layout.photo.top);
  });

  it("portrait ratios put the long edge on height", () => {
    const layout = computeLayout({
      imgW: 100, imgH: 100, ratio: { w: 9, h: 16 },
      marginPct: 5, caption: "none", size: 1600,
    });
    expect(layout.canvasH).toBe(1600);
    expect(layout.canvasW).toBe(900);
  });

  it("original ratio follows the photo plus margins", () => {
    const layout = computeLayout({
      imgW: 3000, imgH: 2000, ratio: null,
      marginPct: 5, caption: "none", size: 1000,
    });
    expect(layout.photo.width).toBe(900);
    expect(layout.canvasW).toBe(1000);
    expect(layout.canvasH).toBe(layout.photo.height + 100);
  });

  it("rejects absurd margins", () => {
    expect(() =>
      computeLayout({
        imgW: 100, imgH: 100, ratio: { w: 1, h: 1 },
        marginPct: 45, caption: "none", size: 1000,
      }),
    ).toThrow(/[Mm]argin/);
  });
});

describe("buildCaption", () => {
  const meta = {
    Model: "Canon EOS R6",
    FocalLength: 35,
    FNumber: 2.8,
    ExposureTime: 0.004,
    ISO: 400,
  };

  it("omits the camera by default (exposure only)", () => {
    const caption = buildCaption(meta, "/x/IMG_1.CR3");
    expect(caption.title).toBe("");
    expect(caption.details).toBe("35mm  ·  f/2.8  ·  1/250s  ·  ISO 400");
  });

  it("includes the camera only when explicitly requested", () => {
    const caption = buildCaption(meta, "/x/IMG_1.CR3", true);
    expect(caption.title).toBe("CANON EOS R6");
  });

  it("camera flag without a Model tag yields no title", () => {
    const caption = buildCaption({ ISO: 100 }, "/x/a.jpg", true);
    expect(caption.title).toBe("");
    expect(caption.details).toBe("ISO 100");
  });

  it("falls back to the capture date when there is no exposure data", () => {
    const caption = buildCaption(
      { FileName: "IMG_9.png", DateTimeOriginal: "2026:07:05 10:00:00" },
      "/tmp/preview.jpg",
    );
    expect(caption.details).toBe("2026.07.05");
  });
});

describe("full-size rendering", () => {
  it("keeps the photo at native resolution with size: full", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-frame-full-"));
    const src = path.join(dir, "photo.png");
    await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#101010" },
    }).png().toFile(src);

    const out = path.join(dir, "framed.jpg");
    await renderFrame(src, {}, out, {
      color: { name: "white", hex: "#FFFFFF" },
      ratio: null,
      caption: "none",
      marginPct: 5,
      size: "full",
    });
    const meta = await sharp(out).metadata();
    // photo keeps 640px wide; canvas adds ~5% margins on each side
    expect(meta.width!).toBeGreaterThanOrEqual(640 + 2 * Math.floor(0.05 * 640));
    expect(meta.width!).toBeLessThan(640 * 1.25);
  }, 30000);
});

describe("renderFrame (integration)", () => {
  it("renders the frame color, ratio and caption", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-frame-test-"));
    const src = path.join(dir, "photo.png");
    // black 200x100 source photo
    await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#000000" },
    }).png().toFile(src);

    const out = path.join(dir, "framed.jpg");
    await renderFrame(src, { Model: "Test Cam", ISO: 100 }, out, {
      color: { name: "white", hex: "#FFFFFF" },
      ratio: { w: 1, h: 1 },
      caption: "bottom",
      marginPct: 8,
      size: 600,
    });

    const { info, data } = await sharp(out)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(600);
    expect(info.height).toBe(600);
    // corner pixel is the frame color (white-ish, JPEG tolerance)
    expect(data[0]).toBeGreaterThan(245);
    // center pixel is the photo (black-ish)
    const center = (300 * 600 + 300) * info.channels;
    expect(data[center]).toBeLessThan(30);
  }, 30000);
});
