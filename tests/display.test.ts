import { describe, expect, it } from "vitest";

import { fullReportRows } from "../src/display.js";
import type { FullMetadata } from "../src/engine.js";

function fakeFull(
  pretty: Record<string, unknown>,
  numericExtra: Record<string, unknown> = {},
): FullMetadata {
  return { pretty, numeric: { ...pretty, ...numericExtra } };
}

describe("fullReportRows", () => {
  const full = fakeFull(
    {
      SourceFile: "/x/photo.NEF",
      FileName: "photo.NEF",
      FileType: "NEF",
      Make: "NIKON CORPORATION",
      Model: "NIKON Z 6",
      LensModel: "NIKKOR Z 35mm f/1.8 S",
      ShutterCount: 48213,
      SerialNumber: "6031234",
      ISO: 400,
      Flash: "Off, Did not fire",
      DateTimeOriginal: "2024:06:01 14:30:00",
      SomeObscureNikonTag: "value",
    },
    {
      FileSize: 25_000_000,
      FNumber: 2.8,
      ExposureTime: 0.004,
      FocalLength: 35,
      GPSLatitude: -23.5505,
      GPSLongitude: -46.6333,
    },
  );
  const { main, other } = fullReportRows(full);
  const mainLabels = main.map(([label]) => label);
  const mainMap = Object.fromEntries(main);

  it("shows the shutter count with thousands separator", () => {
    expect(mainMap["Shutter count"]).toBe("48,213");
  });

  it("shows camera, serial, lens and formatted exposure", () => {
    expect(mainMap.Camera).toBe("NIKON CORPORATION NIKON Z 6");
    expect(mainMap["Serial number"]).toBe("6031234");
    expect(mainMap.Aperture).toBe("f/2.8");
    expect(mainMap.Shutter).toBe("1/250s");
    expect(mainMap["Focal length"]).toBe("35mm");
    expect(mainMap.Size).toBe("23.8 MB");
  });

  it("shows GPS as decimal degrees", () => {
    expect(mainMap.GPS).toBe("-23.550500, -46.633300");
  });

  it("puts curated fields before everything else", () => {
    expect(mainLabels[0]).toBe("File");
    expect(mainLabels.indexOf("Camera")).toBeLessThan(
      mainLabels.indexOf("Taken (DateTimeOriginal)"),
    );
  });

  it("lists unrecognized tags in the 'other' section only", () => {
    expect(other).toContainEqual(["SomeObscureNikonTag", "value"]);
    expect(mainLabels).not.toContain("SomeObscureNikonTag");
  });

  it("does not duplicate curated keys in 'other'", () => {
    const otherKeys = other.map(([key]) => key);
    for (const key of ["FileName", "Make", "ShutterCount", "ISO", "SourceFile"]) {
      expect(otherKeys).not.toContain(key);
    }
  });

  it("falls back to alternate shutter-count tags", () => {
    const alt = fullReportRows(
      fakeFull({ FileName: "a.jpg" }, { ImageCount: 1520 }),
    );
    expect(Object.fromEntries(alt.main)["Shutter count"]).toBe("1,520");
  });

  it("shows '— none —' when there is no GPS", () => {
    const noGps = fullReportRows(fakeFull({ FileName: "a.jpg" }));
    expect(Object.fromEntries(noGps.main).GPS).toBe("— none —");
  });
});
