import { Router } from "express";
import { SESSION_COOKIE, verifySession } from "../lib/session.js";
import { hashToken } from "../lib/tokens.js";
import { pool } from "../db/pool.js";
import { findEventForOrganizer, tenantSqlNames, type EventRow } from "../db/tenant.js";
import { publishCheckIn } from "../realtime/hub.js";
import { checkInInputSchema, checkInNoticeSchema, checkInResultSchema } from "@eventdesk/contracts";
import { requireUuid } from "../middleware/auth.js";
import { sendJson } from "../lib/responses.js";

const router = Router();
interface ScannerLink { label: string }
async function authorizeScanner(rawToken: string, eventId: string): Promise<ScannerLink | null> {
  const result = await pool.query<{ label: string }>(
    `SELECT label FROM public.scanner_links
     WHERE event_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`,
    [eventId, hashToken(rawToken)],
  );
  return result.rows[0] ?? null;
}

router.post("/:eventId/check-ins", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = checkInInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Scan or enter a valid QR code." }); return; }
  try {
    const cookie: unknown = req.cookies?.[SESSION_COOKIE];
    const claims = typeof cookie === "string" ? verifySession(cookie) : null;
    const scannerToken = req.get("x-scanner-token");
    let event: EventRow | null = null;
    let scanner: ScannerLink | null = null;
    if (claims) {
      const organizer = await pool.query<{ id: string }>("SELECT id FROM public.organizers WHERE id=$1 AND username IS NOT NULL LIMIT 1", [claims.organizerId]);
      if (organizer.rows[0]) event = await findEventForOrganizer(req.params.eventId, organizer.rows[0].id);
    }
    // A staff URL remains sufficient even if this browser also has an unrelated organizer cookie.
    if (!event && scannerToken) {
      scanner = await authorizeScanner(scannerToken, req.params.eventId);
      if (scanner) {
        const lookup = await pool.query<EventRow>(
          `SELECT id,project_id,name,starts_at,venue,schema_name,attendee_table_name,checkin_table_name,created_at FROM public.events WHERE id=$1`,
          [req.params.eventId],
        );
        event = lookup.rows[0] ?? null;
      }
    }
    if (!event) { res.status(401).json({ error: "This scanner link is invalid, expired, or no longer authorized." }); return; }
    const names = tenantSqlNames(event);
    const tokenHash = hashToken(parsed.data.token);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string; name: string; email: string | null; ticket_type: string; checked_in_at: Date | null }>(
        `SELECT id,name,email,ticket_type,checked_in_at FROM ${names.schema}.${names.attendees} WHERE qr_token_hash=$1 FOR UPDATE`, [tokenHash],
      );
      const attendee = found.rows[0];
      if (!attendee) {
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "private, no-store");
        return sendJson(res, checkInResultSchema, { status: "invalid", message: "This QR code is not registered for this event.", attendee: null });
      }
      if (attendee.checked_in_at) {
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "private, no-store");
        return sendJson(res, checkInResultSchema, { status: "duplicate", message: `${attendee.name} has already checked in.`, attendee: { id: attendee.id, name: attendee.name, email: attendee.email, ticketType: attendee.ticket_type, checkedInAt: attendee.checked_in_at.toISOString() } });
      }
      const updated = await client.query<{ checked_in_at: Date }>(
        `UPDATE ${names.schema}.${names.attendees} SET checked_in_at=now() WHERE id=$1 RETURNING checked_in_at`, [attendee.id],
      );
      const scannedAt = updated.rows[0]!.checked_in_at;
      await client.query(`INSERT INTO ${names.schema}.${names.checkins}(attendee_id,scanner_label) VALUES ($1,$2)`, [attendee.id, scanner?.label ?? "Organizer"]);
      const notice = checkInNoticeSchema.parse({ eventId: event.id, attendeeId: attendee.id, occurredAt: scannedAt.toISOString() });
      await client.query("SELECT pg_notify($1,$2)", ["eventdesk_checkins", JSON.stringify(notice)]);
      await client.query("COMMIT");
      const result = { status: "valid", message: `${attendee.name} checked in.`, attendee: { id: attendee.id, name: attendee.name, email: attendee.email, ticketType: attendee.ticket_type, checkedInAt: scannedAt.toISOString() } };
      publishCheckIn(notice);
      res.setHeader("Cache-Control", "private, no-store");
      return sendJson(res, checkInResultSchema, result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch (error) { next(error); }
});
export default router;
