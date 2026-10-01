import type { PoolClient } from "pg";
import { pool } from "./pool.js";
import { eventTableNames, projectSchemaName, quoteIdentifier } from "./tenant-identifiers.js";

interface ProjectMapping { id: string; schema_name: string }
interface EventMapping { id: string; schema_name: string; attendee_table_name: string; checkin_table_name: string }

export async function createProjectSchema(client: PoolClient, projectId: string): Promise<string> {
  const schema = projectSchemaName(projectId);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
  return schema;
}

export async function createEventTables(client: PoolClient, schema: string, eventId: string): Promise<{ attendees: string; checkins: string }> {
  // Only internally generated identifiers are accepted; user values remain query parameters.
  if (!/^project_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid project schema mapping.");
  const names = eventTableNames(eventId);
  const qSchema = quoteIdentifier(schema);
  const attendees = quoteIdentifier(names.attendees);
  const checkins = quoteIdentifier(names.checkins);
  await client.query(`CREATE TABLE IF NOT EXISTS ${qSchema}.${attendees} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_token_hash text NOT NULL UNIQUE,
    qr_token_ciphertext text NOT NULL,
    name text NOT NULL,
    email text,
    ticket_type text NOT NULL DEFAULT 'General',
    checked_in_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`ALTER TABLE ${qSchema}.${attendees} ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${names.attendees}_checked_idx`)} ON ${qSchema}.${attendees}(checked_in_at DESC)`);
  await client.query(`CREATE TABLE IF NOT EXISTS ${qSchema}.${checkins} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attendee_id uuid NOT NULL UNIQUE REFERENCES ${qSchema}.${attendees}(id) ON DELETE CASCADE,
    scanner_label text NOT NULL DEFAULT 'Organizer',
    scanned_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${names.checkins}_scanned_idx`)} ON ${qSchema}.${checkins}(scanned_at DESC)`);
  return names;
}

/** Recreate only missing tenant schemas/tables after verifying every saved mapping against generated UUID names. */
export async function repairTenantProvisioning(): Promise<{ projects: number; events: number }> {
  const projects = await pool.query<ProjectMapping>("SELECT id, schema_name FROM public.projects ORDER BY created_at");
  let repairedEvents = 0;
  for (const project of projects.rows) {
    const expectedSchema = projectSchemaName(project.id);
    if (project.schema_name !== expectedSchema) throw new Error(`Unsafe schema mapping for project ${project.id}.`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await createProjectSchema(client, project.id);
      const events = await client.query<EventMapping>(
        "SELECT id, schema_name, attendee_table_name, checkin_table_name FROM public.events WHERE project_id=$1 ORDER BY created_at",
        [project.id],
      );
      for (const event of events.rows) {
        const expectedTables = eventTableNames(event.id);
        if (event.schema_name !== expectedSchema || event.attendee_table_name !== expectedTables.attendees || event.checkin_table_name !== expectedTables.checkins) {
          throw new Error(`Unsafe event table mapping for event ${event.id}.`);
        }
        await createEventTables(client, expectedSchema, event.id);
        repairedEvents += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  return { projects: projects.rows.length, events: repairedEvents };
}
