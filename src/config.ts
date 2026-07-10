/**
 * User configuration at ~/.config/exifregistry/config.json (XDG-aware).
 * Currently stores the `sign` preset (artist/copyright).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface UserConfig {
  sign?: {
    artist?: string;
    copyright?: string;
  };
}

export function configPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "exifregistry", "config.json");
}

export function loadConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as UserConfig;
  } catch {
    return {};
  }
}

export function saveConfig(patch: UserConfig): UserConfig {
  const merged = { ...loadConfig(), ...patch };
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}
