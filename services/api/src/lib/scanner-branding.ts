const MAX_SCANNER_LOGO_BYTES = 256 * 1024;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function isValidScannerLogoDataUrl(value: string | null): boolean {
  if (value === null) return true;
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length === 0 || bytes.length > MAX_SCANNER_LOGO_BYTES) return false;
  const mime = match[1];
  if (mime === "png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
