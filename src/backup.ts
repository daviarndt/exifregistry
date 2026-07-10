/**
 * Verified, append-only backups for photo libraries.
 *
 * Model:
 *  - A JSON manifest at the backup root records, for every backed-up file:
 *    source path, size, mtime, SHA-256, key EXIF (capture date, camera).
 *  - Backup never deletes anything at the destination. Files that changed
 *    at the source are VERSIONED (the old copy moves under `_versions/`),
 *    never overwritten. Files deleted at the source stay in the backup.
 *  - Every copy is atomic and verified: write to a partial name, hash both
 *    sides, then rename into place.
 *  - `verify` re-hashes the whole backup against the manifest, catching
 *    silent corruption (bit rot) years later.
 *
 * This module is pure fs + hashing (no ExifTool): metadata enrichment is
 * injected by the CLI so everything here is fast to unit test.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { SIDECAR_EXTENSIONS, SUPPORTED_EXTENSIONS, extensionOf } from "./fields.js";
import { sha256 } from "./organizer.js";

export const MANIFEST_NAME = ".exifregistry-backup-manifest.json";
const PARTIAL_SUFFIX = ".exifregistry-partial";
const VERSIONS_DIR = "_versions";
/** exFAT rounds mtimes to 2s; do not treat that as a modification. */
const MTIME_TOLERANCE_MS = 2000;

export interface ManifestVersion {
  /** Path of the archived version, relative to the backup root. */
  path: string;
  sha256: string;
  replacedAt: string;
}

export interface ManifestEntry {
  /** Absolute path of the file at the source. */
  source: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  backedUpAt: string;
  /** EXIF capture date ("YYYY:MM:DD HH:MM:SS"), when known. */
  takenAt?: string;
  camera?: string;
  versions?: ManifestVersion[];
}

export interface Manifest {
  version: 1;
  created: string;
  updated: string;
  /** Keyed by destination path relative to the backup root (posix "/"). */
  entries: Record<string, ManifestEntry>;
}

export function manifestPath(root: string): string {
  return path.join(root, MANIFEST_NAME);
}

export function loadManifest(root: string): Manifest {
  const file = manifestPath(root);
  if (!fs.existsSync(file)) {
    const now = new Date().toISOString();
    return { version: 1, created: now, updated: now, entries: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
    if (parsed.version !== 1 || typeof parsed.entries !== "object") {
      throw new Error("unrecognized structure");
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `The backup manifest at "${file}" is unreadable (${(err as Error).message}). ` +
        "Refusing to continue rather than risk the backup. " +
        "If the file is truly corrupted, move it aside and re-run backup: " +
        "files already present will be re-indexed as new versions.",
    );
  }
}

/** Atomic manifest write: the previous manifest is never half-overwritten. */
export function saveManifest(root: string, manifest: Manifest): void {
  manifest.updated = new Date().toISOString();
  const file = manifestPath(root);
  const tmp = file + PARTIAL_SUFFIX;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Scanning & planning

export interface Candidate {
  source: string;
  /** Proposed destination path relative to the backup root (posix). */
  relPath: string;
}

function isBackupFile(name: string): boolean {
  if (name.startsWith(".")) return false; // .DS_Store and friends
  if (name.endsWith(PARTIAL_SUFFIX)) return false;
  const ext = extensionOf(name);
  return SUPPORTED_EXTENSIONS.has(ext) || SIDECAR_EXTENSIONS.has(ext);
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir).sort()) {
    if (entry === VERSIONS_DIR || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    if (stat?.isDirectory()) walk(full, out);
    else if (stat?.isFile() && isBackupFile(entry)) out.push(full);
  }
}

/**
 * Default layout: mirror each source folder under the backup root, prefixed
 * with the folder's own name ("~/Photos/2026" -> "<root>/2026/...").
 */
export function collectMirrorCandidates(inputs: string[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const abs = path.resolve(input);
    const stat = fs.statSync(abs, { throwIfNoEntry: false });
    if (!stat) throw new Error(`"${input}" does not exist.`);
    if (stat.isFile()) {
      if (!isBackupFile(path.basename(abs))) {
        throw new Error(`"${input}" is not a photo, video or sidecar file.`);
      }
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push({ source: input, relPath: path.basename(abs) });
      }
      continue;
    }
    const files: string[] = [];
    walk(abs, files);
    const prefix = path.basename(abs);
    for (const file of files) {
      const resolved = path.resolve(file);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const rel = path.relative(abs, file).split(path.sep).join("/");
      out.push({ source: file, relPath: `${prefix}/${rel}` });
    }
  }
  return out;
}

/** The backup root must not live inside a source folder (endless recursion). */
export function assertRootOutsideSources(root: string, inputs: string[]): void {
  const absRoot = path.resolve(root);
  for (const input of inputs) {
    const absIn = path.resolve(input);
    if (absRoot === absIn || absRoot.startsWith(absIn + path.sep)) {
      throw new Error(
        `The backup destination "${root}" is inside the source "${input}". ` +
          "Pick a destination outside the folders being backed up.",
      );
    }
  }
}

