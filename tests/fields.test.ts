import { describe, expect, it } from "vitest";

import * as fields from "../src/fields.js";

describe("parseDatetime", () => {
  it.each([
    ["2024-06-01 14:30", "2024:06:01 14:30:00"],
    ["2024-06-01 14:30:45", "2024:06:01 14:30:45"],
    ["2024-06-01T14:30", "2024:06:01 14:30:00"],
    ["2024-06-01", "2024:06:01 00:00:00"],
    ["2024:06:01 14:30:00", "2024:06:01 14:30:00"],
    ["01/06/2024 14:30", "2024:06:01 14:30:00"],
    ["01/06/2024", "2024:06:01 00:00:00"],
  ])("parses %s", (text, expected) => {
    expect(fields.parseDatetime(text)).toBe(expected);
  });

  it.each(["yesterday", "2024-13-01", "2024-02-30", "junk", ""])(
    "rejects %s",
    (text) => {
      expect(() => fields.parseDatetime(text)).toThrow();
    },
  );
});

describe("parseShift", () => {
  it.each([
    ["+2h", ["+=", "0:0:0 2:0:0"]],
    ["-30m", ["-=", "0:0:0 0:30:0"]],
    ["+1d 2h30m", ["+=", "0:0:1 2:30:0"]],
    ["2h", ["+=", "0:0:0 2:0:0"]], // sign defaults to +
    ["+1y2mo3d", ["+=", "1:2:3 0:0:0"]],
    ["-45s", ["-=", "0:0:0 0:0:45"]],
  ])("parses %s", (text, expected) => {
    expect(fields.parseShift(text)).toEqual(expected);
  });

  it.each(["", "+", "2 hours", "abc", "+2x"])("rejects %s", (text) => {
    expect(() => fields.parseShift(text)).toThrow();
  });
});

describe("parseCoordinates", () => {
  it.each([
    ["-23.5505, -46.6333", [-23.5505, -46.6333]],
    ["-23.5505,-46.6333", [-23.5505, -46.6333]],
    ["40.7128 -74.006", [40.7128, -74.006]],
  ])("parses %s", (text, expected) => {
    expect(fields.parseCoordinates(text)).toEqual(expected);
  });

  it.each(["", "12.3", "a, b", "91, 0", "0, 181"])("rejects %s", (text) => {
    expect(() => fields.parseCoordinates(text)).toThrow();
  });
});

describe("gpsEdit", () => {
  it("uses signed decimals (refs are derived by exiftool-vendored)", () => {
    const edit = fields.gpsEdit(-23.5505, -46.6333, 760);
    expect(edit.tags).toEqual({
      GPSLatitude: -23.5505,
      GPSLongitude: -46.6333,
      GPSAltitude: 760,
    });
    expect(edit.extraArgs).toEqual([]);
  });

  it("adds the QuickTime tag for videos", () => {
    const edit = fields.gpsEdit(-23.5505, -46.6333, undefined, true);
    expect(edit.tags.GPSCoordinates).toBe("-23.5505, -46.6333");
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => fields.gpsEdit(95, 0)).toThrow();
  });
});

describe("date edits", () => {
  it("capture date sets DateTimeOriginal and CreateDate", () => {
    const edit = fields.captureDateEdit("2024:06:01 14:30:00");
    expect(edit.tags).toEqual({
      DateTimeOriginal: "2024:06:01 14:30:00",
      CreateDate: "2024:06:01 14:30:00",
    });
  });

  it("shift builds an AllDates argument", () => {
    expect(fields.shiftEdit("+=", "0:0:0 2:0:0").extraArgs).toEqual([
      "-AllDates+=0:0:0 2:0:0",
    ]);
  });

  it("mergeEdits combines tags and args", () => {
    const merged = fields.mergeEdits([
      fields.captureDateEdit("2024:06:01 14:30:00"),
      fields.modifyDateEdit("2024:06:02 10:00:00"),
    ]);
    expect(Object.keys(merged.tags)).toEqual([
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
    ]);
  });
});

describe("isVideo", () => {
  it.each([
    ["clip.MP4", true],
    ["clip.mov", true],
    ["photo.CR3", false],
    ["a.jpg", false],
  ])("detects %s -> %s", (name, expected) => {
    expect(fields.isVideo(name)).toBe(expected);
  });
});
