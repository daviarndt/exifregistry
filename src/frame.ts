/**
 * `exifregistry frame`: re-render photos inside an aesthetic colored frame with
 * their EXIF caption, ready for portfolios and social media.
 *
 * Rendering is done by sharp (libvips): high-quality Lanczos resampling,
 * JPEG q95 4:4:4 output. Captions use the bundled Space Mono font (OFL).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as opentype from "opentype.js";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";

import type { Metadata } from "./engine.js";
import { formatExposure } from "./display.js";
import { isRaw } from "./fields.js";

// ---------------------------------------------------------------------------
// Colors

export interface FrameColor {
  name: string;
  hex: string;
}

/** Curated palette: everyday tones first, then the fun ones. */
export const FRAME_COLORS: FrameColor[] = [
  { name: "white", hex: "#FFFFFF" },
  { name: "off-white", hex: "#FAF4EC" },
  { name: "cream", hex: "#F6F1E7" },
  { name: "ivory", hex: "#FFFFF0" },
  { name: "light-gray", hex: "#D9D9D9" },
  { name: "gray", hex: "#9A9A9A" },
  { name: "charcoal", hex: "#2E2E2E" },
  { name: "black", hex: "#000000" },
  // Less common, but lovely
  { name: "sand", hex: "#E7D8C9" },
  { name: "butter", hex: "#F2E3A1" },
  { name: "mustard", hex: "#D4A937" },
  { name: "terracotta", hex: "#C4704F" },
  { name: "dusty-pink", hex: "#D8A7A7" },
  { name: "burgundy", hex: "#5E2B35" },
  { name: "sage", hex: "#B4BBA2" },
  { name: "olive", hex: "#6B7248" },
  { name: "forest", hex: "#24402F" },
  { name: "navy", hex: "#1E2A44" },
  { name: "denim", hex: "#4A6FA5" },
  { name: "slate", hex: "#64748B" },
  { name: "espresso", hex: "#3B2C26" },
];

/** Resolve a color by name from the palette, or accept a raw #RRGGBB hex. */
export function resolveColor(input: string): FrameColor {
  const cleaned = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(cleaned)) {
    return { name: "custom", hex: cleaned.toUpperCase() };
  }
  const found = FRAME_COLORS.find((c) => c.name === cleaned);
  if (found) return found;
  throw new Error(
    `Unknown color "${input}". Pick one of: ` +
      FRAME_COLORS.map((c) => c.name).join(", ") +
      " — or pass a hex value like \"#AABBCC\". " +
      "(See them all with: exifreg frame --colors)",
  );
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Relative luminance (0..1) to decide caption contrast. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Caption text color that reads well on the given frame color. */
export function captionColorFor(frameHex: string): string {
  return luminance(frameHex) > 0.4 ? "#3A3A3A" : "#EDEDED";
}

// ---------------------------------------------------------------------------
// Ratios

export interface Ratio {
  w: number;
  h: number;
}

/** Parse "4:5" / "16x9" / "original" (null = follow the photo's ratio). */
export function parseRatio(input: string): Ratio | null {
  const cleaned = input.trim().toLowerCase();
  if (cleaned === "original" || cleaned === "auto") return null;
  const m = /^(\d+(?:\.\d+)?)[:x](\d+(?:\.\d+)?)$/.exec(cleaned);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > 0 && h > 0) return { w, h };
  }
  throw new Error(
    `Could not understand the ratio "${input}". ` +
      'Use forms like "1:1", "4:5", "9:16", "3:2" — or "original".',
  );
}

// ---------------------------------------------------------------------------
// Layout (pure, unit-testable)

export type CaptionPosition = "top" | "bottom" | "none";

export interface LayoutInput {
  imgW: number;
  imgH: number;
  ratio: Ratio | null;
  marginPct: number;
  caption: CaptionPosition;
  /** Long edge of the final canvas in pixels. */
  size: number;
}

export interface FrameLayout {
  canvasW: number;
  canvasH: number;
  photo: { left: number; top: number; width: number; height: number };
  /** Vertical region reserved for the caption (absent when caption: none). */
  captionRegion?: { top: number; height: number; maxWidth: number };
  titlePx: number;
  detailsPx: number;
}

