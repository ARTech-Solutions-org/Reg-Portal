import { describe, expect, it } from "vitest";
import {
  apiErrorResponseSchema,
  attendeeFieldListSchema,
  attendeeInputSchema,
  badgeElementSchema,
  badgeLayoutGetResponseSchema,
  badgeLayoutPutResponseSchema,
  badgeTemplateGetResponseSchema,
  badgeTemplatePutResponseSchema,
  bulkAttendeeResultSchema,
  customFieldKeySchema,
  checkInResultSchema,
  contractJson,
  defaultScannerBranding,
  eventDashboardSchema,
  eventInputSchema,
  localLoginSchema,
  localSetupSchema,
  projectSchema,
  scannerLinkCopyResponseSchema,
  scannerLinkIssueResponseSchema,
  scannerAccentForegroundColor,
  scannerLinkListItemSchema,
  scannerBrandingGetResponseSchema,
  scannerBrandingSchema,
  setupStatusSchema,
  userSchema,
} from "@eventdesk/contracts";

const eventId = "06ae1e46-78c5-4db4-b090-e36112ca7311";
const projectId = "2d63b1ca-19e1-4a2f-9587-5d574bc91234";
const recordId = "6f55870a-1581-4a88-81a0-97d8e53fb583";
const stamp = "2026-09-29T10:00:00.000Z";

const validEventDashboard = {
  event: { id: eventId, projectId, name: "Product Summit", startsAt: null, venue: null, createdAt: stamp },
  summary: {
    total: 2,
    checkedIn: 1,
    remaining: 1,
    rate: 50,
    recentCheckIns: [{ id: recordId, name: "Alex Guest", ticketType: "General", checkedInAt: stamp }],
    hourly: [{ hour: "10:00", count: 1 }],
  },
};

