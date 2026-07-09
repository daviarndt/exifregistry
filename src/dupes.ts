/**
 * Duplicate detection: group files by size, then confirm with SHA-256.
 * Only files with byte-identical content are reported as duplicates.
 */

import * as fs from "node:fs";

import { sha256 } from "./organizer.js";

export interface DupeGroup {
  hash: string;
  size: number;
  /** Byte-identical files, sorted; the first one is kept by `--delete`. */
  files: string[];
}

export async function findDupes(files: string[]): Promise<DupeGroup[]> {
  const bySize = new Map<number, string[]>();
  for (const file of files) {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    const list = bySize.get(stat.size) ?? [];
    list.push(file);
    bySize.set(stat.size, list);
  }

  const groups: DupeGroup[] = [];
  for (const [size, candidates] of bySize) {
    if (candidates.length < 2) continue;
    const byHash = new Map<string, string[]>();
    for (const file of candidates) {
      const hash = await sha256(file);
      const list = byHash.get(hash) ?? [];
      list.push(file);
      byHash.set(hash, list);
    }
    for (const [hash, sameContent] of byHash) {
      if (sameContent.length > 1) {
        groups.push({ hash, size, files: sameContent.sort() });
      }
    }
  }
  return groups.sort((a, b) => a.files[0].localeCompare(b.files[0]));
}