export function computeLayout(input: LayoutInput): FrameLayout {
  const { imgW, imgH, ratio, marginPct, caption, size } = input;
  if (marginPct < 0 || marginPct > 30) {
    throw new Error("Margin must be between 0 and 30 (percent).");
  }

  const titlePx = Math.max(12, Math.round(size * 0.016));
  const detailsPx = Math.max(10, Math.round(size * 0.0125));
  const captionBlock =
    caption === "none" ? 0 : Math.round(titlePx * 1.6 + detailsPx * 1.8);

  let canvasW: number;
  let canvasH: number;
  let margin: number;

  if (ratio) {
    if (ratio.w >= ratio.h) {
      canvasW = size;
      canvasH = Math.round((size * ratio.h) / ratio.w);
    } else {
      canvasH = size;
      canvasW = Math.round((size * ratio.w) / ratio.h);
    }
    margin = Math.round((marginPct / 100) * Math.min(canvasW, canvasH));
  } else {
    margin = Math.round((marginPct / 100) * size);
    const gapHalf = Math.round(margin / 2);
    const photoLong = Math.max(50, size - 2 * margin);
    const scale = photoLong / Math.max(imgW, imgH);
    const w = Math.round(imgW * scale);
    const h = Math.round(imgH * scale);
    canvasW = w + 2 * margin;
    canvasH = h + 2 * margin + (captionBlock ? captionBlock + gapHalf : 0);
    const top = margin + (caption === "top" ? captionBlock + gapHalf : 0);
    return {
      canvasW,
      canvasH,
      photo: { left: margin, top, width: w, height: h },
      captionRegion:
        caption === "none"
          ? undefined
          : {
              top: caption === "top" ? margin : top + h + gapHalf,
              height: captionBlock,
              maxWidth: w,
            },
      titlePx,
      detailsPx,
    };
  }

  const gap = captionBlock ? Math.round(margin / 2) : 0;
  const boxTop = margin + (caption === "top" ? captionBlock + gap : 0);
  const boxBottom = canvasH - margin - (caption === "bottom" ? captionBlock + gap : 0);
  const boxW = canvasW - 2 * margin;
  const boxH = boxBottom - boxTop;
  if (boxW <= 0 || boxH <= 0) {
    throw new Error("Margin too large for this size/ratio — reduce --margin.");
  }
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const width = Math.max(1, Math.round(imgW * scale));
  const height = Math.max(1, Math.round(imgH * scale));
  const left = margin + Math.round((boxW - width) / 2);
  const top = boxTop + Math.round((boxH - height) / 2);

  return {
    canvasW,
    canvasH,
    photo: { left, top, width, height },
    captionRegion:
      caption === "none"
        ? undefined
        : {
            top: caption === "top" ? margin : boxBottom + gap,
            height: captionBlock,
            maxWidth: boxW,
          },
    titlePx,
    detailsPx,
  };
}

// ---------------------------------------------------------------------------
// Caption content

export interface Caption {
  title: string;
  details: string;
}

/**
 * Build the caption from metadata: the exposure recipe, plus the camera
 * model on top — but only when explicitly requested (`includeCamera`).
 */
export function buildCaption(
  metadata: Metadata,
  file: string,
  includeCamera = false,
): Caption {
  const model = metadata.Model ?? metadata.Make;
  const title = includeCamera && model ? String(model).trim().toUpperCase() : "";

  const parts: string[] = [];
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  if (metadata.FocalLength !== undefined) {
    parts.push(`${num(metadata.FocalLength)}mm`);
  }
  if (metadata.FNumber !== undefined) parts.push(`f/${num(metadata.FNumber)}`);
  if (metadata.ExposureTime !== undefined) {
    parts.push(formatExposure(metadata.ExposureTime));
  }
  if (metadata.ISO !== undefined) parts.push(`ISO ${metadata.ISO}`);

  let details = parts.join("  ·  ");
  if (!details) {
    const date = metadata.DateTimeOriginal ?? metadata.CreateDate;
    if (typeof date === "string") {
      details = date.slice(0, 10).replace(/:/g, ".");
    }
  }
  return { title, details };
}

// ---------------------------------------------------------------------------
// Rendering

const ASSETS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
);
const FONT_REGULAR = path.join(ASSETS_DIR, "fonts", "SpaceMono-Regular.ttf");
const FONT_BOLD = path.join(ASSETS_DIR, "fonts", "SpaceMono-Bold.ttf");

// Caption text is rendered as SVG vector paths straight from the bundled
// TTFs (opentype.js). This is deliberate: sharp's Pango/fontconfig ignores
// per-file fonts on macOS prebuilds, silently falling back to a proportional
// font unless Space Mono happens to be installed system-wide. Vector paths
// are deterministic on every platform. Do not switch back to Pango text.
const fontCache = new Map<string, opentype.Font>();

function loadFont(bold: boolean): opentype.Font {
  const file = bold ? FONT_BOLD : FONT_REGULAR;
  let font = fontCache.get(file);
  if (!font) {
    const buf = fs.readFileSync(file);
    font = opentype.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    fontCache.set(file, font);
  }
  return font;
}

const LETTER_SPACING = 0.02; // em — subtle tracking, matches the brand look

