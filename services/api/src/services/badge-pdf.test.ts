import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { BadgeLayout } from "@eventdesk/contracts";
import { buildBadgePdf } from "./badge-pdf.js";

const layout: BadgeLayout = {
  pageIndex: 4,
  pageWidth: 612,
  pageHeight: 792,
  elements: [
    { id: "guest-name", kind: "text", field: "name", x: 0.06, y: 0.1, width: 0.6, height: 0.08, fontSize: 24, color: "#132035" },
    { id: "company", kind: "text", field: "custom:Company", x: 0.06, y: 0.22, width: 0.5, height: 0.05, fontSize: 12 },
    { id: "qr", kind: "qr", x: 0.7, y: 0.1, width: 0.24, height: 0.24 },
  ],
};

const attendee = { name: "Avery Stone", email: "avery@example.com", ticketType: "VIP", customFields: { Company: "Northstar" } };

describe("designed attendee badge PDF renderer", () => {
  it("applies a saved layout to an uploaded PDF and embeds the private QR", async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    const output = await buildBadgePdf({
      layout,
      attendee,
      eventName: "Product Summit",
      qrToken: "opaque-private-qr-token-123456",
      templateBytes: await source.save(),
    });
    const rendered = await PDFDocument.load(output);

    expect(rendered.getPageCount()).toBe(1);
    expect(rendered.getPages()[0]!.getWidth()).toBe(612);
    expect(output.byteLength).toBeGreaterThan(1_000);
  });

  it("creates a blank designed badge when no base PDF is configured", async () => {
    const output = await buildBadgePdf({ layout: { ...layout, pageIndex: 0 }, attendee, eventName: "Product Summit", qrToken: "opaque-private-qr-token-123456" });
    const rendered = await PDFDocument.load(output);

    expect(rendered.getPageCount()).toBe(1);
    expect(rendered.getPages()[0]!.getHeight()).toBe(792);
  });
});
