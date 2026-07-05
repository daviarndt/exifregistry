import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { planRestore, restore } from "../src/undo.js";
import { makeScratchJpeg, TINY_JPEG } from "./fixtures.js";

function makeEditedPair(): { dir: string; file: string; backup: string } {
  const { dir, file } = makeScratchJpeg();
  const backup = `${file}_original`;
  fs.writeFileSync(backup, TINY_JPEG); // pristine copy
  fs.appendFileSync(file, Buffer.from([0x00])); // "edited" file differs
  return { dir, file, backup };
}

describe("planRestore", () => {
  it("finds the backup for an edited file", () => {
    const { file, backup } = makeEditedPair();
    expect(planRestore([file])).toEqual([{ target: file, backup }]);
  });

  it("accepts the backup file itself", () => {
    const { file, backup } = makeEditedPair();
    expect(planRestore([backup])).toEqual([{ target: file, backup }]);
  });

  it("scans directories for backups", () => {
    const { dir, file, backup } = makeEditedPair();
    expect(planRestore([dir])).toEqual([{ target: file, backup }]);
  });

  it("de-duplicates when both the file and its backup are given", () => {
    const { file, backup } = makeEditedPair();
    expect(planRestore([file, backup])).toHaveLength(1);
  });

  it("throws when there is no backup", () => {
    const { file } = makeScratchJpeg();
    expect(() => planRestore([file])).toThrow(/No backup found/);
  });

  it("returns an empty plan for a directory without backups", () => {
    const { dir } = makeScratchJpeg();
    expect(planRestore([dir])).toEqual([]);
  });
});

describe("restore", () => {
  it("moves the backup back over the edited file", () => {
    const { file, backup } = makeEditedPair();
    restore(planRestore([file]));
    expect(fs.existsSync(backup)).toBe(false);
    expect(fs.readFileSync(file)).toEqual(TINY_JPEG);
  });
});
