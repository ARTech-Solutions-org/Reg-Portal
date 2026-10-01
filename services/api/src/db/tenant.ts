import type { MembershipRole } from "@eventdesk/contracts";
import { pool } from "./pool.js";
import { quoteIdentifier } from "./tenant-identifiers.js";

export interface ProjectRow { id: string; name: string; schema_name: string; created_at: Date; role: MembershipRole }
export interface EventRow {
  id: string; project_id: string; name: string; starts_at: Date | null; venue: string | null;
  schema_name: string; attendee_table_name: string; checkin_table_name: string; created_at: Date;
}

const SCHEMA_PATTERN = /^project_[a-f0-9]{32}$/;
const EVENT_TABLE_PATTERN = /^(attendees|checkins)_[a-f0-9]{32}$/;

export function tenantSqlNames(event: Pick<EventRow, "schema_name" | "attendee_table_name" | "checkin_table_name">) {
  if (!SCHEMA_PATTERN.test(event.schema_name) || !EVENT_TABLE_PATTERN.test(event.attendee_table_name) || !EVENT_TABLE_PATTERN.test(event.checkin_table_name)) {
    throw new Error("Tenant database mapping failed validation.");
  }
  return {
    schema: quoteIdentifier(event.schema_name),
    attendees: quoteIdentifier(event.attendee_table_name),
    checkins: quoteIdentifier(event.checkin_table_name),
  };
}

export async function findProjectForOrganizer(projectId: string, organizerId: string): Promise<ProjectRow | null> {
  const result = await pool.query<ProjectRow>(
    `SELECT p.id, p.name, p.schema_name, p.created_at, m.role
     FROM public.projects p
     JOIN public.project_memberships m ON m.project_id = p.id
     WHERE p.id = $1 AND m.organizer_id = $2`, [projectId, organizerId],
  );
  return result.rows[0] ?? null;
}

export async function findEventForOrganizer(eventId: string, organizerId: string): Promise<EventRow | null> {
  const result = await pool.query<EventRow>(
    `SELECT e.id, e.project_id, e.name, e.starts_at, e.venue, e.schema_name,
            e.attendee_table_name, e.checkin_table_name, e.created_at
     FROM public.events e
     JOIN public.project_memberships m ON m.project_id = e.project_id
     WHERE e.id = $1 AND m.organizer_id = $2`, [eventId, organizerId],
  );
  return result.rows[0] ?? null;
}

export async function findEventById(eventId: string): Promise<EventRow | null> {
  const result = await pool.query<EventRow>(
    `SELECT id, project_id, name, starts_at, venue, schema_name,
            attendee_table_name, checkin_table_name, created_at
     FROM public.events
     WHERE id = $1`, [eventId],
  );
  return result.rows[0] ?? null;
}

export function publicEvent(event: EventRow) {
  return {
    id: event.id, projectId: event.project_id, name: event.name,
    startsAt: event.starts_at?.toISOString() ?? null, venue: event.venue,
    createdAt: event.created_at.toISOString(),
  };
}