export interface BackupPlanItem {
  source: string;
  relPath: string;
  reason: "new" | "modified";
  size: number;
  mtimeMs: number;
}

export interface BackupPlan {
  items: BackupPlanItem[];
  unchanged: number;
  /** Manifest sources that no longer exist (kept in the backup, reported). */
  missing: string[];
  totalBytes: number;
}

/**
 * Diff candidates against the manifest. Fast path trusts size+mtime;
 * `paranoid` re-hashes everything that matches the fast path too (the hash
 * comparison itself then happens at execution time, where hashes are
 * computed anyway).
 */
export function planBackup(
  candidates: Candidate[],
  manifest: Manifest,
  options: { paranoid?: boolean } = {},
): BackupPlan {
  const bySource = new Map<string, { rel: string; entry: ManifestEntry }>();
  for (const [rel, entry] of Object.entries(manifest.entries)) {
    bySource.set(path.resolve(entry.source), { rel, entry });
  }

  const takenRel = new Set(Object.keys(manifest.entries));
  const items: BackupPlanItem[] = [];
  let unchanged = 0;
  const seenSources = new Set<string>();

  for (const candidate of candidates) {
    const abs = path.resolve(candidate.source);
    seenSources.add(abs);
    const stat = fs.statSync(abs);
    const known = bySource.get(abs);

    if (known) {
      const fastPathHit =
        !options.paranoid &&
        known.entry.size === stat.size &&
        Math.abs(known.entry.mtimeMs - stat.mtimeMs) <= MTIME_TOLERANCE_MS;
      if (fastPathHit) {
        unchanged += 1;
      } else {
        // Content check happens at execution (hash is needed there anyway);
        // identical content will be skipped without copying.
        items.push({
          source: candidate.source,
          relPath: known.rel, // identity in the backup never moves
          reason: "modified",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
      continue;
    }

    // New file: reserve a non-colliding destination path.
    let rel = candidate.relPath;
    if (takenRel.has(rel)) {
      const ext = path.posix.extname(rel);
      const stem = rel.slice(0, rel.length - ext.length);
      for (let i = 1; takenRel.has(rel); i++) rel = `${stem}_${i}${ext}`;
    }
    takenRel.add(rel);
    items.push({
      source: candidate.source,
      relPath: rel,
      reason: "new",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }

  const missing = [...bySource.keys()].filter((s) => !seenSources.has(s));
  return {
    items,
    unchanged,
    missing,
    totalBytes: items.reduce((n, i) => n + i.size, 0),
  };
}

// ---------------------------------------------------------------------------
// Execution

export interface FileFacts {
  takenAt?: string;
  camera?: string;
}

export interface BackupResult {
  copied: number;
  versioned: number;
  /** Modified by mtime but content-identical: manifest refreshed, no copy. */
  refreshed: number;
  bytes: number;
}

function versionStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

async function atomicVerifiedCopy(source: string, target: string): Promise<string> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = target + PARTIAL_SUFFIX;
  try {
    fs.copyFileSync(source, partial);
    const [srcHash, dstHash] = await Promise.all([sha256(source), sha256(partial)]);
    if (srcHash !== dstHash) {
      throw new Error(
        `Checksum mismatch while backing up "${source}". The bad copy was ` +
          "discarded; the source disk or the backup disk may be failing.",
      );
    }
    fs.renameSync(partial, target);
    return srcHash;
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
}

/**
 * Execute a backup plan, updating the manifest as it goes. The manifest is
 * saved even when a copy fails midway, so completed work is never lost.
 */
export async function executeBackup(
  root: string,
  manifest: Manifest,
  plan: BackupPlan,
  options: {
    facts?: Map<string, FileFacts>;
    onProgress?: (current: number, total: number, file: string) => void;
  } = {},
): Promise<BackupResult> {
  const result: BackupResult = { copied: 0, versioned: 0, refreshed: 0, bytes: 0 };
  const now = () => new Date().toISOString();

  try {
    for (let i = 0; i < plan.items.length; i++) {
      const item = plan.items[i];
      options.onProgress?.(i + 1, plan.items.length, path.basename(item.source));
      const target = path.join(root, ...item.relPath.split("/"));
      const existing = manifest.entries[item.relPath];

      if (item.reason === "modified" && existing) {
        const srcHash = await sha256(item.source);
        if (srcHash === existing.sha256) {
          existing.mtimeMs = item.mtimeMs;
          existing.size = item.size;
          result.refreshed += 1;
          continue;
        }
        // Real change: archive the current backup copy, then copy the new one.
        if (fs.existsSync(target)) {
          const stamp = versionStamp(new Date());
          const versionRel = `${VERSIONS_DIR}/${item.relPath}.${stamp}`;
          const versionAbs = path.join(root, ...versionRel.split("/"));
          fs.mkdirSync(path.dirname(versionAbs), { recursive: true });
          fs.renameSync(target, versionAbs);
          existing.versions = [
            ...(existing.versions ?? []),
            { path: versionRel, sha256: existing.sha256, replacedAt: now() },
          ];
          result.versioned += 1;
        }
        const hash = await atomicVerifiedCopy(item.source, target);
        const facts = options.facts?.get(path.resolve(item.source));
        manifest.entries[item.relPath] = {
          ...existing,
          source: path.resolve(item.source),
          size: item.size,
          mtimeMs: item.mtimeMs,
          sha256: hash,
          backedUpAt: now(),
          ...(facts?.takenAt ? { takenAt: facts.takenAt } : {}),
          ...(facts?.camera ? { camera: facts.camera } : {}),
        };
        result.copied += 1;
        result.bytes += item.size;
        continue;
      }

      const hash = await atomicVerifiedCopy(item.source, target);
      const facts = options.facts?.get(path.resolve(item.source));
      manifest.entries[item.relPath] = {
        source: path.resolve(item.source),
        size: item.size,
        mtimeMs: item.mtimeMs,
        sha256: hash,
        backedUpAt: now(),
        ...(facts?.takenAt ? { takenAt: facts.takenAt } : {}),
        ...(facts?.camera ? { camera: facts.camera } : {}),
      };
      result.copied += 1;
      result.bytes += item.size;
    }
  } finally {
    saveManifest(root, manifest);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Verify

export interface VerifyResult {
  checked: number;
  ok: number;
  /** Backup files whose bytes no longer match the manifest (bit rot!). */
  corrupted: string[];
  /** Manifest entries whose backup file is gone. */
  missingFiles: string[];
}

export async function verifyBackup(
  root: string,
  options: {
    onProgress?: (current: number, total: number, file: string) => void;
  } = {},
): Promise<VerifyResult> {
  const manifest = loadManifest(root);
  const entries = Object.entries(manifest.entries);
  const result: VerifyResult = {
    checked: entries.length,
    ok: 0,
    corrupted: [],
    missingFiles: [],
  };
  for (let i = 0; i < entries.length; i++) {
    const [rel, entry] = entries[i];
    options.onProgress?.(i + 1, entries.length, path.posix.basename(rel));
    const file = path.join(root, ...rel.split("/"));
    if (!fs.existsSync(file)) {
      result.missingFiles.push(rel);
      continue;
    }
    if ((await sha256(file)) === entry.sha256) result.ok += 1;
    else result.corrupted.push(rel);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Restore

export interface RestorePlanItem {
  relPath: string;
  from: string;
  to: string;
  action: "restore" | "already-there" | "conflict";
  /** Expected content hash from the manifest; restores are checked against it. */
  sha256: string;
}

/** Normalize "2026-07-05" / "2026-07" / "2026" into an EXIF date prefix. */
function takenPrefix(filter: string): string {
  return filter.trim().replace(/-/g, ":");
}

/**
 * Plan a restore. Targets that already exist with identical content are
 * skipped; targets that exist with DIFFERENT content are conflicts and are
 * never overwritten.
 */
export async function planRestoreFromBackup(
  root: string,
  options: {
    to?: string;
    taken?: string;
    onProgress?: (current: number, total: number, file: string) => void;
  } = {},
): Promise<RestorePlanItem[]> {
  const manifest = loadManifest(root);
  let entries = Object.entries(manifest.entries);
  if (options.taken) {
    const prefix = takenPrefix(options.taken);
    entries = entries.filter(([, e]) => e.takenAt?.startsWith(prefix));
  }

  const items: RestorePlanItem[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [rel, entry] = entries[i];
    options.onProgress?.(i + 1, entries.length, path.posix.basename(rel));
    const from = path.join(root, ...rel.split("/"));
    const to = options.to ? path.join(options.to, ...rel.split("/")) : entry.source;
    if (!fs.existsSync(to)) {
      items.push({ relPath: rel, from, to, action: "restore", sha256: entry.sha256 });
    } else if ((await sha256(to)) === entry.sha256) {
      items.push({ relPath: rel, from, to, action: "already-there", sha256: entry.sha256 });
    } else {
      items.push({ relPath: rel, from, to, action: "conflict", sha256: entry.sha256 });
    }
  }
  return items;
}

export interface RestoreResult {
  restored: number;
  /** Backup copies whose bytes no longer match the manifest: NOT restored. */
  corruptedInBackup: string[];
}

export async function executeRestore(
  items: RestorePlanItem[],
  options: {
    onProgress?: (current: number, total: number, file: string) => void;
  } = {},
): Promise<RestoreResult> {
  const todo = items.filter((i) => i.action === "restore");
  const result: RestoreResult = { restored: 0, corruptedInBackup: [] };
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    options.onProgress?.(i + 1, todo.length, path.posix.basename(item.relPath));
    // Never restore silent corruption: the backup copy must still match the
    // hash recorded when it was made.
    if ((await sha256(item.from)) !== item.sha256) {
      result.corruptedInBackup.push(item.relPath);
      continue;
    }
    await atomicVerifiedCopy(item.from, item.to);
    result.restored += 1;
  }
  return result;
}
