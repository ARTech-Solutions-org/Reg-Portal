import { pool } from "../db/pool.js";
import { tenantSqlNames, type EventRow } from "../db/tenant.js";
import type { DashboardSummary } from "@eventdesk/contracts";

export async function getDashboardSummary(event: EventRow): Promise<DashboardSummary> {
  const names = tenantSqlNames(event);
  const [totals, recent, hourly] = await Promise.all([
    pool.query<{ total: number; checked_in: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS checked_in FROM ${names.schema}.${names.attendees}`,
    ),
    pool.query<{ id: string; name: string; ticket_type: string; scanned_at: Date }>(
      `SELECT a.id, a.name, a.ticket_type, c.scanned_at
       FROM ${names.schema}.${names.checkins} c
       JOIN ${names.schema}.${names.attendees} a ON a.id=c.attendee_id
       ORDER BY c.scanned_at DESC LIMIT 8`,
    ),
    pool.query<{ hour: string; count: number }>(
      `SELECT to_char(h.hour, 'HH24:00') AS hour, count(c.scanned_at)::int AS count
       FROM generate_series(date_trunc('hour', now() - interval '11 hours'), date_trunc('hour', now()), interval '1 hour') AS h(hour)
       LEFT JOIN ${names.schema}.${names.checkins} c ON date_trunc('hour', c.scanned_at) = h.hour
       GROUP BY h.hour
       ORDER BY h.hour`,
    ),
  ]);
  const total = totals.rows[0]?.total ?? 0;
  const checkedIn = totals.rows[0]?.checked_in ?? 0;
  return {
    total, checkedIn, remaining: Math.max(total - checkedIn, 0), rate: total ? Math.round(checkedIn / total * 100) : 0,
    recentCheckIns: recent.rows.map((row) => ({ id: row.id, name: row.name, ticketType: row.ticket_type, checkedInAt: row.scanned_at.toISOString() })),
    hourly: hourly.rows,
  };
}
