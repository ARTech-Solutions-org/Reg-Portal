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
    // Query event scan settings
    const settingsRes = await pool.query<{ max_scans_per_attendee: number | null; scan_mode: "checkin_only" | "checkin_checkout" | null }>(
      "SELECT max_scans_per_attendee, scan_mode FROM public.event_registration_settings WHERE event_id = $1",
      [event.id],
    );
    const maxScans = settingsRes.rows[0]?.max_scans_per_attendee ?? 1;
    const scanMode = settingsRes.rows[0]?.scan_mode ?? "checkin_only";

    const names = tenantSqlNames(event);
    const tokenHash = hashToken(parsed.data.token);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        id: string;
        name: string;
        email: string | null;
        ticket_type: string;
        checked_in_at: Date | null;
        scan_count: number | null;
        last_direction: string | null;
      }>(
        `SELECT id, name, email, ticket_type, checked_in_at, scan_count, last_direction
         FROM ${names.schema}.${names.attendees} WHERE qr_token_hash=$1 FOR UPDATE`,
        [tokenHash],
      );
      const attendee = found.rows[0];
      if (!attendee) {
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "private, no-store");
        return sendJson(res, checkInResultSchema, { status: "invalid", message: "This QR code is not registered for this event.", attendee: null });
      }

      const currentScans = attendee.scan_count ?? (attendee.checked_in_at ? 1 : 0);
      const requestedDirection = parsed.data.direction ?? "auto";

      // 1. Determine target direction based on operator choice or auto
      let targetDirection: "in" | "out" = "in";
      let action: "check_in" | "check_out" = "check_in";

      if (requestedDirection === "in") {
        targetDirection = "in";
        action = "check_in";
      } else if (requestedDirection === "out") {
        targetDirection = "out";
        action = "check_out";
      } else {
        // "auto": toggle based on current state
        if (!attendee.checked_in_at || attendee.last_direction === "out") {
          targetDirection = "in";
          action = "check_in";
        } else {
          targetDirection = "out";
          action = "check_out";
        }
      }

      // 2. Validate Check-out attempts
      if (targetDirection === "out") {
        if (!attendee.checked_in_at) {
          await client.query("COMMIT");
          res.setHeader("Cache-Control", "private, no-store");
          return sendJson(res, checkInResultSchema, {
            status: "invalid",
            message: `${attendee.name} has not checked in yet. Cannot record departure.`,
            attendee: {
              id: attendee.id,
              name: attendee.name,
              email: attendee.email,
              ticketType: attendee.ticket_type,
              checkedInAt: new Date().toISOString(),
            },
            direction: "out",
            action: "check_out",
            scanCount: currentScans,
            maxScans,
            currentlyInside: false,
          });
        }

        if (attendee.last_direction === "out") {
          await client.query("COMMIT");
          res.setHeader("Cache-Control", "private, no-store");
          return sendJson(res, checkInResultSchema, {
            status: "duplicate",
            message: `${attendee.name} is already checked out (currently outside).`,
            attendee: {
              id: attendee.id,
              name: attendee.name,
              email: attendee.email,
              ticketType: attendee.ticket_type,
              checkedInAt: attendee.checked_in_at.toISOString(),
            },
            direction: "out",
            action: "check_out",
            scanCount: currentScans,
            maxScans,
            currentlyInside: false,
          });
        }
      }

      // 3. Validate Check-in attempts
      if (targetDirection === "in") {
        // If attendee is already inside
        if (attendee.last_direction === "in" && (maxScans === 1 || scanMode === "checkin_only")) {
          await client.query("COMMIT");
          res.setHeader("Cache-Control", "private, no-store");
          return sendJson(res, checkInResultSchema, {
            status: "duplicate",
            message: `${attendee.name} is already checked in (currently inside).`,
            attendee: {
              id: attendee.id,
              name: attendee.name,
              email: attendee.email,
              ticketType: attendee.ticket_type,
              checkedInAt: attendee.checked_in_at ? attendee.checked_in_at.toISOString() : new Date().toISOString(),
            },
            direction: "in",
            action: "check_in",
            scanCount: currentScans,
            maxScans,
            currentlyInside: true,
          });
        }

        // Check if max scans reached for entering
        if (maxScans > 0 && currentScans >= maxScans) {
          await client.query("COMMIT");
          res.setHeader("Cache-Control", "private, no-store");
          const msg = maxScans === 1
            ? `${attendee.name} has already checked in.`
            : `Maximum scan limit reached for ${attendee.name} (${currentScans} of ${maxScans} scans used).`;
          return sendJson(res, checkInResultSchema, {
            status: "duplicate",
            message: msg,
            attendee: {
              id: attendee.id,
              name: attendee.name,
              email: attendee.email,
              ticketType: attendee.ticket_type,
              checkedInAt: attendee.checked_in_at ? attendee.checked_in_at.toISOString() : new Date().toISOString(),
            },
            direction: attendee.last_direction === "out" ? "out" : "in",
            action: attendee.last_direction === "out" ? "check_out" : "check_in",
            scanCount: currentScans,
            maxScans,
            currentlyInside: attendee.last_direction === "in",
          });
        }
      }

      const newScanCount = currentScans + 1;
      const scannedAt = new Date();

      if (targetDirection === "in") {
        await client.query(
          `UPDATE ${names.schema}.${names.attendees}
           SET checked_in_at = COALESCE(checked_in_at, now()),
               scan_count = $2,
               last_direction = 'in'
           WHERE id = $1`,
          [attendee.id, newScanCount],
        );
      } else {
        await client.query(
          `UPDATE ${names.schema}.${names.attendees}
           SET checked_out_at = now(),
               scan_count = $2,
               last_direction = 'out'
           WHERE id = $1`,
          [attendee.id, newScanCount],
        );
      }

      await client.query(
        `INSERT INTO ${names.schema}.${names.checkins}(attendee_id, scanner_label, direction, scanned_at)
         VALUES ($1, $2, $3, $4)`,
        [attendee.id, scanner?.label ?? "Organizer", targetDirection, scannedAt],
      );

      const notice = checkInNoticeSchema.parse({ eventId: event.id, attendeeId: attendee.id, occurredAt: scannedAt.toISOString() });
      await client.query("SELECT pg_notify($1,$2)", ["eventdesk_checkins", JSON.stringify(notice)]);
      await client.query("COMMIT");

      publishCheckIn(notice);

      let successMessage = "";
      if (targetDirection === "out") {
        successMessage = `Departure recorded: ${attendee.name} (Checked Out)`;
      } else {
        successMessage = maxScans > 1
          ? `Check-in recorded: ${attendee.name} (Scan ${newScanCount} of ${maxScans})`
          : `Check-in recorded: ${attendee.name} (Entrance)`;
      }

      const result = {
        status: "valid" as const,
        message: successMessage,
        attendee: {
          id: attendee.id,
          name: attendee.name,
          email: attendee.email,
          ticketType: attendee.ticket_type,
          checkedInAt: scannedAt.toISOString(),
        },
        direction: targetDirection,
        action,
        scanCount: newScanCount,
        maxScans: maxScans || undefined,
        currentlyInside: targetDirection === "in",
      };

      res.setHeader("Cache-Control", "private, no-store");
      return sendJson(res, checkInResultSchema, result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch (error) { next(error); }
});
export default router;
