import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { createEventTables, createProjectSchema } from "../db/provisioning.js";
import { eventTableNames, projectSchemaName, quoteIdentifier } from "../db/tenant-identifiers.js";
import { decryptScannerLinkToken, decryptToken, encryptScannerLinkToken, encryptToken, hashToken, newOpaqueToken } from "../lib/tokens.js";
import { defaultScannerBranding } from "@eventdesk/contracts";

async function main(): Promise<void> {
  await migrate();
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const projectId = randomUUID();
    const eventId = randomUUID();
    const organizerId = randomUUID();
    const schema = projectSchemaName(projectId);
    await client.query(
      "INSERT INTO public.organizers(id, open_id, email, display_name) VALUES ($1,$2,$3,$4)",
      [organizerId, `smoke:${organizerId}`, `${organizerId}@invalid.example`, "Eventdesk Neon Smoke"],
    );
    await client.query(
      "INSERT INTO public.projects(id, name, schema_name, created_by) VALUES ($1,$2,$3,$4)",
      [projectId, "Transactional smoke test", schema, organizerId],
    );
    await client.query(
      "INSERT INTO public.project_memberships(project_id, organizer_id, role) VALUES ($1,$2,'owner')",
      [projectId, organizerId],
    );
    await createProjectSchema(client, projectId);
    const expectedNames = eventTableNames(eventId);
    const qSchema = quoteIdentifier(schema);
    await client.query(`CREATE TABLE ${qSchema}.${quoteIdentifier(expectedNames.attendees)} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      qr_token_hash text NOT NULL UNIQUE,
      qr_token_ciphertext text NOT NULL,
      name text NOT NULL,
      email text,
      ticket_type text NOT NULL DEFAULT 'General',
      checked_in_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const names = await createEventTables(client, schema, eventId);
    await client.query(
      `INSERT INTO public.events(id, project_id, name, schema_name, attendee_table_name, checkin_table_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [eventId, projectId, "Smoke test event", schema, names.attendees, names.checkins],
    );
    const scannerToken = newOpaqueToken();
    const scannerCiphertext = encryptScannerLinkToken(scannerToken);
    const scannerLinkId = randomUUID();
    await client.query(
      "INSERT INTO public.scanner_links(id,event_id,label,token_hash,token_ciphertext,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,now()+interval '1 hour',$6)",
      [scannerLinkId, eventId, "Smoke gate", hashToken(scannerToken), scannerCiphertext, organizerId],
    );
    const savedScannerLink = await client.query<{ token_hash: string; token_ciphertext: string }>(
      "SELECT token_hash,token_ciphertext FROM public.scanner_links WHERE id=$1 AND event_id=$2",
      [scannerLinkId, eventId],
    );
    if (savedScannerLink.rows[0]?.token_hash !== hashToken(scannerToken) || decryptScannerLinkToken(savedScannerLink.rows[0].token_ciphertext) !== scannerToken) {
      throw new Error("Neon scanner-link hash or encrypted-copy persistence verification failed.");
    }
    const templateKey = `eventdesk/events/${eventId}/badge-template/${randomUUID()}.pdf`;
    await client.query(
      `INSERT INTO public.badge_templates(event_id,storage_key,file_name,page_count,page_width,page_height,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [eventId, templateKey, "smoke-template.pdf", 1, 612, 792, organizerId],
    );
    const template = await client.query<{ storage_key: string }>("SELECT storage_key FROM public.badge_templates WHERE event_id=$1", [eventId]);
    if (template.rows[0]?.storage_key !== templateKey) throw new Error("Neon badge-template metadata verification failed.");
    const branding = { ...defaultScannerBranding, brandName: "Smoke Event Brand", accentColor: "#1377c8" };
    await client.query(
      "INSERT INTO public.scanner_branding(event_id,branding,updated_by) VALUES ($1,$2::jsonb,$3)",
      [eventId, JSON.stringify(branding), organizerId],
    );
    const savedBranding = await client.query<{ branding: typeof branding }>("SELECT branding FROM public.scanner_branding WHERE event_id=$1", [eventId]);
    if (savedBranding.rows[0]?.branding?.brandName !== branding.brandName || savedBranding.rows[0]?.branding?.accentColor !== branding.accentColor) {
      throw new Error("Neon scanner-branding persistence verification failed.");
    }

    const attendeeId = randomUUID();
    const token = newOpaqueToken(24);
    const qAttendees = quoteIdentifier(names.attendees);
    const qCheckins = quoteIdentifier(names.checkins);
    await client.query(
      `INSERT INTO ${qSchema}.${qAttendees}(id, qr_token_hash, qr_token_ciphertext, name, custom_fields)
       VALUES ($1,$2,$3,$4,$5::jsonb)`, [attendeeId, hashToken(token), encryptToken(token), "Smoke Guest", JSON.stringify({ Company: "Northstar" })],
    );
    await client.query(
      `INSERT INTO public.event_attendee_fields(event_id,field_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [eventId, "Company"],
    );
    const saved = await client.query<{ qr_token_hash: string; qr_token_ciphertext: string; custom_fields: Record<string, string> }>(
      `SELECT qr_token_hash, qr_token_ciphertext, custom_fields FROM ${qSchema}.${qAttendees} WHERE id=$1`, [attendeeId],
    );
    if (saved.rows[0]?.qr_token_hash !== hashToken(token) || decryptToken(saved.rows[0].qr_token_ciphertext) !== token || saved.rows[0]?.custom_fields?.Company !== "Northstar") {
      throw new Error("Neon attendee custom-field or QR credential persistence verification failed.");
    }
    const registeredFields = await client.query<{ field_key: string }>("SELECT field_key FROM public.event_attendee_fields WHERE event_id=$1 ORDER BY field_key", [eventId]);
    if (registeredFields.rows.map((row) => row.field_key).join(",") !== "Company") throw new Error("Neon attendee-field catalog verification failed.");

    await client.query(`INSERT INTO ${qSchema}.${qCheckins}(attendee_id) VALUES ($1)`, [attendeeId]);
    await client.query("SAVEPOINT duplicate_checkin_probe");
    let duplicateRejected = false;
    try { await client.query(`INSERT INTO ${qSchema}.${qCheckins}(attendee_id) VALUES ($1)`, [attendeeId]); }
    catch { duplicateRejected = true; await client.query("ROLLBACK TO SAVEPOINT duplicate_checkin_probe"); }
    if (!duplicateRejected) throw new Error("Neon duplicate check-in constraint verification failed.");

    await client.query("ROLLBACK");
    inTransaction = false;
    console.log("Neon smoke passed: scanner branding and encrypted-copy scanner-link persistence, public template/field registries, legacy tenant custom_fields upgrade, JSONB attendee persistence, encrypted QR storage, and duplicate check-in constraint; synthetic rows were rolled back.");
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

try {
  await main();
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unavailable";
  console.error(`Neon smoke failed (database error code: ${code}). Check protected Neon configuration and CREATE SCHEMA/TABLE privileges; no in-memory database was used.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