describe("shared API wire contracts", () => {
  it("normalizes local usernames, enforces first-account password length, and returns username-based user DTOs", () => {
    const setup = localSetupSchema.parse({ username: "  Event.Owner  ", password: "long local password 2026" });
    expect(setup.username).toBe("event.owner");
    expect(localSetupSchema.safeParse({ username: "owner", password: "short" }).success).toBe(false);
    expect(localLoginSchema.parse({ username: " OWNER ", password: "short legacy password" }).username).toBe("owner");
    expect(localLoginSchema.safeParse({ username: "x", password: "pw" }).success).toBe(false);
    expect(setupStatusSchema.parse({ setupRequired: true, setupBlocked: false })).toEqual({ setupRequired: true, setupBlocked: false });
    expect(setupStatusSchema.parse({ setupRequired: false, setupBlocked: true }).setupBlocked).toBe(true);
    expect(userSchema.parse({ id: projectId, username: "owner", displayName: "owner" }).username).toBe("owner");
  });

  it("accepts each supported project membership role and rejects the obsolete member alias", () => {
    for (const role of ["owner", "manager", "viewer"] as const) {
      expect(projectSchema.parse({ id: projectId, name: "Operations", createdAt: stamp, role }).role).toBe(role);
    }
    expect(projectSchema.safeParse({ id: projectId, name: "Operations", createdAt: stamp, role: "member" }).success).toBe(false);
  });

  it("keeps the one-time scanner-link credential separate from redacted scanner history records", () => {
    const issued = { id: recordId, eventId, label: "Front gate", url: `/scanner/${eventId}?token=one-time-secret`, expiresAt: stamp };
    const listed = { id: recordId, eventId, label: "Front gate", expiresAt: stamp, revokedAt: null, createdAt: stamp, canCopy: false };
    expect(scannerLinkIssueResponseSchema.parse(issued)).toEqual(issued);
    expect(scannerLinkCopyResponseSchema.parse({ url: issued.url })).toEqual({ url: issued.url });
    expect(scannerLinkListItemSchema.parse(listed)).toEqual(listed);
    expect(scannerLinkListItemSchema.safeParse(issued).success).toBe(false);
    expect(scannerLinkIssueResponseSchema.safeParse(listed).success).toBe(false);
    expect(scannerLinkListItemSchema.safeParse({ ...listed, url: issued.url }).success).toBe(false);
  });

  it("validates event-specific scanner branding and preserves the default Gatepass identity", () => {
    expect(scannerBrandingSchema.parse(defaultScannerBranding)).toEqual(defaultScannerBranding);
    const custom = scannerBrandingSchema.parse({
      ...defaultScannerBranding,
      brandName: "Northstar Summit",
      brandTagline: "Check-in desk",
      accentColor: "#7ab0ff",
      logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(scannerBrandingGetResponseSchema.parse({ branding: custom, updatedAt: stamp }).branding.brandName).toBe("Northstar Summit");
    expect(scannerBrandingSchema.safeParse({ ...defaultScannerBranding, accentColor: "blue" }).success).toBe(false);
    expect(scannerBrandingSchema.safeParse({ ...defaultScannerBranding, mutedTextColor: "#283040" }).success).toBe(false);
    expect(scannerAccentForegroundColor("#7d7d7d")).toBe("#000000");
    expect(scannerBrandingSchema.safeParse({ ...defaultScannerBranding, accentColor: "#7d7d7d", backgroundColor: "#000000", panelColor: "#000000", textColor: "#ffffff", mutedTextColor: "#bbbbbb" }).success).toBe(true);
    expect(scannerBrandingSchema.safeParse({ ...defaultScannerBranding, logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).success).toBe(false);
  });

  it("validates consistent event analytics and each check-in result variant", () => {
    expect(eventDashboardSchema.parse(validEventDashboard).summary.remaining).toBe(1);
    expect(eventDashboardSchema.safeParse({ ...validEventDashboard, summary: { ...validEventDashboard.summary, remaining: 0 } }).success).toBe(false);
    const attendee = { id: recordId, name: "Alex Guest", email: null, ticketType: "General", checkedInAt: stamp };
    expect(checkInResultSchema.parse({ status: "valid", message: "Checked in.", attendee }).status).toBe("valid");
    expect(checkInResultSchema.parse({ status: "duplicate", message: "Already checked in.", attendee }).status).toBe("duplicate");
    expect(checkInResultSchema.parse({ status: "invalid", message: "Unknown QR.", attendee: null }).status).toBe("invalid");
    expect(checkInResultSchema.safeParse({ status: "invalid", message: "Unknown QR.", attendee }).success).toBe(false);
  });

  it("accepts a nullable initial badge layout but requires a persisted layout on save", () => {
    expect(badgeLayoutGetResponseSchema.parse({ layout: null, updatedAt: null })).toEqual({ layout: null, updatedAt: null });
    const layout = { pageIndex: 0, pageWidth: 612, pageHeight: 792, elements: [] };
    expect(badgeLayoutPutResponseSchema.parse({ layout, updatedAt: stamp }).layout).toEqual(layout);
    expect(badgeLayoutPutResponseSchema.safeParse({ layout: null, updatedAt: null }).success).toBe(false);
  });

  it("accepts arbitrary validated attendee fields and binds custom badge elements to their keys", () => {
    const fields = { Company: "Northstar", "Seat zone": "B-12" };
    expect(attendeeFieldListSchema.parse(["Company", "Seat zone"])).toEqual(["Company", "Seat zone"]);
    expect(attendeeFieldListSchema.safeParse(["bad/key"]).success).toBe(false);
    expect(attendeeInputSchema.parse({ name: "Alex Guest", customFields: fields }).customFields).toEqual(fields);
    expect(customFieldKeySchema.safeParse("Seat #").success).toBe(false);
    expect(attendeeInputSchema.safeParse({ name: "Alex Guest", customFields: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`Field ${index + 1}`, "value"])) }).success).toBe(false);
    const element = { id: "company-field", kind: "text", field: "custom:Company", x: 0.1, y: 0.2, width: 0.4, height: 0.08 };
    expect(badgeElementSchema.parse(element).field).toBe("custom:Company");
    expect(badgeElementSchema.safeParse({ ...element, field: "custom:bad/key" }).success).toBe(false);
  });

  it("validates stable, event-owned PDF template metadata and rejects external asset paths", () => {
    const template = {
      assetPath: `/manus-storage/eventdesk/events/${eventId}/badge-template/${recordId}.pdf`,
      fileName: "event badge.pdf",
      pageCount: 1,
      pageWidth: 612,
      pageHeight: 792,
      updatedAt: stamp,
    };
    expect(badgeTemplateGetResponseSchema.parse({ template })).toEqual({ template });
    expect(badgeTemplateGetResponseSchema.parse({ template: null })).toEqual({ template: null });
    expect(badgeTemplatePutResponseSchema.parse({ template }).template.assetPath).toBe(template.assetPath);
    expect(badgeTemplateGetResponseSchema.safeParse({ template: { ...template, assetPath: "https://example.com/template.pdf" } }).success).toBe(false);
  });

  it("enforces the attendee count and uses the shared serializer to normalize request data", () => {
    const issued = {
      attendee: { id: recordId, name: "Alex Guest", email: null, ticketType: "General", customFields: {}, checkedInAt: null, createdAt: stamp },
      qrDataUrl: "data:image/png;base64,AA==",
    };
    expect(bulkAttendeeResultSchema.parse({ count: 1, attendees: [issued] }).count).toBe(1);
    expect(bulkAttendeeResultSchema.safeParse({ count: 2, attendees: [issued] }).success).toBe(false);
    const body = JSON.parse(contractJson(eventInputSchema, { name: "  Product Summit  ", startsAt: undefined }));
    expect(body).toEqual({ name: "Product Summit" });
    expect(apiErrorResponseSchema.parse({ error: "Request failed." }).error).toBe("Request failed.");
  });
});
