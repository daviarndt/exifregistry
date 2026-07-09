/**
 * `exifregistry resize`: resize and convert photos into NEW files.
 *
 * Non-destructive by design: the original is never modified, the output is
 * a separate file (collision-safe name), and the original's EXIF is copied
 * onto it. For a target file size ("--max-size 1mb") a binary search finds
 * the highest quality that fits, downscaling as a last resort.
 */

import sharp from "sharp";
import type { Sharp } from "sharp";

export type OutputFormat = "jpeg" | "png" | "webp" | "avif" | "tiff";

const FORMAT_EXTENSIONS: Record<OutputFormat, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  avif: ".avif",
  tiff: ".tif",
};

export function extensionFor(format: OutputFormat): string {
  return FORMAT_EXTENSIONS[format];
}

export function parseFormat(input: string): OutputFormat {
  const cleaned = input.trim().toLowerCase();
  const alias: Record<string, OutputFormat> = {
    jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", avif: "avif",
    tif: "tiff", tiff: "tiff",
  };
  const format = alias[cleaned];
  if (!format) {
    throw new Error(
      `Unsupported output format "${input}". Use jpeg, png, webp, avif or tiff.`,
    );
  }
  return format;
}

/** Default output format for a source file (HEIC/RAW re-encode as JPEG). */
export function defaultFormatFor(sourceExt: string): OutputFormat {
  const alias: Record<string, OutputFormat> = {
    ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp",
    ".tif": "tiff", ".tiff": "tiff", ".avif": "avif",
  };
  return alias[sourceExt.toLowerCase()] ?? "jpeg";
}

/** Parse "1mb", "500kb", "2.5MB" or plain bytes into a byte count. */
export function parseByteSize(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(input.trim());
  if (!m) {
    throw new Error(
      `Could not understand the size "${input}". Use forms like "1mb" or "500kb".`,
    );
  }
  const value = Number(m[1]);
  const unit = (m[2] ?? "b").toLowerCase();
  const factor = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[unit]!;
  const bytes = Math.round(value * factor);
  if (bytes < 1024) {
    throw new Error(`Target size ${input} is too small to be a photo.`);
  }
  return bytes;
}

export interface DimensionOptions {
  width?: number;
  height?: number;
  /** Target for the long edge — the most common photographer resize. */
  long?: number;
  percent?: number;
}

/** Compute output dimensions, preserving aspect ratio. Pure. */
export function computeTargetDims(
  imgW: number,
  imgH: number,
  o: DimensionOptions,
): { w: number; h: number } {
  let scale = 1;
  if (o.percent !== undefined) {
    if (o.percent <= 0) throw new Error("Percent must be positive.");
    scale = o.percent / 100;
  } else if (o.long !== undefined) {
    if (o.long <= 0) throw new Error("Long-edge size must be positive.");
    scale = o.long / Math.max(imgW, imgH);
  } else if (o.width !== undefined || o.height !== undefined) {
    const sw = o.width !== undefined ? o.width / imgW : Infinity;
    const sh = o.height !== undefined ? o.height / imgH : Infinity;
    scale = Math.min(sw, sh);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error("Width/height must be positive.");
    }
  }
  return {
    w: Math.max(1, Math.round(imgW * scale)),
    h: Math.max(1, Math.round(imgH * scale)),
  };
}

export interface ResizeResult {
  buffer: Buffer;
  width: number;
  height: number;
  quality?: number;
}

function encoderFor(
  pipeline: Sharp,
  format: OutputFormat,
  quality: number,
): Sharp {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true });
    case "webp":
      return pipeline.webp({ quality });
    case "avif":
      return pipeline.avif({ quality });
    case "tiff":
      return pipeline.tiff({ quality });
    case "png":
      return pipeline.png({ compressionLevel: 9 });
  }
}

/**
 * Render `source` at the requested dimensions/format. With `maxBytes`, a
 * binary search over quality (and, as a last resort, dimensions) finds the
 * highest quality that fits.
 */
export async function resizeImage(
  source: string,
  dims: DimensionOptions,
  format: OutputFormat,
  options: { quality?: number; maxBytes?: number } = {},
): Promise<ResizeResult> {
  const base = sharp(source, { limitInputPixels: 1e9 }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not decode "${source}".`);
  }
  const rotated = (meta.orientation ?? 1) >= 5;
  const imgW = rotated ? meta.height : meta.width;
  const imgH = rotated ? meta.width : meta.height;
  const target = computeTargetDims(imgW, imgH, dims);

  const encode = async (w: number, h: number, quality: number) =>
    encoderFor(
      base.clone().resize(w, h, { fit: "fill" }).keepIccProfile(),
      format,
      quality,
    ).toBuffer();

  if (options.maxBytes === undefined) {
    const quality = options.quality ?? 85;
    const buffer = await encode(target.w, target.h, quality);
    return {
      buffer, width: target.w, height: target.h,
      quality: format === "png" ? undefined : quality,
    };
  }

  if (format === "png") {
    throw new Error(
      "--max-size needs a quality-based format — use --format jpeg (or webp/avif).",
    );
  }

  // Outer loop: shrink dimensions only if even the lowest quality is too big.
  let scale = 1;
  for (let attempt = 0; attempt < 7; attempt++) {
    const w = Math.max(1, Math.round(target.w * scale));
    const h = Math.max(1, Math.round(target.h * scale));
    let lo = 20;
    let hi = 95;
    let best: ResizeResult | undefined;
    while (lo <= hi) {
      const quality = Math.floor((lo + hi) / 2);
      const buffer = await encode(w, h, quality);
      if (buffer.length <= options.maxBytes) {
        best = { buffer, width: w, height: h, quality };
        lo = quality + 1; // try higher quality
      } else {
        hi = quality - 1;
      }
    }
    if (best) return best;
    scale *= 0.8;
  }
  throw new Error(
    "Could not reach the target size even at minimum quality — " +
      "try a larger --max-size or a smaller --long.",
  );
}
