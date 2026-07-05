/**
 * All ExifTool access lives here, on top of exiftool-vendored (which ships
 * its own ExifTool binary — users don't need to install anything).
 */

import { ExifTool } from "exiftool-vendored";
import type { Edit } from "./fields.js";

export type Metadata = Record<string, unknown>;

const exiftool = new ExifTool();

/** Read metadata for files as plain tag objects (numeric, machine-readable). */
export async function read(paths: string[]): Promise<Metadata[]> {
  return Promise.all(paths.map((p) => exiftool.readRaw(p, ["-n"])));
}

/**
 * Metadata read twice: `pretty` uses ExifTool's print conversion (e.g.
 * Flash: "Off, Did not fire"), `numeric` has machine values (e.g. signed
 * GPS decimals) for computed formatting.
 */
export interface FullMetadata {
  pretty: Metadata;
  numeric: Metadata;
}

/** Read both human-readable and numeric metadata for the full report view. */
export async function readFull(paths: string[]): Promise<FullMetadata[]> {
  return Promise.all(
    paths.map(async (p) => {
      const [pretty, numeric] = await Promise.all([
        exiftool.readRaw(p, []),
        exiftool.readRaw(p, ["-n"]),
      ]);
      return { pretty, numeric };
    }),
  );
}

export interface WriteOptions {
  /** Keep an untouched copy next to each edited file ('_original' suffix). */
  backup?: boolean;
}

function writeArgsFor(edit: Edit, options: WriteOptions): string[] {
  const args = [...edit.extraArgs, "-P"]; // -P preserves the file's mtime
  if (options.backup === false) args.push("-overwrite_original");
  return args;
}

/** Apply a metadata edit to each file. */
export async function applyEdit(
  paths: string[],
  edit: Edit,
  options: WriteOptions = {},
): Promise<void> {
  const writeArgs = writeArgsFor(edit, options);
  await Promise.all(
    paths.map((p) => exiftool.write(p, edit.tags, { writeArgs })),
  );
}

/** Copy all writable metadata from `source` onto each target file. */
export async function copyMetadata(
  source: string,
  targets: string[],
  options: WriteOptions = {},
): Promise<void> {
  const edit: Edit = {
    tags: {},
    extraArgs: ["-TagsFromFile", source, "-all:all"],
  };
  await applyEdit(targets, edit, options);
}

/** Remove all metadata from the given files (privacy-safe export). */
export async function stripMetadata(
  paths: string[],
  options: WriteOptions = {},
): Promise<void> {
  // -P is pointless here (we're wiping dates anyway) but harmless.
  await applyEdit(paths, { tags: {}, extraArgs: ["-all="] }, options);
}

/** The version of the bundled ExifTool binary. */
export async function exiftoolVersion(): Promise<string> {
  return exiftool.version();
}

/**
 * Shut down the ExifTool child processes. MUST be called before the CLI
 * exits, otherwise the process hangs waiting on them.
 */
export async function end(): Promise<void> {
  await exiftool.end();
}
