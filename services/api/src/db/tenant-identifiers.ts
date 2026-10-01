const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function normalizedUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error("Invalid generated UUID for tenant identifier.");
  return value.replaceAll("-", "").toLowerCase();
}

export function projectSchemaName(projectId: string): string {
  return `project_${normalizedUuid(projectId)}`;
}

export function eventTableNames(eventId: string): { attendees: string; checkins: string } {
  const suffix = normalizedUuid(eventId);
  return { attendees: `attendees_${suffix}`, checkins: `checkins_${suffix}` };
}

export function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error("Unsafe PostgreSQL identifier.");
  return `"${value}"`;
}
