import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertRootOutsideSources,
  collectMirrorCandidates,
  executeBackup,
  executeRestore,
  loadManifest,
  MANIFEST_NAME,
  planBackup,
  planRestoreFromBackup,
  verifyBackup,
} from "../src/backup.js";
import { sha256 } from "../src/organizer.js";

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-bk-"));
}

function library(): { dir: string; a: string; b: string } {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "trip"));
  const a = path.join(dir, "IMG_1.jpg");
  const b = path.join(dir, "trip", "IMG_2.cr3");
  fs.writeFileSync(a, "photo-a-bytes");
  fs.writeFileSync(b, "photo-b-bytes");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a photo");
  fs.writeFileSync(path.join(dir, ".DS_Store"), "junk");
  return { dir, a, b };
}

async function backupOnce(srcDir: string, root: string) {
  const manifest = loadManifest(root);
  const plan = planBackup(collectMirrorCandidates([srcDir]), manifest);
  const result = await executeBackup(root, manifest, plan);
  return { plan, result };
}

describe("collectMirrorCandidates", () => {
  it("mirrors folders under their own name and skips non-photo files", () => {
    const { dir } = library();
    const candidates = collectMirrorCandidates([dir]);
    const rels = candidates.map((c) => c.relPath).sort();
    const base = path.basename(dir);
    expect(rels).toEqual([`${base}/IMG_1.jpg`, `${base}/trip/IMG_2.cr3`]);
  });

  it("rejects a backup root inside the source", () => {
    const { dir } = library();
    expect(() => assertRootOutsideSources(path.join(dir, "bk"), [dir])).toThrow(
      /inside the source/,
    );
  });
});

describe("backup plan + execute", () => {
  it("first run copies everything, second run is a no-op", async () => {
    const { dir, a } = library();
    const root = scratch();

    const first = await backupOnce(dir, root);
    expect(first.plan.items).toHaveLength(2);
    expect(first.result.copied).toBe(2);
    const base = path.basename(dir);
    const destA = path.join(root, base, "IMG_1.jpg");
    expect(fs.existsSync(destA)).toBe(true);
    expect(await sha256(destA)).toBe(await sha256(a));
    expect(fs.existsSync(path.join(root, MANIFEST_NAME))).toBe(true);

    const second = await backupOnce(dir, root);
    expect(second.plan.items).toHaveLength(0);
    expect(second.plan.unchanged).toBe(2);
  });

  it("touched-but-identical files refresh the manifest without copying", async () => {
    const { dir, a } = library();
    const root = scratch();
    await backupOnce(dir, root);

    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(a, future, future); // mtime changes, content does not

    const { plan, result } = await backupOnce(dir, root);
    expect(plan.items).toHaveLength(1);
    expect(result.copied).toBe(0);
    expect(result.refreshed).toBe(1);

    // and the refreshed mtime now hits the fast path again
    const third = await backupOnce(dir, root);
    expect(third.plan.items).toHaveLength(0);
  });

  it("changed files are versioned, never overwritten", async () => {
    const { dir, a } = library();
    const root = scratch();
    await backupOnce(dir, root);
    const base = path.basename(dir);
    const originalHash = await sha256(a);

    fs.writeFileSync(a, "photo-a-EDITED");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(a, future, future);

    const { result } = await backupOnce(dir, root);
    expect(result.copied).toBe(1);
    expect(result.versioned).toBe(1);

    // current backup copy has the new content
    const dest = path.join(root, base, "IMG_1.jpg");
    expect(fs.readFileSync(dest, "utf8")).toBe("photo-a-EDITED");
    // the previous bytes still exist under _versions and match the old hash
    const manifest = loadManifest(root);
    const entry = manifest.entries[`${base}/IMG_1.jpg`];
    expect(entry.versions).toHaveLength(1);
    const archived = path.join(root, ...entry.versions![0].path.split("/"));
    expect(await sha256(archived)).toBe(originalHash);
  });

  it("files deleted at the source are reported and KEPT in the backup", async () => {
    const { dir, a } = library();
    const root = scratch();
    await backupOnce(dir, root);
    fs.rmSync(a);

    const { plan } = await backupOnce(dir, root);
    expect(plan.missing).toHaveLength(1);
    const base = path.basename(dir);
    expect(fs.existsSync(path.join(root, base, "IMG_1.jpg"))).toBe(true);
  });

  it("never leaves partial files behind", async () => {
    const { dir } = library();
    const root = scratch();
    await backupOnce(dir, root);
    const leftovers: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d)) {
        const f = path.join(d, e);
        if (fs.statSync(f).isDirectory()) walk(f);
        else if (e.includes("partial")) leftovers.push(f);
      }
    };
    walk(root);
    expect(leftovers).toEqual([]);
  });

  it("stores EXIF facts when provided", async () => {
    const { dir, a } = library();
    const root = scratch();
    const manifest = loadManifest(root);
    const plan = planBackup(collectMirrorCandidates([dir]), manifest);
    const facts = new Map([
      [path.resolve(a), { takenAt: "2026:07:05 14:30:00", camera: "Canon EOS R6" }],
    ]);
    await executeBackup(root, manifest, plan, { facts });
    const base = path.basename(dir);
    const entry = loadManifest(root).entries[`${base}/IMG_1.jpg`];
    expect(entry.takenAt).toBe("2026:07:05 14:30:00");
    expect(entry.camera).toBe("Canon EOS R6");
  });
});