export async function renderText(
  text: string,
  sizePx: number,
  color: string,
  bold: boolean,
  maxWidth: number,
): Promise<{ data: Buffer; width: number; height: number } | undefined> {
  if (!text) return undefined;
  const font = loadFont(bold);
  const options = { kerning: true, letterSpacing: LETTER_SPACING };

  // Shrink to fit rather than wrap: captions read better on one line.
  let size = sizePx;
  let width = font.getAdvanceWidth(text, size, options);
  if (width > maxWidth) {
    size = (size * maxWidth) / width;
    width = font.getAdvanceWidth(text, size, options);
  }

  const ascent = (font.ascender / font.unitsPerEm) * size;
  const descent = (-font.descender / font.unitsPerEm) * size;
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(ascent + descent));
  const d = font.getPath(text, 0, ascent, size, options).toPathData(2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}"><path d="${d}" fill="${color}"/></svg>`;

  const { data, info } = await sharp(Buffer.from(svg))
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Make a decodable image for sharp: RAW files yield their embedded JPEG
 * preview; HEIC on macOS is converted via sips (sharp prebuilds lack HEVC).
 * Returns the path to use and a cleanup function for any temp files.
 */
export async function prepareSource(
  file: string,
): Promise<{ path: string; cleanup: () => void }> {
  const ext = path.extname(file).toLowerCase();
  const none = { path: file, cleanup: () => {} };

  if (isRaw(file)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-frame-"));
    const preview = path.join(dir, "preview.jpg");
    const engine = await import("./engine.js");
    await engine.extractRawPreview(file, preview);
    return { path: preview, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  if ((ext === ".heic" || ext === ".heif") && process.platform === "darwin") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-frame-"));
    const jpeg = path.join(dir, "converted.jpg");
    const { execFileSync } = await import("node:child_process");
    execFileSync("sips", [
      "-s", "format", "jpeg", "-s", "formatOptions", "best", file, "--out", jpeg,
    ], { stdio: "ignore" });
    return { path: jpeg, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  return none;
}

export interface FrameOptions {
  color: FrameColor;
  ratio: Ratio | null;
  caption: CaptionPosition;
  marginPct: number;
  /** Long edge of the final canvas, or "full" to keep the photo at native resolution. */
  size: number | "full";
  /** Show the camera model above the exposure line (opt-in). */
  showCamera?: boolean;
  /** JPEG quality of the render (default 95). */
  quality?: number;
}

/**
 * Render one framed photo to `out` (JPEG q95). `prepared` is the decodable
 * image file (the original, or an extracted RAW preview / converted HEIC).
 */
export async function renderFrame(
  prepared: string,
  metadata: Metadata,
  out: string,
  options: FrameOptions,
): Promise<void> {
  const image = sharp(prepared, { limitInputPixels: 1e9 }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not decode "${prepared}".`);
  }
  // .rotate() applies EXIF orientation; swap dims for rotated originals.
  const rotated = (meta.orientation ?? 1) >= 5;
  const imgW = rotated ? meta.height : meta.width;
  const imgH = rotated ? meta.width : meta.height;

  // "full": find the canvas size at which the photo keeps its native
  // resolution. Layout scales linearly with size, so probe once and scale.
  let size: number;
  if (options.size === "full") {
    const probe = computeLayout({
      imgW, imgH,
      ratio: options.ratio,
      marginPct: options.marginPct,
      caption: options.caption,
      size: 1000,
    });
    const scale = Math.max(imgW / probe.photo.width, imgH / probe.photo.height);
    size = Math.ceil(1000 * scale);
  } else {
    size = options.size;
  }

  const layout = computeLayout({
    imgW,
    imgH,
    ratio: options.ratio,
    marginPct: options.marginPct,
    caption: options.caption,
    size,
  });

  const photo = await image
    .resize(layout.photo.width, layout.photo.height, { fit: "fill" })
    .toBuffer();

  const composites: OverlayOptions[] = [
    { input: photo, left: layout.photo.left, top: layout.photo.top },
  ];

  if (layout.captionRegion) {
    const caption = buildCaption(metadata, prepared, options.showCamera);
    const color = captionColorFor(options.color.hex);
    const region = layout.captionRegion;
    const title = await renderText(
      caption.title, layout.titlePx, color, true, region.maxWidth,
    );
    const details = await renderText(
      caption.details, layout.detailsPx, color, false, region.maxWidth,
    );
    const totalH =
      (title?.height ?? 0) +
      (title && details ? Math.round(layout.detailsPx * 0.6) : 0) +
      (details?.height ?? 0);
    let y = region.top + Math.max(0, Math.round((region.height - totalH) / 2));
    for (const block of [title, details]) {
      if (!block) continue;
      composites.push({
        input: block.data,
        left: Math.round(layout.canvasW / 2 - block.width / 2),
        top: y,
      });
      y += block.height + Math.round(layout.detailsPx * 0.6);
    }
  }

  await sharp({
    create: {
      width: layout.canvasW,
      height: layout.canvasH,
      channels: 3,
      background: options.color.hex,
    },
  })
    .composite(composites)
    .jpeg({ quality: options.quality ?? 95, chromaSubsampling: "4:4:4" })
    .toFile(out);
}
