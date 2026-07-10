/**
 * `exifreg find`: tiny metadata query language.
 *
 * A condition looks like `ISO>3200`, `Model=Canon EOS R6`,
 * `LensModel~35mm` or `DateTimeOriginal>=2026:07`. Multiple conditions
 * are ANDed. Values compare numerically when both sides are numbers,
 * otherwise as strings (which works for EXIF dates: "2026:07:05..." sorts
 * chronologically).
 */

import type { Metadata } from "./engine.js";

export type Operator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~";

export interface Condition {
  key: string;
  op: Operator;
  value: string;
}

const CONDITION_RE = /^\s*([A-Za-z0-9_:]+)\s*(>=|<=|!=|~|=|>|<)\s*(.+?)\s*$/;

export function parseCondition(text: string): Condition {
  const match = CONDITION_RE.exec(text);
  if (!match) {
    throw new Error(
      `Could not understand the condition "${text}". ` +
        'Use forms like "ISO>3200", "Model=Canon EOS R6", "LensModel~35mm" ' +
        'or "DateTimeOriginal>=2026:07".',
    );
  }
  return { key: match[1], op: match[2] as Operator, value: match[3] };
}

/** Case-insensitive tag lookup so `iso>3200` works as well as `ISO>3200`. */
function lookup(metadata: Metadata, key: string): unknown {
  if (key in metadata) return metadata[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(metadata)) {
    if (k.toLowerCase() === lower) return metadata[k];
  }
  return undefined;
}

export function matches(metadata: Metadata, conditions: Condition[]): boolean {
  for (const cond of conditions) {
    const raw = lookup(metadata, cond.key);
    if (raw === undefined || raw === null) return false;

    const actualNum = Number(raw);
    const wantedNum = Number(cond.value);
    const numeric =
      Number.isFinite(actualNum) &&
      Number.isFinite(wantedNum) &&
      String(raw).trim() !== "" &&
      cond.value.trim() !== "";

    const actualStr = String(raw).toLowerCase();
    const wantedStr = cond.value.toLowerCase();

    let ok: boolean;
    switch (cond.op) {
      case "=": ok = numeric ? actualNum === wantedNum : actualStr === wantedStr; break;
      case "!=": ok = numeric ? actualNum !== wantedNum : actualStr !== wantedStr; break;
      case ">": ok = numeric ? actualNum > wantedNum : actualStr > wantedStr; break;
      case ">=": ok = numeric ? actualNum >= wantedNum : actualStr >= wantedStr; break;
      case "<": ok = numeric ? actualNum < wantedNum : actualStr < wantedStr; break;
      case "<=": ok = numeric ? actualNum <= wantedNum : actualStr <= wantedStr; break;
      case "~": ok = actualStr.includes(wantedStr); break;
    }
    if (!ok) return false;
  }
  return true;
}
