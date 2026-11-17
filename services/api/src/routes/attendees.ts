import { Router } from "express";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { attendeeFieldListSchema, attendeeImportSchema, attendeeInputSchema, attendeeListSchema, attendeeQrIssueSchema, bulkAttendeeInputSchema, bulkAttendeeResultSchema, clearAttendeesResultSchema, selectedAttendeesInputSchema, selectedAttendeesResultSchema, issuedAttendeeSchema, qrDataResponseSchema } from "@eventdesk/contracts";
import type { AttendeeInput } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { eventTableNames, projectSchemaName } from "../db/tenant-identifiers.js";
import { findEventForOrganizer, tenantSqlNames } from "../db/tenant.js";
import { newOpaqueToken, hashToken, encryptToken, decryptToken } from "../lib/tokens.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireOrganizer);
const organizerId = (req: AuthenticatedRequest) => req.userId!;
const qrOptions = { errorCorrectionLevel: "M" as const, margin: 1, width: 360, color: { dark: "#132035", light: "#FFFFFF" } };

interface AttendeeRow {
  id: string;
  name: string | null;
  email: string | null;
  ticket_type: string | null;
  qr_issued?: boolean;
  custom_fields: Record<string, string> | null;
  checked_in_at: Date | null;
  created_at: Date;
}

function publicAttendee(row: AttendeeRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ticketType: row.ticket_type,
    customFields: row.custom_fields ?? {},
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    ...(row.qr_issued === undefined ? {} : { qrIssued: row.qr_issued }),
  };
}

router.get("/:eventId/attendees", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const { schema, attendees } = tenantSqlNames(event);
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    const status = req.query.status === "checked-in" ? "checked-in" : req.query.status === "pending" ? "pending" : "all";
    const where = ["($1 = '' OR name ILIKE '%' || $1 || '%' OR coalesce(email, '') ILIKE '%' || $1 || '%' OR ticket_type ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM jsonb_each_text(custom_fields) AS field(key, value) WHERE field.value ILIKE '%' || $1 || '%'))"];
    if (status === "checked-in") where.push("checked_in_at IS NOT NULL");
    if (status === "pending") where.push("checked_in_at IS NULL");
    const result = await pool.query<AttendeeRow>(
      `SELECT id, name, email, ticket_type, custom_fields, checked_in_at, created_at,
              qr_token_ciphertext IS NOT NULL AS qr_issued FROM ${schema}.${attendees}
       WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 500`, [search],
    );
    return sendJson(res, attendeeListSchema, result.rows.map(publicAttendee));
  } catch (error) { next(error); }
});


router.delete("/:eventId/attendees", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    if (event.membership_role !== "owner") {
      res.status(403).json({ error: "Only the event owner can clear the attendee list." });
      return;
    }
    if (event.schema_name !== projectSchemaName(event.project_id) || event.attendee_table_name !== eventTableNames(event.id).attendees) {
      throw new Error("Unsafe attendee table mapping.");
    }

    const { schema, attendees } = tenantSqlNames(event);
    // The check-in table's foreign key removes check-ins alongside their attendees.
    const result = await pool.query(`DELETE FROM ${schema}.${attendees}`);
    return sendJson(res, clearAttendeesResultSchema, { deletedCount: result.rowCount ?? 0 });
  } catch (error) { next(error); }
});


