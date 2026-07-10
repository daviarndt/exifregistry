/**
 * `exifreg contact`: render a contact sheet (thumbnail grid with filename
 * and exposure labels) as a single JPEG. Thumbnails reuse prepareSource,
 * so RAW files contribute their embedded previews; labels reuse the
 * portable vector-path text renderer from frame.ts.
 */

import * as path from "node:path";

import sharp from "sharp";
import type { OverlayOptions } from "sharp";

import type { Metadata } from "./engine.js";
import { buildCaption, prepareSource, renderText } from "./frame.js";

export interface ContactOptions {
  columns: number;
  /** Width of each cell's image box in pixels. */
  cellWidth: number;
  title: string;
  onProgress?: (current: number, total: number, file: string) => void;
}

const BG = "#FAF4EC";
const INK = "#2E2E2E";
const INK_SOFT = "#8A8073";
const MARGIN = 48;
const GAP = 18;

export async function renderContactSheet(
  files: string[],
  metadata: Metadata[],
  out: string,
  options: ContactOptions,
): Promise<{ width: number; height: number; cells: number }> {
  const cols = Math.max(1, Math.min(options.columns, files.length));
  const cellW = options.cellWidth;
  const imageH = Math.round((cellW * 3) / 4);
  const labelH = 46;
  const cellH = imageH + labelH;
  const rows = Math.ceil(files.length / cols);

  const headerH = 92;
  const width = MARGIN * 2 + cols * cellW + (cols - 1) * GAP;
  const height = headerH + MARGIN + rows * cellH + (rows - 1) * GAP + MARGIN;

  const composites: OverlayOptions[] = [];

  // Header: title + count, Space Mono.
  const title = await renderText(options.title, 26, INK, true, width - MARGIN * 2);
  if (title) composites.push({ input: title.data, left: MARGIN, top: 34 });
  const sub = await renderText(
    `${files.length} files  ·  contact sheet  ·  exifregistry`,
    13, INK_SOFT, false, width - MARGIN * 2,
  );
  if (sub) composites.push({ input: sub.data, left: MARGIN, top: 34 + (title?.height ?? 0) + 8 });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    options.onProgress?.(i + 1, files.length, path.basename(file));
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = MARGIN + col * (cellW + GAP);
    const cellY = headerH + MARGIN + row * (cellH + GAP);

    const prepared = await prepareSource(file);
    try {
      const thumb = await sharp(prepared.path, { limitInputPixels: 1e9 })
        .rotate()
        .resize(cellW, imageH, { fit: "contain", background: "#E7DDCD" })
        .jpeg({ quality: 88 })
        .toBuffer();
      composites.push({ input: thumb, left: cellX, top: cellY });
    } catch {
      const placeholder = await renderText("(unreadable)", 13, INK_SOFT, false, cellW);
      if (placeholder) {
        composites.push({
          input: placeholder.data,
          left: cellX + Math.round((cellW - placeholder.width) / 2),
          top: cellY + Math.round(imageH / 2),
        });
      }
    } finally {
      prepared.cleanup();
    }

    const name = await renderText(path.basename(file), 12.5, INK, true, cellW);
    if (name) {
      composites.push({ input: name.data, left: cellX, top: cellY + imageH + 8 });
    }
    const details = buildCaption(metadata[i] ?? {}, file).details;
    const info = await renderText(details, 11, INK_SOFT, false, cellW);
    if (info) {
      composites.push({
        input: info.data,
        left: cellX,
        top: cellY + imageH + 8 + (name?.height ?? 0) + 4,
      });
    }
  }

  await sharp({
    create: { width, height, channels: 3, background: BG },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(out);

  return { width, height, cells: files.length };
}