describe("verify", () => {
  it("passes on a healthy backup and catches corruption + missing files", async () => {
    const { dir } = library();
    const root = scratch();
    await backupOnce(dir, root);
    const base = path.basename(dir);

    const healthy = await verifyBackup(root);
    expect(healthy.ok).toBe(2);
    expect(healthy.corrupted).toEqual([]);

    // simulate bit rot: flip bytes without touching the manifest
    fs.writeFileSync(path.join(root, base, "IMG_1.jpg"), "photo-a-bytEs");
    fs.rmSync(path.join(root, base, "trip", "IMG_2.cr3"));

    const sick = await verifyBackup(root);
    expect(sick.corrupted).toEqual([`${base}/IMG_1.jpg`]);
    expect(sick.missingFiles).toEqual([`${base}/trip/IMG_2.cr3`]);
  });
});

describe("restore", () => {
  it("restores deleted sources, skips intact ones, never overwrites conflicts", async () => {
    const { dir, a, b } = library();
    const root = scratch();
    await backupOnce(dir, root);

    fs.rmSync(a); // deleted: should be restored
    fs.writeFileSync(b, "locally-edited"); // conflict: must be kept

    const items = await planRestoreFromBackup(root);
    const byAction = Object.fromEntries(items.map((i) => [i.action, i]));
    expect(items.filter((i) => i.action === "restore")).toHaveLength(1);
    expect(items.filter((i) => i.action === "conflict")).toHaveLength(1);
    expect(byAction.restore.to).toBe(path.resolve(a));

    const result = await executeRestore(items);
    expect(result.restored).toBe(1);
    expect(result.corruptedInBackup).toEqual([]);
    expect(fs.readFileSync(a, "utf8")).toBe("photo-a-bytes");
    expect(fs.readFileSync(b, "utf8")).toBe("locally-edited"); // untouched
  });

  it("restores into a different folder with --to", async () => {
    const { dir } = library();
    const root = scratch();
    await backupOnce(dir, root);
    const target = scratch();

    const items = await planRestoreFromBackup(root, { to: target });
    expect(items.every((i) => i.action === "restore")).toBe(true);
    await executeRestore(items);
    const base = path.basename(dir);
    expect(fs.existsSync(path.join(target, base, "trip", "IMG_2.cr3"))).toBe(true);
  });

  it("refuses to restore a corrupted backup copy", async () => {
    const { dir, a } = library();
    const root = scratch();
    await backupOnce(dir, root);
    const base = path.basename(dir);

    fs.rmSync(a); // needs restore
    fs.writeFileSync(path.join(root, base, "IMG_1.jpg"), "rotten-bytes");

    const items = await planRestoreFromBackup(root);
    const result = await executeRestore(items);
    expect(result.restored).toBe(0);
    expect(result.corruptedInBackup).toEqual([`${base}/IMG_1.jpg`]);
    expect(fs.existsSync(a)).toBe(false); // corruption was NOT propagated
  });

  it("filters by capture date prefix", async () => {
    const { dir, a, b } = library();
    const root = scratch();
    const manifest = loadManifest(root);
    const plan = planBackup(collectMirrorCandidates([dir]), manifest);
    const facts = new Map([
      [path.resolve(a), { takenAt: "2026:07:05 14:30:00" }],
      [path.resolve(b), { takenAt: "2025:12:24 09:00:00" }],
    ]);
    await executeBackup(root, manifest, plan, { facts });
    fs.rmSync(a);
    fs.rmSync(b);

    const july = await planRestoreFromBackup(root, { taken: "2026-07" });
    expect(july).toHaveLength(1);
    expect(july[0].relPath.endsWith("IMG_1.jpg")).toBe(true);
  });
});

describe("manifest safety", () => {
  it("refuses to run over a corrupted manifest", () => {
    const root = scratch();
    fs.writeFileSync(path.join(root, MANIFEST_NAME), "{ not json");
    expect(() => loadManifest(root)).toThrow(/unreadable/);
  });
});