router.post("/:eventId/attendees/selected", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = selectedAttendeesInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select between 1 and 500 attendees and a valid action." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    if (event.membership_role !== "owner") { res.status(403).json({ error: "Only the event owner can delete or reset attendees." }); return; }
    if (event.schema_name !== projectSchemaName(event.project_id) || event.attendee_table_name !== eventTableNames(event.id).attendees || event.checkin_table_name !== eventTableNames(event.id).checkins) {
      throw new Error("Unsafe attendee table mapping.");
    }
    const ids = [...new Set(parsed.data.attendeeIds.map((id) => id.toLowerCase()))];
    const { schema, attendees, checkins } = tenantSqlNames(event);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string }>(
        `SELECT id FROM ${schema}.${attendees} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids],
      );
      if (found.rows.length !== ids.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Some selected attendees could not be found. Refresh the list and try again." });
        return;
      }
      if (parsed.data.action === "delete") {
        await client.query(`DELETE FROM ${schema}.${attendees} WHERE id=ANY($1::uuid[])`, [ids]);
      } else {
        await client.query(`DELETE FROM ${schema}.${checkins} WHERE attendee_id=ANY($1::uuid[])`, [ids]);
        await client.query(
          `UPDATE ${schema}.${attendees} SET checked_in_at=NULL, checked_out_at=NULL, last_direction=NULL, scan_count=0 WHERE id=ANY($1::uuid[])`, [ids],
        );
      }
      await client.query("COMMIT");
      return sendJson(res, selectedAttendeesResultSchema, { affectedCount: ids.length });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch (error) { next(error); }
});

router.get("/:eventId/attendees/fields", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query<{ field_key: string }>("SELECT field_key FROM public.event_attendee_fields WHERE event_id=$1 ORDER BY field_key", [event.id]);
    return sendJson(res, attendeeFieldListSchema, result.rows.map((row) => row.field_key));
  } catch (error) { next(error); }
});

router.post("/:eventId/attendees", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = attendeeInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a name, optional valid email, ticket type, and supported custom fields." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const { schema, attendees } = tenantSqlNames(event);
    const token = newOpaqueToken(24);
    const qrDataUrl = await QRCode.toDataURL(token, qrOptions);
    const client = await pool.connect();
    let row: AttendeeRow;
    try {
      await client.query("BEGIN");
      const result = await client.query<AttendeeRow>(
        `INSERT INTO ${schema}.${attendees}(qr_token_hash, qr_token_ciphertext, name, email, ticket_type, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id, name, email, ticket_type, custom_fields, checked_in_at, created_at`,
        [hashToken(token), encryptToken(token), parsed.data.name, parsed.data.email || null, parsed.data.ticketType, JSON.stringify(parsed.data.customFields)],
      );
      await client.query(
        `INSERT INTO public.event_attendee_fields(event_id,field_key)
         SELECT $1, field.key FROM unnest($2::text[]) AS field(key) ON CONFLICT(event_id,field_key) DO NOTHING`,
        [event.id, Object.keys(parsed.data.customFields)],
      );
      await client.query("COMMIT");
      row = result.rows[0]!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, issuedAttendeeSchema, { attendee: publicAttendee(row), qrDataUrl }, 201);
  } catch (error) { next(error); }
});


router.post("/:eventId/attendees/import", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = attendeeImportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Import between 1 and 500 valid attendee rows." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const { schema, attendees } = tenantSqlNames(event);
    const input = parsed.data.attendees;
    const ids = input.map(() => randomUUID());
    const fieldKeys = [...new Set(input.flatMap((row) => Object.keys(row.customFields)))];
    const result = await pool.query<AttendeeRow>(
      `WITH inserted AS (
         INSERT INTO ${schema}.${attendees}(id, name, email, ticket_type, custom_fields)
         SELECT source.id, source.name, source.email, source.ticket_type, source.custom_fields::jsonb
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
           AS source(id, name, email, ticket_type, custom_fields)
         RETURNING id, name, email, ticket_type, custom_fields, checked_in_at, created_at
       ), fields AS (
         INSERT INTO public.event_attendee_fields(event_id,field_key)
         SELECT $6, field.key FROM unnest($7::text[]) AS field(key) ON CONFLICT(event_id,field_key) DO NOTHING
       )
       SELECT *, false AS qr_issued FROM inserted ORDER BY array_position($1::uuid[], id)`,
      [ids, input.map((row) => row.name ?? null), input.map((row) => row.email ?? null),
        input.map((row) => row.ticketType ?? null), input.map((row) => JSON.stringify(row.customFields)), event.id, fieldKeys],
    );
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, attendeeListSchema, result.rows.map(publicAttendee), 201);
  } catch (error) { next(error); }
});

router.post("/:eventId/attendees/issue-qr", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = attendeeQrIssueSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select between 1 and 500 attendees." }); return; }
  const ids = parsed.data.attendeeIds;
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const { schema, attendees } = tenantSqlNames(event);
    const client = await pool.connect();
    let rows: Array<AttendeeRow & { qr_token_ciphertext: string | null }>;
    try {
      await client.query("BEGIN");
      const result = await client.query<AttendeeRow & { qr_token_ciphertext: string | null }>(
        `SELECT id, name, email, ticket_type, custom_fields, checked_in_at, created_at, qr_token_ciphertext
         FROM ${schema}.${attendees} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids],
      );
      rows = result.rows;
      if (rows.length !== ids.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Some attendees could not be found in this event." });
        return;
      }

      const newCredentials = rows.filter((row) => !row.qr_token_ciphertext).map((row) => {
        const token = newOpaqueToken(24);
        const ciphertext = encryptToken(token);
        row.qr_token_ciphertext = ciphertext;
        return { id: row.id, hash: hashToken(token), ciphertext };
      });
      if (newCredentials.length) {
        await client.query(
          `UPDATE ${schema}.${attendees} AS attendee
           SET qr_token_hash=credential.hash, qr_token_ciphertext=credential.ciphertext
           FROM unnest($1::uuid[], $2::text[], $3::text[]) AS credential(id, hash, ciphertext)
           WHERE attendee.id=credential.id`,
          [newCredentials.map((row) => row.id), newCredentials.map((row) => row.hash), newCredentials.map((row) => row.ciphertext)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const issued = [];
    for (let start = 0; start < ids.length; start += 8) {
      const batch = await Promise.all(ids.slice(start, start + 8).map(async (id) => {
        const row = rowsById.get(id)!;
        const qrDataUrl = await QRCode.toDataURL(decryptToken(row.qr_token_ciphertext!), qrOptions);
        return { attendee: publicAttendee({ ...row, qr_issued: true }), qrDataUrl };
      }));
      issued.push(...batch);
    }
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, bulkAttendeeResultSchema, { count: issued.length, attendees: issued });
  } catch (error) { next(error); }
});

