import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { PDFDocument } from "pdf-lib";
import { apiErrorResponseSchema, badgeArchiveFilenames, badgeArchiveInputSchema, badgeLayoutSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer, tenantSqlNames } from "../db/tenant.js";
import { decryptToken } from "../lib/tokens.js";
import { downloadManagedObject, ManagedStorageError } from "../lib/managed-storage.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";
import { streamBadgeArchive } from "../services/badge-archive.js";
import { buildBadgePdf } from "../services/badge-pdf.js";

const router = Router();
router.use(requireOrganizer);

function fileSlug(name: string): string {
  return name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "attendee";
}

async function loadBadgeDesign(eventId: string) {
  const [layoutResult, templateResult] = await Promise.all([
    pool.query<{ layout: unknown }>("SELECT layout FROM public.badge_layouts WHERE event_id=$1 LIMIT 1", [eventId]),
    pool.query<{ storage_key: string }>("SELECT storage_key FROM public.badge_templates WHERE event_id=$1 LIMIT 1", [eventId]),
  ]);
  const savedLayout = layoutResult.rows[0]?.layout;
  const parsedLayout = badgeLayoutSchema.safeParse(savedLayout);
  if (!parsedLayout.success) {
    return {
      ok: false,
      error: savedLayout ? "The saved badge layout is invalid. Open the designer and save it again." : "Save a badge design before downloading designed attendee badges.",
    } as const;
  }

  const storageKey = templateResult.rows[0]?.storage_key;
  const templateBytes = storageKey ? await downloadManagedObject(storageKey) : undefined;
  return { ok: true, layout: parsedLayout.data, templateBytes } as const;
}

router.get("/:eventId/attendees/:attendeeId/badge.pdf", async (req, res, next) => {
  if (!requireUuid(req.params.eventId) || !requireUuid(req.params.attendeeId)) {
    return sendJson(res, apiErrorResponseSchema, { error: "Invalid event or attendee ID." }, 400);
  }

  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) return sendJson(res, apiErrorResponseSchema, { error: "Event not found." }, 404);

    const { schema, attendees } = tenantSqlNames(event);
    const attendeeResult = await pool.query<{
      name: string | null;
      email: string | null;
      ticket_type: string | null;
      custom_fields: Record<string, string> | null;
      qr_token_ciphertext: string | null;
    }>(
      `SELECT name,email,ticket_type,custom_fields,qr_token_ciphertext FROM ${schema}.${attendees} WHERE id=$1 LIMIT 1`,
      [req.params.attendeeId],
    );
    const attendee = attendeeResult.rows[0];
    if (!attendee) return sendJson(res, apiErrorResponseSchema, { error: "Attendee not found for this event." }, 404);

    if (!attendee.qr_token_ciphertext) return sendJson(res, apiErrorResponseSchema, { error: "Generate the attendee QR code before downloading a badge." }, 409);

    const design = await loadBadgeDesign(event.id);
    if (!design.ok) return sendJson(res, apiErrorResponseSchema, { error: design.error }, 409);

    const pdfBytes = await buildBadgePdf({
      layout: design.layout,
      attendees: [{
        name: attendee.name,
        email: attendee.email,
        ticketType: attendee.ticket_type,
        customFields: attendee.custom_fields ?? {},
      }],
      eventName: event.name,
      qrTokens: [decryptToken(attendee.qr_token_ciphertext)],
      templateBytes: design.templateBytes,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="eventdesk-${fileSlug(attendee.name ?? "")}-badge.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    if (error instanceof ManagedStorageError) return sendJson(res, apiErrorResponseSchema, { error: error.message }, error.status);
    return next(error);
  }
});

