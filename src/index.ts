/** Public API of exifregistry (usable as a library, not just a CLI). */

export * as engine from "./engine.js";
export * as fields from "./fields.js";
export { expandPaths } from "./paths.js";
export { planRestore, restore } from "./undo.js";
export { fullReportRows } from "./display.js";
export {
  collectMirrorCandidates,
  executeBackup,
  executeRestore,
  loadManifest,
  planBackup,
  planRestoreFromBackup,
  verifyBackup,
} from "./backup.js";
export {
  CONFIG_KEYS,
  configPath,
  flattenConfig,
  loadConfig,
  saveConfig,
  setConfigKey,
} from "./config.js";
export { completionScript, parseShell } from "./completion.js";
export { historyPath, readHistory, recordHistory } from "./history.js";
export { renderContactSheet } from "./contact.js";
export { findDupes } from "./dupes.js";
export { matches, parseCondition } from "./query.js";
export { computeStats, statsToMarkdown } from "./stats.js";
export { offsetForZone, offsetFromGps, validateOffset, zoneForCoordinates } from "./tz.js";
export { defaultExportPath, metadataToMarkdown } from "./markdown.js";
export {
  executePlan,
  groupWithCompanions,
  journalBatch,
  planOrganize,
  planRename,
  sha256,
  undoLastBatch,
} from "./organizer.js";
export {
  FRAME_COLORS,
  buildCaption,
  computeLayout,
  parseRatio,
  renderFrame,
  resolveColor,
} from "./frame.js";
export { needsGeolocation, resolvePattern, sanitizeComponent } from "./pattern.js";
export {
  computeTargetDims,
  parseByteSize,
  parseFormat,
  resizeImage,
} from "./resize.js";
