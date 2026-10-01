import { z } from "zod";

const isoTimestampSchema = z.string().datetime();
const nonEmptyNameSchema = z.string().trim().min(1).max(160);

export const uuidSchema = z.string().uuid();

// Request contracts: imported by both the Express validators and browser serializers.
export const projectInputSchema = z.object({ name: z.string().trim().min(2).max(120) }).strict();
export const projectUpdateSchema = projectInputSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one project field to update.");
export const eventInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  startsAt: isoTimestampSchema.optional(),
  venue: z.string().trim().max(240).optional(),
}).strict();
export const eventUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  startsAt: isoTimestampSchema.nullable().optional(),
  venue: z.string().trim().max(240).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one event field to update.");
export const customFieldKeySchema = z.string().trim().min(1).max(50).regex(/^[A-Za-z][A-Za-z0-9 _.-]*$/, "Use a field name starting with a letter; letters, numbers, spaces, dots, hyphens and underscores are supported.");
export const attendeeCustomFieldsSchema = z.record(customFieldKeySchema, z.string().max(1000))
  .refine((value) => Object.keys(value).length <= 30, "A maximum of 30 custom attendee fields is supported.");
export const attendeeInputSchema = z.object({
  name: nonEmptyNameSchema,
  email: z.string().trim().email().max(320).optional().or(z.literal("")),
  ticketType: z.string().trim().min(1).max(80).default("General"),
  customFields: attendeeCustomFieldsSchema.default({}),
}).strict();
export const bulkAttendeeInputSchema = z.object({ attendees: z.array(attendeeInputSchema).min(1).max(500) }).strict();
export const checkInInputSchema = z.object({ token: z.string().trim().min(16).max(256) }).strict();
export const scannerLinkInputSchema = z.object({
  label: z.string().trim().min(1).max(80).default("Front gate"),
  expiresInHours: z.number().int().min(1).max(720).default(72),
}).strict();
type ScannerBrandingColors = { accentColor: string; backgroundColor: string; panelColor: string; textColor: string; mutedTextColor: string };

export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(left: string, right: string): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function scannerBrandingContrastIssues(colors: ScannerBrandingColors): string[] {
  const checks: Array<[string, string, string]> = [
    [colors.textColor, colors.backgroundColor, "Main text needs at least 4.5:1 contrast on the page background."],
    [colors.textColor, colors.panelColor, "Main text needs at least 4.5:1 contrast on panels."],
    [colors.mutedTextColor, colors.backgroundColor, "Muted text needs at least 4.5:1 contrast on the page background."],
    [colors.mutedTextColor, colors.panelColor, "Muted text needs at least 4.5:1 contrast on panels."],
    [colors.accentColor, colors.backgroundColor, "The accent needs at least 4.5:1 contrast on the page background."],
    [scannerAccentForegroundColor(colors.accentColor), colors.accentColor, "Accent button text needs at least 4.5:1 contrast on the accent."],
  ];
  return checks.filter(([foreground, background]) => contrastRatio(foreground, background) < 4.5).map(([, , message]) => message);
}

export function scannerAccentForegroundColor(accentColor: string): "#ffffff" | "#000000" {
  return contrastRatio(accentColor, "#ffffff") >= contrastRatio(accentColor, "#000000") ? "#ffffff" : "#000000";
}

export const scannerBrandingSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  brandTagline: z.string().trim().max(80),
  logoDataUrl: z.string().max(350_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
  accentColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  panelColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  textColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  mutedTextColor: z.string().regex(/^#[\da-fA-F]{6}$/),
}).strict().superRefine((value, ctx) => {
  const issues = scannerBrandingContrastIssues(value);
  for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});
export const defaultScannerBranding = {
  brandName: "ALMIRA AUREA",
  brandTagline: "Gatepass / scanner",
  logoDataUrl: null,
  accentColor: "#5697ff",
  backgroundColor: "#111722",
  panelColor: "#151f2e",
  textColor: "#f4f6fb",
  mutedTextColor: "#9aa7bc",
} satisfies z.infer<typeof scannerBrandingSchema>;
export const scannerBrandingGetResponseSchema = z.object({
  branding: scannerBrandingSchema,
  updatedAt: isoTimestampSchema.nullable(),
}).strict();
export const scannerBrandingPutResponseSchema = z.object({
  branding: scannerBrandingSchema,
  updatedAt: isoTimestampSchema,
}).strict();

export const eventAdminBrandingSchema = z.object({
  logoDataUrl: z.string().max(350_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
  accentColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  panelColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  textColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  mutedTextColor: z.string().regex(/^#[\da-fA-F]{6}$/),
}).strict().superRefine((value, ctx) => {
  const issues = scannerBrandingContrastIssues(value);
  for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

export const defaultEventAdminBranding = {
  logoDataUrl: null,
  accentColor: "#3468dc",
  backgroundColor: "#f4f6fb",
  panelColor: "#ffffff",
  textColor: "#0f172a",
  mutedTextColor: "#475569", // Changed from #64748b to pass 4.5:1 contrast check
} satisfies z.infer<typeof eventAdminBrandingSchema>;

export const eventAdminBrandingGetResponseSchema = z.object({
  branding: eventAdminBrandingSchema,
  updatedAt: isoTimestampSchema.nullable(),
}).strict();
export const eventAdminBrandingPutResponseSchema = z.object({
  branding: eventAdminBrandingSchema,
  updatedAt: isoTimestampSchema,
}).strict();

const usernameSchema = z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9][a-z0-9._-]*$/);
export const localLoginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) }).strict();
export const localSetupSchema = z.object({ username: usernameSchema, password: z.string().min(12).max(128) }).strict();
export const setupStatusSchema = z.object({ setupRequired: z.boolean(), setupBlocked: z.boolean() }).strict();

