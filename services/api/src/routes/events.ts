import { Router } from "express";
import { eventTableNames, projectSchemaName, quoteIdentifier } from "../db/tenant-identifiers.js";
import { eventSummarySchema, eventUpdateSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer, publicEvent } from "../db/tenant.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireOrganizer);

router.get("/:eventId", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    return sendJson(res, eventSummarySchema, publicEvent(event));
  } catch (error) { next(error); }
});

router.patch("/:eventId", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = eventUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a valid name, date, or venue." }); return; }
  const values = parsed.data;
  try {
    const result = await pool.query(
      `UPDATE public.events AS e
       SET name=COALESCE($3,e.name),
           starts_at=CASE WHEN $4::boolean THEN $5::timestamptz ELSE e.starts_at END,
           venue=CASE WHEN $6::boolean THEN $7::text ELSE e.venue END
       FROM public.project_memberships m
       WHERE e.id=$1 AND m.project_id=e.project_id AND m.organizer_id=$2 AND m.role='owner'
       RETURNING e.id, e.project_id, e.name, e.starts_at, e.venue, e.schema_name,
                 e.attendee_table_name, e.checkin_table_name, e.created_at`,
      [req.params.eventId, (req as AuthenticatedRequest).userId!, values.name ?? null,
       Object.hasOwn(values, "startsAt"), values.startsAt ?? null,
       Object.hasOwn(values, "venue"), values.venue ?? null],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Event not found or owner access required." }); return; }
    return sendJson(res, eventSummarySchema, publicEvent(result.rows[0]));
  } catch (error) { next(error); }
});

router.delete("/:eventId", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string; project_id: string; schema_name: string; project_schema_name: string;
      attendee_table_name: string; checkin_table_name: string;
    }>(
      `SELECT e.id, e.project_id, e.schema_name, p.schema_name AS project_schema_name,
              e.attendee_table_name, e.checkin_table_name
       FROM public.events e
       JOIN public.projects p ON p.id=e.project_id
       JOIN public.project_memberships m ON m.project_id=p.id
       WHERE e.id=$1 AND m.organizer_id=$2 AND m.role='owner'
       FOR UPDATE OF e,p`, [req.params.eventId, (req as AuthenticatedRequest).userId!],
    );
    const event = result.rows[0];
    if (!event) { await client.query("ROLLBACK"); res.status(404).json({ error: "Event not found or owner access required." }); return; }
    const schemaName = projectSchemaName(event.project_id);
    const tables = eventTableNames(event.id);
    if (event.schema_name !== schemaName || event.project_schema_name !== schemaName || event.attendee_table_name !== tables.attendees || event.checkin_table_name !== tables.checkins) {
      throw new Error("Unsafe event tenant table mapping.");
    }
    await client.query(
      `DROP TABLE IF EXISTS ${quoteIdentifier(schemaName)}.${quoteIdentifier(tables.checkins)}, ${quoteIdentifier(schemaName)}.${quoteIdentifier(tables.attendees)}`,
    );
    await client.query("DELETE FROM public.events WHERE id=$1", [event.id]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});

export default router;