router.post("/:eventId/attendees/bulk", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = bulkAttendeeInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Import between 1 and 500 valid attendee rows." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const { schema, attendees } = tenantSqlNames(event);
    const prepared = parsed.data.attendees.map((attendee: AttendeeInput) => {
      const token = newOpaqueToken(24);
      return { id: randomUUID(), tokenHash: hashToken(token), ciphertext: encryptToken(token), token, attendee };
    });
    const qrDataUrls: string[] = [];
    for (let start = 0; start < prepared.length; start += 8) {
      const batch = await Promise.all(prepared.slice(start, start + 8).map((row) => QRCode.toDataURL(row.token, qrOptions)));
      qrDataUrls.push(...batch);
    }

    const client = await pool.connect();
    let rows: AttendeeRow[];
    try {
      await client.query("BEGIN");
      const result = await client.query<AttendeeRow>(
        `INSERT INTO ${schema}.${attendees}(id, qr_token_hash, qr_token_ciphertext, name, email, ticket_type, custom_fields)
         SELECT issued.id, issued.token_hash, issued.ciphertext, issued.name, issued.email, issued.ticket_type, issued.custom_fields::jsonb
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
           AS issued(id, token_hash, ciphertext, name, email, ticket_type, custom_fields)
         RETURNING id, name, email, ticket_type, custom_fields, checked_in_at, created_at`,
        [
          prepared.map((row) => row.id), prepared.map((row) => row.tokenHash), prepared.map((row) => row.ciphertext),
          prepared.map((row) => row.attendee.name), prepared.map((row) => row.attendee.email || null),
          prepared.map((row) => row.attendee.ticketType), prepared.map((row) => JSON.stringify(row.attendee.customFields)),
        ],
      );
      const fieldKeys = [...new Set(prepared.flatMap((row) => Object.keys(row.attendee.customFields)))];
      await client.query(
        `INSERT INTO public.event_attendee_fields(event_id,field_key)
         SELECT $1, field.key FROM unnest($2::text[]) AS field(key) ON CONFLICT(event_id,field_key) DO NOTHING`,
        [event.id, fieldKeys],
      );
      rows = result.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const issued = prepared.map((item, index) => {
      const row = rowsById.get(item.id);
      if (!row) throw new Error("Bulk attendee insert response did not match the issued rows.");
      return { attendee: publicAttendee(row), qrDataUrl: qrDataUrls[index]! };
    });
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, bulkAttendeeResultSchema, { count: issued.length, attendees: issued }, 201);
  } catch (error) { next(error); }
});

router.get("/:eventId/attendees/:attendeeId/qr", async (req, res, next) => {
  if (!requireUuid(req.params.eventId) || !requireUuid(req.params.attendeeId)) { res.status(400).json({ error: "Invalid attendee ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const { schema, attendees } = tenantSqlNames(event);
    const result = await pool.query<{ qr_token_ciphertext: string }>(
      `SELECT qr_token_ciphertext FROM ${schema}.${attendees} WHERE id=$1`, [req.params.attendeeId],
    );
    const encrypted = result.rows[0]?.qr_token_ciphertext;
    if (!encrypted) { res.status(404).json({ error: "Attendee QR not found." }); return; }
    const token = decryptToken(encrypted);
    const qrDataUrl = await QRCode.toDataURL(token, qrOptions);
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, qrDataResponseSchema, { qrDataUrl });
  } catch (error) { next(error); }
});

export default router;