router.post("/:eventId/badges/bulk.pdf", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) {
    return sendJson(res, apiErrorResponseSchema, { error: "Invalid event ID." }, 400);
  }
  const body = req.body as { attendeeIds?: string[] };
  if (!body || !Array.isArray(body.attendeeIds) || body.attendeeIds.length === 0) {
    return sendJson(res, apiErrorResponseSchema, { error: "Missing attendee IDs." }, 400);
  }

  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) return sendJson(res, apiErrorResponseSchema, { error: "Event not found." }, 404);

    const { schema, attendees } = tenantSqlNames(event);
    const placeholders = body.attendeeIds.map((_, i) => `$${i + 1}`).join(",");
    const attendeeResult = await pool.query<{
      name: string | null;
      email: string | null;
      ticket_type: string | null;
      custom_fields: Record<string, string> | null;
      qr_token_ciphertext: string | null;
    }>(
      `SELECT name,email,ticket_type,custom_fields,qr_token_ciphertext FROM ${schema}.${attendees} WHERE id IN (${placeholders})`,
      body.attendeeIds,
    );
    
    if (attendeeResult.rows.length === 0) {
      return sendJson(res, apiErrorResponseSchema, { error: "No attendees found." }, 404);
    }

    const design = await loadBadgeDesign(event.id);
    if (!design.ok) return sendJson(res, apiErrorResponseSchema, { error: design.error }, 409);

    const mappedAttendees = attendeeResult.rows.map((row) => ({
      name: row.name,
      email: row.email,
      ticketType: row.ticket_type,
      customFields: row.custom_fields ?? {},
    }));
    const qrTokens = [];
    for (const row of attendeeResult.rows) {
      if (!row.qr_token_ciphertext) return sendJson(res, apiErrorResponseSchema, { error: "Generate QR codes for all selected attendees before downloading badges." }, 409);
      qrTokens.push(decryptToken(row.qr_token_ciphertext));
    }

    const pdfBytes = await buildBadgePdf({
      layout: design.layout,
      attendees: mappedAttendees,
      eventName: event.name,
      qrTokens,
      templateBytes: design.templateBytes,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="eventdesk-bulk-badges.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    if (error instanceof ManagedStorageError) return sendJson(res, apiErrorResponseSchema, { error: error.message }, error.status);
    return next(error);
  }
});


router.post("/:eventId/badges/bulk.zip", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) {
    return sendJson(res, apiErrorResponseSchema, { error: "Invalid event ID." }, 400);
  }
  const parsed = badgeArchiveInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendJson(res, apiErrorResponseSchema, { error: "Select attendees and choose one or two filename fields." }, 400);
  }
  const ids = parsed.data.attendeeIds.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    return sendJson(res, apiErrorResponseSchema, { error: "Attendee IDs must be unique." }, 400);
  }

  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) return sendJson(res, apiErrorResponseSchema, { error: "Event not found." }, 404);

    const { schema, attendees } = tenantSqlNames(event);
    const result = await pool.query<{
      id: string;
      name: string | null;
      email: string | null;
      ticket_type: string | null;
      custom_fields: Record<string, string> | null;
      qr_token_ciphertext: string | null;
    }>(
      `SELECT id,name,email,ticket_type,custom_fields,qr_token_ciphertext FROM ${schema}.${attendees}
       WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`, [ids],
    );
    if (result.rows.length !== ids.length) {
      return sendJson(res, apiErrorResponseSchema, { error: "Some attendees could not be found in this event." }, 404);
    }
    const badgeAttendees = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      ticketType: row.ticket_type,
      customFields: row.custom_fields ?? {},
    }));
    const qrTokens: string[] = [];
    for (const row of result.rows) {
      if (!row.qr_token_ciphertext) {
        return sendJson(res, apiErrorResponseSchema, { error: "Generate QR codes for all selected attendees before downloading badges." }, 409);
      }
      qrTokens.push(decryptToken(row.qr_token_ciphertext));
    }

    const design = await loadBadgeDesign(event.id);
    if (!design.ok) return sendJson(res, apiErrorResponseSchema, { error: design.error }, 409);
    const templatePdf = design.templateBytes ? await PDFDocument.load(design.templateBytes) : undefined;
    const filenames = badgeArchiveFilenames(badgeAttendees, parsed.data.filenameFields);
    const render = (index: number) => buildBadgePdf({
      layout: design.layout,
      attendees: [badgeAttendees[index]!],
      eventName: event.name,
      qrTokens: [qrTokens[index]!],
      templatePdf,
    });
    const firstBadge = await render(0);
    if (res.destroyed) return;
    const archive = streamBadgeArchive(filenames, (index) => index === 0 ? Promise.resolve(firstBadge) : render(index));
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="eventdesk-badges.zip"');
    res.setHeader("Cache-Control", "private, no-store");
    await pipeline(Readable.from(archive, { objectMode: false }), res);
  } catch (error) {
    if (res.destroyed) {
      if (!(error instanceof Error && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE")) {
        console.error("Badge archive failed:", error instanceof Error ? error.message : "unknown error");
      }
      return;
    }
    if (error instanceof ManagedStorageError) return sendJson(res, apiErrorResponseSchema, { error: error.message }, error.status);
    return next(error);
  }
});

export default router;
