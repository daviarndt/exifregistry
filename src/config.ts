/**
 * User configuration at ~/.config/exifregistry/config.json (XDG-aware).
 *
 * Holds defaults that make repeat use frictionless: the `sign` preset,
 * a default backup destination, and a default frame color.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface UserConfig {
  sign?: {
    artist?: string;
    copyright?: string;
  };
  backup?: {
    /** Default --to for `backup` and `restore` when omitted. */
    to?: string;
  };
  frame?: {
    /** Default --color for `frame`. */
    color?: string;
  };
}

/** Every settable key, as dotted paths, with a human description. */
export const CONFIG_KEYS: Record<string, string> = {
  "sign.artist": "default Artist/creator name for `sign`",
  "sign.copyright": 'default Copyright for `sign` ("{year}" expands)',
  "backup.to": "default backup destination for `backup` and `restore`",
  "frame.color": "default frame color for `frame`",
};

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "exifregistry", "config.json");
}

export function loadConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as UserConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: UserConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

/** Shallow-merge a patch into the stored config and persist it. */
export function saveConfig(patch: UserConfig): UserConfig {
  const merged = deepMerge(loadConfig(), patch);
  writeConfig(merged);
  return merged;
}

function deepMerge(base: UserConfig, patch: UserConfig): UserConfig {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = deepMerge(
        (out[key] as UserConfig) ?? {},
        value as UserConfig,
      );
    } else {
      out[key] = value;
    }
  }
  return out as UserConfig;
}

/** Set one dotted key (e.g. "sign.artist"). Empty value unsets it. */
export function setConfigKey(dotted: string, value: string): UserConfig {
  if (!(dotted in CONFIG_KEYS)) {
    throw new Error(
      `Unknown config key "${dotted}". Valid keys: ${Object.keys(CONFIG_KEYS).join(", ")}.`,
    );
  }
  const [section, leaf] = dotted.split(".");
  const config = loadConfig() as Record<string, Record<string, string>>;
  config[section] ??= {};
  if (value === "") delete config[section][leaf];
  else config[section][leaf] = value;
  if (Object.keys(config[section]).length === 0) delete config[section];
  writeConfig(config as UserConfig);
  return config as UserConfig;
}

/** Flatten the stored config to dotted key/value pairs for display. */
export function flattenConfig(config: UserConfig): [string, string][] {
  const rows: [string, string][] = [];
  for (const key of Object.keys(CONFIG_KEYS)) {
    const [section, leaf] = key.split(".");
    const value = (config as Record<string, Record<string, string>>)[section]?.[leaf];
    if (value !== undefined) rows.push([key, value]);
  }
  return rows;
}
