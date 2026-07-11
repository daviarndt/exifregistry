import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONFIG_KEYS,
  configPath,
  flattenConfig,
  loadConfig,
  saveConfig,
  setConfigKey,
} from "../src/config.js";
import { completionScript, parseShell } from "../src/completion.js";
import { historyPath, readHistory, recordHistory } from "../src/history.js";

let prevXdg: string | undefined;
let dir: string;

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "exifregistry-qol-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
});

describe("config", () => {
  it("stores under XDG and merges deeply", () => {
    expect(loadConfig()).toEqual({});
    saveConfig({ sign: { artist: "Davi" } });
    saveConfig({ sign: { copyright: "© 2026" }, backup: { to: "/Volumes/BK" } });
    const cfg = loadConfig();
    expect(cfg.sign).toEqual({ artist: "Davi", copyright: "© 2026" });
    expect(cfg.backup?.to).toBe("/Volumes/BK");
    expect(configPath().startsWith(dir)).toBe(true);
  });

  it("sets and unsets dotted keys", () => {
    setConfigKey("frame.color", "sage");
    expect(loadConfig().frame?.color).toBe("sage");
    setConfigKey("frame.color", ""); // unset
    expect(loadConfig().frame).toBeUndefined();
  });

  it("rejects unknown keys", () => {
    expect(() => setConfigKey("bogus.key", "x")).toThrow(/Unknown config key/);
  });

  it("flattens to displayable rows in key order", () => {
    saveConfig({ backup: { to: "/bk" }, sign: { artist: "D" } });
    const rows = flattenConfig(loadConfig());
    expect(rows).toContainEqual(["sign.artist", "D"]);
    expect(rows).toContainEqual(["backup.to", "/bk"]);
    for (const [k] of rows) expect(k in CONFIG_KEYS).toBe(true);
  });
});

describe("history", () => {
  it("records and reads newest first, tolerating bad lines", () => {
    recordHistory("gps", "set GPS on 3 files", 3);
    recordHistory("backup", "backed up 200 files", 200);
    fs.appendFileSync(historyPath(), "{ not json\n"); // corruption
    const entries = readHistory();
    expect(entries[0].command).toBe("backup");
    expect(entries[0].count).toBe(200);
    expect(entries[1].command).toBe("gps");
  });

  it("respects the limit", () => {
    for (let i = 0; i < 10; i++) recordHistory("date", `op ${i}`);
    expect(readHistory(3)).toHaveLength(3);
  });

  it("returns nothing when there is no log", () => {
    expect(readHistory()).toEqual([]);
  });
});

describe("completion", () => {
  const cmds = ["show", "gps", "backup", "doctor"];

  it("parses supported shells", () => {
    expect(parseShell("ZSH")).toBe("zsh");
    expect(() => parseShell("powershell")).toThrow(/bash, zsh or fish/);
  });

  it("emits a bash script listing the commands", () => {
    const s = completionScript("bash", cmds);
    expect(s).toContain("complete -o default -F _exifreg exifreg exifregistry");
    expect(s).toContain("show gps backup doctor");
  });

  it("emits a zsh script with compdef", () => {
    const s = completionScript("zsh", cmds);
    expect(s).toContain("#compdef exifreg exifregistry");
    expect(s).toContain("'backup'");
  });

  it("emits fish completions per command", () => {
    const s = completionScript("fish", cmds);
    expect(s).toContain("complete -c exifreg -n __fish_use_subcommand -a show");
  });
});
