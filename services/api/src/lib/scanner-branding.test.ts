import { describe, expect, it } from "vitest";
import { isValidScannerLogoDataUrl } from "./scanner-branding.js";

const dataUrl = (mime: string, bytes: Buffer) => `data:image/${mime};base64,${bytes.toString("base64")}`;

describe("scanner brand logo validation", () => {
  it("accepts only small raster images whose signatures match their declared MIME type", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const webp = Buffer.from("RIFF0000WEBP", "ascii");
    expect(isValidScannerLogoDataUrl(dataUrl("png", png))).toBe(true);
    expect(isValidScannerLogoDataUrl(dataUrl("jpeg", jpeg))).toBe(true);
    expect(isValidScannerLogoDataUrl(dataUrl("webp", webp))).toBe(true);
    expect(isValidScannerLogoDataUrl(dataUrl("jpeg", png))).toBe(false);
    expect(isValidScannerLogoDataUrl("data:image/svg+xml;base64,PHN2Zz4=" )).toBe(false);
    expect(isValidScannerLogoDataUrl(null)).toBe(true);
  });

  it("rejects an image larger than 256 KB", () => {
    const oversizedPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256 * 1024)]);
    expect(isValidScannerLogoDataUrl(dataUrl("png", oversizedPng))).toBe(false);
  });
});
