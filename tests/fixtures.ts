/** Shared test fixtures. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// A valid 1x1 JPEG (baseline, with full Huffman tables) used as a scratch
// file for write/read round-trip tests. Don't replace it with a "smaller"
// JPEG using arithmetic coding — ExifTool may not write to those.
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
  "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB" +
  "AxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9" +
  "AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6" +
  "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip" +
  "qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIR" +
  "AxEAPwD3+iiigD//2Q==";

export const TINY_JPEG = Buffer.from(TINY_JPEG_B64, "base64");

/** Create a scratch directory with a fresh metadata-free JPEG inside. */
export function makeScratchJpeg(name = "photo.jpg"): {
  dir: string;
  file: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-test-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, TINY_JPEG);
  return { dir, file };
}
