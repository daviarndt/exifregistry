import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { Metadata } from "../src/engine.js";
import {
  executePlan,
  groupWithCompanions,
  journalBatch,
  planOrganize,
  planRename,
  sha256,
  undoLastBatch,
} from "../src/organizer.js";
import { findDupes } from "../src/dupes.js";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-org-"));
}

function touch(dir: string, name: string, content = name): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

const META: Metadata = { DateTimeOriginal: "2026:07:05 14:30:22" };

describe("groupWithCompanions", () => {
  it("groups RAW+JPEG pairs and sidecars, picking the RAW as primary", () => {
    const dir = scratchDir();
    const raw = touch(dir, "IMG_1.CR3");
    touch(dir, "IMG_1.JPG");
    touch(dir, "IMG_1.xmp");
    touch(dir, "IMG_1.CR3.xmp"); // double-extension sidecar convention
    touch(dir, "IMG_2.JPG"); // unrelated

    const groups = groupWithCompanions([raw]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary).toBe(raw);
    expect(groups[0].members.map((m) => path.basename(m)).sort()).toEqual([
      "IMG_1.CR3", "IMG_1.CR3.xmp", "IMG_1.JPG", "IMG_1.xmp",
    ]);
  });

  it("does not duplicate groups when both pair members are selected", () => {
    const dir = scratchDir();
    const raw = touch(dir, "IMG_1.CR3");
    const jpg = touch(dir, "IMG_1.JPG");
    expect(groupWithCompanions([raw, jpg])).toHaveLength(1);
  });
});

describe("planOrganize + executePlan + undo", () => {
  it("moves a pair into the pattern folder and undoes it", async () => {
    const dir = scratchDir();
    const dest = scratchDir();
    const raw = touch(dir, "IMG_1.CR3");
    touch(dir, "IMG_1.xmp");

    const groups = groupWithCompanions([raw]);
    const ops = planOrganize(groups, new Map([[raw, META]]), {
      pattern: "{year}/{date}",
      destRoot: dest,
    });
    expect(ops).toHaveLength(2);
    expect(ops[0].target).toContain(path.join(dest, "2026", "2026-07-05"));

    const done = await executePlan(ops);
    journalBatch(dest, "organize", done, false);
    expect(fs.existsSync(path.join(dest, "2026", "2026-07-05", "IMG_1.CR3"))).toBe(true);
    expect(fs.existsSync(raw)).toBe(false);

    const batch = undoLastBatch(dest);
    expect(batch?.ops).toHaveLength(2);
    expect(fs.existsSync(raw)).toBe(true);
    expect(undoLastBatch(dest)).toBeUndefined(); // journal now empty
  });

  it("never overwrites: collisions get a numeric suffix", async () => {
    const dir = scratchDir();
    const dest = scratchDir();
    fs.mkdirSync(path.join(dest, "2026", "2026-07-05"), { recursive: true });
    touch(path.join(dest, "2026", "2026-07-05"), "IMG_1.CR3", "existing");
    const raw = touch(dir, "IMG_1.CR3", "incoming");

    const ops = planOrganize(groupWithCompanions([raw]), new Map([[raw, META]]), {
      pattern: "{year}/{date}",
      destRoot: dest,
    });
    expect(path.basename(ops[0].target)).toBe("IMG_1_1.CR3");
    await executePlan(ops);
    expect(
      fs.readFileSync(path.join(dest, "2026", "2026-07-05", "IMG_1.CR3"), "utf8"),
    ).toBe("existing");
  });

  it("copy mode with verify keeps the source and checks checksums", async () => {
    const dir = scratchDir();
    const dest = scratchDir();
    const raw = touch(dir, "IMG_1.CR3", "raw-bytes");
    const ops = planOrganize(groupWithCompanions([raw]), new Map([[raw, META]]), {
      pattern: "{date}",
      destRoot: dest,
    });
    await executePlan(ops, { copy: true, verify: true });
    expect(fs.existsSync(raw)).toBe(true);
    expect(await sha256(ops[0].target)).toBe(await sha256(raw));
  });

  it("undo of a copy removes the copies but keeps sources", async () => {
    const dir = scratchDir();
    const dest = scratchDir();
    const raw = touch(dir, "IMG_1.CR3");
    const ops = planOrganize(groupWithCompanions([raw]), new Map([[raw, META]]), {
      pattern: "{date}",
      destRoot: dest,
    });
    const done = await executePlan(ops, { copy: true });
    journalBatch(dest, "ingest", done, true);
    undoLastBatch(dest);
    expect(fs.existsSync(raw)).toBe(true);
    expect(fs.existsSync(ops[0].target)).toBe(false);
  });
});

describe("planRename", () => {
  it("renames the whole group to a shared stem", () => {
    const dir = scratchDir();
    const raw = touch(dir, "IMG_1.CR3");
    touch(dir, "IMG_1.JPG");
    touch(dir, "IMG_1.CR3.xmp");

    const ops = planRename(groupWithCompanions([raw]), new Map([[raw, META]]), {
      pattern: "{date}_{time}_{name}",
    });
    const names = ops.map((op) => path.basename(op.target)).sort();
    expect(names).toEqual([
      "2026-07-05_143022_IMG_1.CR3",
      "2026-07-05_143022_IMG_1.CR3.xmp",
      "2026-07-05_143022_IMG_1.JPG",
    ]);
  });

  it("applies {counter} in chronological group order", () => {
    const dir = scratchDir();
    const a = touch(dir, "A.JPG");
    const b = touch(dir, "B.JPG");
    const meta = new Map<string, Metadata>([
      [a, META],
      [b, { DateTimeOriginal: "2026:07:05 15:00:00" }],
    ]);
    const ops = planRename(groupWithCompanions([a, b]), meta, {
      pattern: "shoot_{counter:2}",
    });
    expect(ops.map((op) => path.basename(op.target))).toEqual([
      "shoot_01.JPG",
      "shoot_02.JPG",
    ]);
  });

  it("rejects folder separators in rename patterns", () => {
    expect(() => planRename([], new Map(), { pattern: "{year}/{name}" })).toThrow(
      /organize/,
    );
  });
});

describe("findDupes", () => {
  it("groups byte-identical files only", async () => {
    const dir = scratchDir();
    const a = touch(dir, "a.jpg", "same-bytes");
    const b = touch(dir, "b.jpg", "same-bytes");
    touch(dir, "c.jpg", "different");
    touch(dir, "d.jpg", "same-size!"); // same length as "same-bytes"

    const groups = await findDupes(
      fs.readdirSync(dir).map((f) => path.join(dir, f)),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].files.sort()).toEqual([a, b].sort());
  });
});
