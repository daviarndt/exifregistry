import { describe, expect, it } from "vitest";

import {
  captureDateParts,
  exifDateParts,
  needsGeolocation,
  resolvePattern,
  sanitizeComponent,
} from "../src/pattern.js";

const META = {
  DateTimeOriginal: "2026:07:05 14:30:22",
  Model: "Canon EOS R6",
  Make: "Canon",
  LensModel: "RF 35mm F1.8",
  GeolocationCity: "São Paulo",
  GeolocationCountry: "Brazil",
};

const ctx = { file: "/shoot/IMG_4021.CR3", metadata: META };

describe("resolvePattern", () => {
  it.each([
    ["{year}/{date}", "2026/2026-07-05"],
    ["{year}/{month}", "2026/07"],
    ["{date}_{time}_{name}", "2026-07-05_143022_IMG_4021"],
    ["{camera}/{date}", "Canon EOS R6/2026-07-05"],
    ["{country}/{city}", "Brazil/São Paulo"],
    ["{type}/{ext}", "RAW/cr3"],
    ["{lens}", "RF 35mm F1.8"],
  ])("resolves %s", (pattern, expected) => {
    expect(resolvePattern(pattern, ctx)).toBe(expected);
  });

  it("pads {counter}", () => {
    expect(resolvePattern("{date}_{counter:4}", { ...ctx, counter: 7 })).toBe(
      "2026-07-05_0007",
    );
    expect(resolvePattern("{counter}", { ...ctx, counter: 12 })).toBe("012");
  });

  it("classifies videos and plain photos", () => {
    expect(resolvePattern("{type}", { file: "clip.MP4", metadata: {} })).toBe("Videos");
    expect(resolvePattern("{type}", { file: "a.jpg", metadata: {} })).toBe("Photos");
  });

  it("falls back for missing metadata", () => {
    const bare = { file: "a.jpg", metadata: {} };
    expect(resolvePattern("{year}/{date}", bare)).toBe("Unknown date/Unknown date");
    expect(resolvePattern("{camera}", bare)).toBe("Unknown camera");
    expect(resolvePattern("{city}", bare)).toBe("Unknown location");
  });

  it("rejects unknown placeholders with a helpful message", () => {
    expect(() => resolvePattern("{bogus}", ctx)).toThrow(/Unknown placeholder/);
  });

  it("sanitizes metadata used in path components", () => {
    const dirty = { file: "a.jpg", metadata: { Model: "Weird/Cam: v2?" } };
    expect(resolvePattern("{camera}", dirty)).toBe("Weird-Cam- v2-");
  });
});

describe("date parsing", () => {
  it("parses EXIF dates with timezone suffixes", () => {
    expect(exifDateParts("2026:07:05 14:30:22+02:00")).toMatchObject({
      year: "2026",
      hour: "14",
    });
  });

  it("prefers DateTimeOriginal over file dates", () => {
    const parts = captureDateParts({
      FileModifyDate: "2030:01:01 00:00:00",
      DateTimeOriginal: "2026:07:05 14:30:22",
    });
    expect(parts?.year).toBe("2026");
  });

  it("falls back to FileModifyDate", () => {
    const parts = captureDateParts({ FileModifyDate: "2026:01:02 03:04:05" });
    expect(parts?.day).toBe("02");
  });
});

describe("needsGeolocation", () => {
  it("detects location placeholders", () => {
    expect(needsGeolocation("{city}/{date}")).toBe(true);
    expect(needsGeolocation("{year}/{date}")).toBe(false);
  });
});

describe("sanitizeComponent", () => {
  it("neutralizes path separators and trims dots", () => {
    expect(sanitizeComponent("../etc/passwd")).toBe("-etc-passwd");
    expect(sanitizeComponent("  .hidden.  ")).toBe("hidden");
  });
});
