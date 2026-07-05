/** End-to-end CLI tests running the built binary is overkill here; we drive
 * the commander program directly and shut the engine down at the end. */

import { afterAll, describe, expect, it, vi } from "vitest";

import { buildProgram, main } from "../src/cli.js";
import * as engine from "../src/engine.js";
import { makeScratchJpeg } from "./fixtures.js";

afterAll(async () => {
  await engine.end();
});

function run(args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride(); // throw instead of process.exit on --help/--version
  return program.parseAsync(["node", "exifkit", ...args]) as unknown as Promise<void>;
}

describe("cli", () => {
  it("gps + show --json round-trip", async () => {
    const { file } = makeScratchJpeg();
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      logs.push(String(line));
    });
    try {
      await run(["gps", file, "--coords", "-23.5505, -46.6333", "--no-backup"]);
      await run(["show", file, "--json"]);
    } finally {
      spy.mockRestore();
    }
    const output = logs.join("\n");
    expect(output).toContain("-23.5505");
    expect(output).toContain("GPSLatitude");
  });

  it("date --taken then summary shows the new date", async () => {
    const { file } = makeScratchJpeg();
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      logs.push(String(line));
    });
    try {
      await run(["date", file, "--taken", "2024-06-01 14:30", "--no-backup"]);
      await run(["show", file]);
    } finally {
      spy.mockRestore();
    }
    expect(logs.join("\n")).toContain("2024:06:01 14:30:00");
  });

  it("gps without coordinates fails as a user error", async () => {
    const { file } = makeScratchJpeg();
    await expect(run(["gps", file])).rejects.toThrow(/Provide a location/);
  });

  it("date without an action fails as a user error", async () => {
    const { file } = makeScratchJpeg();
    await expect(run(["date", file])).rejects.toThrow(/Nothing to do/);
  });

  it("main() reports errors without throwing and sets the exit code", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: string) => {
      errors.push(String(line));
    });
    try {
      await main(["node", "exifkit", "show", "does-not-exist.jpg"]);
    } finally {
      spy.mockRestore();
    }
    expect(errors.join("\n")).toContain("does-not-exist.jpg");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