export const badgeFieldSchema = z.enum(["name", "email", "ticketType", "eventName", "custom", "static"])
  .or(z.string().regex(/^custom:[A-Za-z][A-Za-z0-9 _.-]{0,49}$/, "Badge field must reference a valid attendee custom-field key."));
export const badgeElementSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["qr", "text", "image"]),
  field: badgeFieldSchema.optional(),
  text: z.string().max(300).optional(),
  imageDataUrl: z.string().max(2_000_000).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  fontSize: z.number().int().min(6).max(96).optional(),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
}).strict();
export const badgeLayoutSchema = z.object({
  pageIndex: z.number().int().min(0).max(199),
  pageWidth: z.number().positive().max(3000),
  pageHeight: z.number().positive().max(3000),
  elements: z.array(badgeElementSchema).max(40),
}).strict();

// Canonical response contracts: API serializers validate against these before returning JSON,
// and browser clients validate the received payload against the very same schemas.
export const membershipRoleSchema = z.enum(["owner", "manager", "viewer"]);
export const userSchema = z.object({
  id: uuidSchema,
  username: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
  displayName: z.string().min(1).max(120),
}).strict();
export const projectSchema = z.object({
  id: uuidSchema,
  name: z.string().min(2).max(120),
  createdAt: isoTimestampSchema,
  eventCount: z.number().int().nonnegative().optional(),
  role: membershipRoleSchema,
}).strict();
export const projectListSchema = z.array(projectSchema);
export const eventSummarySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  name: z.string().min(2).max(160),
  startsAt: isoTimestampSchema.nullable(),
  venue: z.string().max(240).nullable(),
  createdAt: isoTimestampSchema,
}).strict();
export const eventListSchema = z.array(eventSummarySchema);
export const attendeeSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  email: z.string().max(320).nullable(),
  ticketType: z.string().min(1).max(80),
  customFields: attendeeCustomFieldsSchema,
  checkedInAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
}).strict();
export const attendeeListSchema = z.array(attendeeSchema);
export const attendeeFieldListSchema = z.array(customFieldKeySchema);
export const qrDataResponseSchema = z.object({ qrDataUrl: z.string().startsWith("data:image/png;base64,") }).strict();
export const issuedAttendeeSchema = z.object({ attendee: attendeeSchema, qrDataUrl: z.string().startsWith("data:image/png;base64,") }).strict();
export const bulkAttendeeResultSchema = z.object({
  count: z.number().int().min(1).max(500),
  attendees: z.array(issuedAttendeeSchema).min(1).max(500),
}).strict().refine((value) => value.count === value.attendees.length, "Bulk issue count must equal its attendee row count.");
const checkInAttendeeSchema = attendeeSchema.pick({ id: true, name: true, email: true, ticketType: true, checkedInAt: true });
export const checkInResultSchema = z.object({
  status: z.enum(["valid", "duplicate", "invalid"]),
  message: z.string().min(1).max(320),
  attendee: checkInAttendeeSchema.nullable(),
}).strict().refine((value) => (value.status === "invalid") === (value.attendee === null), "Invalid check-ins must not include attendee data.");
export const recentCheckInSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  ticketType: z.string().min(1).max(80),
  checkedInAt: isoTimestampSchema,
}).strict();
export const dashboardSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  checkedIn: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  rate: z.number().min(0).max(100),
  recentCheckIns: z.array(recentCheckInSchema).max(8),
  hourly: z.array(z.object({ hour: z.string().regex(/^(?:[01]\d|2[0-3]):00$/), count: z.number().int().nonnegative() }).strict()).max(12),
}).strict().refine((value) => value.checkedIn <= value.total && value.remaining === value.total - value.checkedIn, "Dashboard counts are inconsistent.");
export const eventDashboardSchema = z.object({ event: eventSummarySchema, summary: dashboardSummarySchema, branding: eventAdminBrandingSchema.optional() }).strict();
export const scannerLinkIssueResponseSchema = z.object({
  id: uuidSchema,
  eventId: uuidSchema,
  label: z.string().min(1).max(80),
  url: z.string().min(1).max(2048),
  expiresAt: isoTimestampSchema,
}).strict();
export const scannerLinkCopyResponseSchema = z.object({ url: z.string().min(1).max(2048) }).strict();
export const scannerLinkListItemSchema = z.object({
  id: uuidSchema,
  eventId: uuidSchema,
  label: z.string().min(1).max(80),
  expiresAt: isoTimestampSchema.nullable(),
  revokedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  canCopy: z.boolean(),
}).strict();
export const scannerLinkListSchema = z.array(scannerLinkListItemSchema);
export const scannerSessionSchema = z.object({
  eventId: uuidSchema,
  eventName: z.string().min(2).max(160),
  label: z.string().min(1).max(80),
  expiresAt: isoTimestampSchema.nullable(),
}).strict();
export const badgeLayoutGetResponseSchema = z.object({ layout: badgeLayoutSchema.nullable(), updatedAt: isoTimestampSchema.nullable() }).strict();
export const badgeLayoutPutResponseSchema = z.object({ layout: badgeLayoutSchema, updatedAt: isoTimestampSchema }).strict();
export const badgeTemplateUploadMetadataSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  pageCount: z.number().int().min(1).max(200),
  pageWidth: z.number().positive().max(3000),
  pageHeight: z.number().positive().max(3000),
}).strict();
export const badgeTemplateSchema = z.object({
  assetPath: z.string().max(2048).regex(/^\/manus-storage\/[A-Za-z0-9._/-]+$/),
  fileName: z.string().min(1).max(180),
  pageCount: z.number().int().min(1).max(200),
  pageWidth: z.number().positive().max(3000),
  pageHeight: z.number().positive().max(3000),
  updatedAt: isoTimestampSchema,
}).strict();
export const badgeTemplateGetResponseSchema = z.object({ template: badgeTemplateSchema.nullable() }).strict();
export const badgeTemplatePutResponseSchema = z.object({ template: badgeTemplateSchema }).strict();
export const healthResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), service: z.literal("eventdesk-api"), database: z.literal("connected") }).strict(),
  z.object({ ok: z.literal(false), service: z.literal("eventdesk-api"), database: z.literal("unavailable") }).strict(),
]);
export const apiErrorResponseSchema = z.object({ error: z.string().min(1).max(500) }).strict();
export const checkInNoticeSchema = z.object({ eventId: uuidSchema, attendeeId: uuidSchema, occurredAt: isoTimestampSchema }).strict();

