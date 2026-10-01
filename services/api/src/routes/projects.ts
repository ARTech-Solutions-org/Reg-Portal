import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eventInputSchema, eventListSchema, eventSummarySchema, projectInputSchema, projectListSchema, projectSchema, projectUpdateSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { createEventTables, createProjectSchema } from "../db/provisioning.js";
import { projectSchemaName, quoteIdentifier } from "../db/tenant-identifiers.js";
import { findProjectForOrganizer, publicEvent } from "../db/tenant.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireOrganizer);
const userId = (req: AuthenticatedRequest) => req.userId!;

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query<{ id: string; name: string; created_at: Date; event_count: string; role: "owner" | "manager" | "viewer" }>(
      `SELECT p.id, p.name, p.created_at, m.role, count(DISTINCT e.id)::text AS event_count
       FROM public.projects p
       JOIN public.project_memberships m ON m.project_id = p.id
       LEFT JOIN public.events e ON e.project_id = p.id
       WHERE m.organizer_id = $1 GROUP BY p.id, m.role ORDER BY p.created_at DESC`, [userId(req)],
    );
    return sendJson(res, projectListSchema, result.rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at.toISOString(), eventCount: Number(row.event_count), role: row.role })));
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  const parsed = projectInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Project names must contain 2–120 characters." }); return; }
  const projectId = randomUUID();
  const schemaName = projectSchemaName(projectId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string; name: string; created_at: Date }>(
      "INSERT INTO public.projects(id, name, schema_name, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, created_at",
      [projectId, parsed.data.name, schemaName, userId(req)],
    );
    await createProjectSchema(client, projectId);
    await client.query("INSERT INTO public.project_memberships(project_id, organizer_id, role) VALUES ($1, $2, 'owner')", [projectId, userId(req)]);
    await client.query("COMMIT");
    const row = created.rows[0]!;
    return sendJson(res, projectSchema, { id: row.id, name: row.name, createdAt: row.created_at.toISOString(), eventCount: 0, role: "owner" }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});

router.get("/:projectId", async (req, res, next) => {
  if (!requireUuid(req.params.projectId)) { res.status(400).json({ error: "Invalid project ID." }); return; }
  try {
    const project = await findProjectForOrganizer(req.params.projectId, userId(req));
    if (!project) { res.status(404).json({ error: "Project not found." }); return; }
    return sendJson(res, projectSchema, { id: project.id, name: project.name, createdAt: project.created_at.toISOString(), role: project.role });
  } catch (error) { next(error); }
});

router.patch("/:projectId", async (req, res, next) => {
  if (!requireUuid(req.params.projectId)) { res.status(400).json({ error: "Invalid project ID." }); return; }
  const parsed = projectUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a valid project name." }); return; }
  try {
    const result = await pool.query<{ id: string; name: string; created_at: Date }>(
      `UPDATE public.projects p SET name=$3
       FROM public.project_memberships m
       WHERE p.id=$1 AND m.project_id=p.id AND m.organizer_id=$2 AND m.role='owner'
       RETURNING p.id, p.name, p.created_at`, [req.params.projectId, userId(req), parsed.data.name],
    );
    const project = result.rows[0];
    if (!project) { res.status(404).json({ error: "Project not found or owner access required." }); return; }
    return sendJson(res, projectSchema, { id: project.id, name: project.name, createdAt: project.created_at.toISOString(), role: "owner" });
  } catch (error) { next(error); }
});

router.delete("/:projectId", async (req, res, next) => {
  if (!requireUuid(req.params.projectId)) { res.status(400).json({ error: "Invalid project ID." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; schema_name: string }>(
      `SELECT p.id, p.schema_name FROM public.projects p
       JOIN public.project_memberships m ON m.project_id=p.id
       WHERE p.id=$1 AND m.organizer_id=$2 AND m.role='owner' FOR UPDATE OF p`,
      [req.params.projectId, userId(req)],
    );
    const project = result.rows[0];
    if (!project) { await client.query("ROLLBACK"); res.status(404).json({ error: "Project not found or owner access required." }); return; }
    const expectedSchema = projectSchemaName(project.id);
    if (project.schema_name !== expectedSchema) throw new Error("Unsafe project schema mapping.");
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(expectedSchema)} CASCADE`);
    await client.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});

router.get("/:projectId/events", async (req, res, next) => {
  if (!requireUuid(req.params.projectId)) { res.status(400).json({ error: "Invalid project ID." }); return; }
  try {
    const project = await findProjectForOrganizer(req.params.projectId, userId(req));
    if (!project) { res.status(404).json({ error: "Project not found." }); return; }
    const result = await pool.query(
      "SELECT id, project_id, name, starts_at, venue, schema_name, attendee_table_name, checkin_table_name, created_at FROM public.events WHERE project_id = $1 ORDER BY starts_at NULLS LAST, created_at DESC",
      [project.id],
    );
    return sendJson(res, eventListSchema, result.rows.map(publicEvent));
  } catch (error) { next(error); }
});

router.post("/:projectId/events", async (req, res, next) => {
  if (!requireUuid(req.params.projectId)) { res.status(400).json({ error: "Invalid project ID." }); return; }
  const parsed = eventInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide an event name and valid date/venue." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const allowed = await client.query<{ schema_name: string }>(
      `SELECT p.schema_name FROM public.projects p
       JOIN public.project_memberships m ON m.project_id=p.id
       WHERE p.id=$1 AND m.organizer_id=$2 FOR SHARE OF p`, [req.params.projectId, userId(req)],
    );
    const schemaName = allowed.rows[0]?.schema_name;
    if (!schemaName) { await client.query("ROLLBACK"); res.status(404).json({ error: "Project not found." }); return; }
    const eventId = randomUUID();
    const names = await createEventTables(client, schemaName, eventId);
    const created = await client.query(
      `INSERT INTO public.events(id, project_id, name, starts_at, venue, schema_name, attendee_table_name, checkin_table_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, project_id, name, starts_at, venue, schema_name, attendee_table_name, checkin_table_name, created_at`,
      [eventId, req.params.projectId, parsed.data.name, parsed.data.startsAt ?? null, parsed.data.venue?.trim() || null, schemaName, names.attendees, names.checkins],
    );
    await client.query("COMMIT");
    return sendJson(res, eventSummarySchema, publicEvent(created.rows[0]!), 201);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});

export default router;
