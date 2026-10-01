import { Router } from "express";
import { apiErrorResponseSchema, badgeLayoutSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer, tenantSqlNames } from "../db/tenant.js";
import { decryptToken } from "../lib/tokens.js";
import { downloadManagedObject, ManagedStorageError } from "../lib/managed-storage.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";
import { buildBadgePdf } from "../services/badge-pdf.js";

const router = Router();
router.use(requireOrganizer);

function fileSlug(name: string): string {
  return name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "attendee";
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
      name: string;
      email: string | null;
      ticket_type: string;
      custom_fields: Record<string, string> | null;
      qr_token_ciphertext: string;
    }>(
      `SELECT name,email,ticket_type,custom_fields,qr_token_ciphertext FROM ${schema}.${attendees} WHERE id=$1 LIMIT 1`,
      [req.params.attendeeId],
    );
    const attendee = attendeeResult.rows[0];
    if (!attendee) return sendJson(res, apiErrorResponseSchema, { error: "Attendee not found for this event." }, 404);

    const [layoutResult, templateResult] = await Promise.all([
      pool.query<{ layout: unknown }>("SELECT layout FROM public.badge_layouts WHERE event_id=$1 LIMIT 1", [event.id]),
      pool.query<{ storage_key: string }>("SELECT storage_key FROM public.badge_templates WHERE event_id=$1 LIMIT 1", [event.id]),
    ]);
    const savedLayout = layoutResult.rows[0]?.layout;
    const parsedLayout = badgeLayoutSchema.safeParse(savedLayout);
    if (!parsedLayout.success) {
      return sendJson(res, apiErrorResponseSchema, {
        error: savedLayout ? "The saved badge layout is invalid. Open the designer and save it again." : "Save a badge design before downloading designed attendee badges.",
      }, 409);
    }

    const storageKey = templateResult.rows[0]?.storage_key;
    const templateBytes = storageKey ? await downloadManagedObject(storageKey) : undefined;
    const pdfBytes = await buildBadgePdf({
      layout: parsedLayout.data,
      attendees: [{
        name: attendee.name,
        email: attendee.email,
        ticketType: attendee.ticket_type,
        customFields: attendee.custom_fields ?? {},
      }],
      eventName: event.name,
      qrTokens: [decryptToken(attendee.qr_token_ciphertext)],
      ...(templateBytes ? { templateBytes } : {}),
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="eventdesk-${fileSlug(attendee.name)}-badge.pdf"`);
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
      name: string;
      email: string | null;
      ticket_type: string;
      custom_fields: Record<string, string> | null;
      qr_token_ciphertext: string;
    }>(
      `SELECT name,email,ticket_type,custom_fields,qr_token_ciphertext FROM ${schema}.${attendees} WHERE id IN (${placeholders})`,
      body.attendeeIds,
    );
    
    if (attendeeResult.rows.length === 0) {
      return sendJson(res, apiErrorResponseSchema, { error: "No attendees found." }, 404);
    }

    const [layoutResult, templateResult] = await Promise.all([
      pool.query<{ layout: unknown }>("SELECT layout FROM public.badge_layouts WHERE event_id=$1 LIMIT 1", [event.id]),
      pool.query<{ storage_key: string }>("SELECT storage_key FROM public.badge_templates WHERE event_id=$1 LIMIT 1", [event.id]),
    ]);
    const savedLayout = layoutResult.rows[0]?.layout;
    const parsedLayout = badgeLayoutSchema.safeParse(savedLayout);
    if (!parsedLayout.success) {
      return sendJson(res, apiErrorResponseSchema, {
        error: savedLayout ? "The saved badge layout is invalid. Open the designer and save it again." : "Save a badge design before downloading designed attendee badges.",
      }, 409);
    }

    const storageKey = templateResult.rows[0]?.storage_key;
    const templateBytes = storageKey ? await downloadManagedObject(storageKey) : undefined;
    
    const mappedAttendees = attendeeResult.rows.map((row) => ({
      name: row.name,
      email: row.email,
      ticketType: row.ticket_type,
      customFields: row.custom_fields ?? {},
    }));
    const qrTokens = attendeeResult.rows.map((row) => decryptToken(row.qr_token_ciphertext));

    const pdfBytes = await buildBadgePdf({
      layout: parsedLayout.data,
      attendees: mappedAttendees,
      eventName: event.name,
      qrTokens,
      ...(templateBytes ? { templateBytes } : {}),
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

export default router;
