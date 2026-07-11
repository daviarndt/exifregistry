/**
 * A global operation log at ~/.config/exifregistry/history.jsonl.
 *
 * Every command that changes files appends one line here after it succeeds,
 * so `exifreg history` can show what happened, when, and to how many files.
 * Append-only JSONL keeps writes cheap and the file resilient to partial
 * writes (one bad line never corrupts the rest).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { configPath } from "./config.js";

export interface HistoryEntry {
  date: string;
  command: string;
  summary: string;
  /** How many files the operation touched, when meaningful. */
  count?: number;
}

export function historyPath(): string {
  return path.join(path.dirname(configPath()), "history.jsonl");
}

/** Record one operation. Never throws: history must not break a command. */
export function recordHistory(
  command: string,
  summary: string,
  count?: number,
): void {
  try {
    const entry: HistoryEntry = {
      date: new Date().toISOString(),
      command,
      summary,
      ...(count !== undefined ? { count } : {}),
    };
    const file = historyPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    /* history is best-effort */
  }
}

/** Read the most recent entries, newest first (default 20). */
export function readHistory(limit = 20): HistoryEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(historyPath(), "utf8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch {
      /* skip a corrupted line */
    }
  }
  return entries.reverse().slice(0, limit);
}

export function clearHistory(): void {
  try {
    fs.rmSync(historyPath(), { force: true });
  } catch {
    /* nothing to clear */
  }
}