export function contractJson<S extends z.ZodTypeAny>(schema: S, value: unknown): string {
  return JSON.stringify(schema.parse(value));
}

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
export type AttendeeCustomFields = z.infer<typeof attendeeCustomFieldsSchema>;
export type AttendeeInput = z.infer<typeof attendeeInputSchema>;
export type AttendeeFieldList = z.infer<typeof attendeeFieldListSchema>;
export type BulkAttendeeInput = z.infer<typeof bulkAttendeeInputSchema>;
export type CheckInInput = z.infer<typeof checkInInputSchema>;
export type ScannerLinkInput = z.infer<typeof scannerLinkInputSchema>;
export type LocalLoginInput = z.infer<typeof localLoginSchema>;
export type LocalSetupInput = z.infer<typeof localSetupSchema>;
export type BadgeLayout = z.infer<typeof badgeLayoutSchema>;
export type BadgeElement = z.infer<typeof badgeElementSchema>;
export type BadgeField = z.infer<typeof badgeFieldSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type User = z.infer<typeof userSchema>;
export type Project = z.infer<typeof projectSchema>;
export type EventSummary = z.infer<typeof eventSummarySchema>;
export type Attendee = z.infer<typeof attendeeSchema>;
export type IssuedAttendee = z.infer<typeof issuedAttendeeSchema>;
export type BulkAttendeeResult = z.infer<typeof bulkAttendeeResultSchema>;
export type CheckInResult = z.infer<typeof checkInResultSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type EventDashboard = z.infer<typeof eventDashboardSchema>;
export type ScannerLinkIssueResponse = z.infer<typeof scannerLinkIssueResponseSchema>;
export type ScannerLinkListItem = z.infer<typeof scannerLinkListItemSchema>;
export type ScannerSession = z.infer<typeof scannerSessionSchema>;
export type ScannerBranding = z.infer<typeof scannerBrandingSchema>;
export type ScannerBrandingGetResponse = z.infer<typeof scannerBrandingGetResponseSchema>;
export type ScannerBrandingPutResponse = z.infer<typeof scannerBrandingPutResponseSchema>;
export type EventAdminBranding = z.infer<typeof eventAdminBrandingSchema>;
export type EventAdminBrandingGetResponse = z.infer<typeof eventAdminBrandingGetResponseSchema>;
export type EventAdminBrandingPutResponse = z.infer<typeof eventAdminBrandingPutResponseSchema>;
export type BadgeLayoutGetResponse = z.infer<typeof badgeLayoutGetResponseSchema>;
export type BadgeLayoutPutResponse = z.infer<typeof badgeLayoutPutResponseSchema>;
export type BadgeTemplate = z.infer<typeof badgeTemplateSchema>;
export type BadgeTemplateGetResponse = z.infer<typeof badgeTemplateGetResponseSchema>;
export type BadgeTemplatePutResponse = z.infer<typeof badgeTemplatePutResponseSchema>;
export type QrDataResponse = z.infer<typeof qrDataResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type CheckInNotice = z.infer<typeof checkInNoticeSchema>;
