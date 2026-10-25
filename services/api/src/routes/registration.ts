import { Router } from "express";
import QRCode from "qrcode";
import {
  defaultEventRegistrationSettings,
  eventRegistrationSettingsResponseSchema,
  eventRegistrationSettingsSchema,
  publicEventRegistrationInfoSchema,
  publicRegistrationInputSchema,
  publicRegistrationResultSchema,
  eventAdminBrandingSchema,
  type EventRegistrationSettings,
} from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer, tenantSqlNames, type EventRow } from "../db/tenant.js";
import { newOpaqueToken, hashToken, encryptToken } from "../lib/tokens.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
const qrOptions = { errorCorrectionLevel: "M" as const, margin: 1, width: 360, color: { dark: "#132035", light: "#FFFFFF" } };

interface RegistrationSettingsRow {
  is_open: boolean;
  show_qr_code: boolean;
  max_registrations_per_device: number | null;
  max_scans_per_attendee: number | null;
  scan_mode: "checkin_only" | "checkin_checkout" | null;
  title: string;
  description: string;
  success_message: string;
  fields: unknown;
  updated_at: Date | null;
}

async function fetchRegistrationSettings(eventId: string): Promise<{ settings: EventRegistrationSettings; updatedAt: string | null }> {
  const result = await pool.query<RegistrationSettingsRow>(
    `SELECT is_open, show_qr_code, max_registrations_per_device, max_scans_per_attendee, scan_mode,
            title, description, success_message, fields, updated_at
     FROM public.event_registration_settings WHERE event_id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      settings: defaultEventRegistrationSettings,
      updatedAt: null,
    };
  }
  const parsed = eventRegistrationSettingsSchema.parse({
    isOpen: row.is_open,
    showQrCode: row.show_qr_code,
    maxRegistrationsPerDevice: row.max_registrations_per_device ?? 1,
    maxScansPerAttendee: row.max_scans_per_attendee ?? 1,
    scanMode: row.scan_mode ?? "checkin_only",
    title: row.title ?? "",
    description: row.description ?? "",
    successMessage: row.success_message ?? defaultEventRegistrationSettings.successMessage,
    fields: row.fields ?? [],
  });
  return {
    settings: parsed,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

// ----------------------------------------------------
// Organizer Management Endpoints (Auth Required)
// ----------------------------------------------------

router.get("/:eventId/registration-settings", requireOrganizer, async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const organizerId = (req as AuthenticatedRequest).userId!;
    const event = await findEventForOrganizer(req.params.eventId, organizerId);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }

    const { settings, updatedAt } = await fetchRegistrationSettings(event.id);
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, eventRegistrationSettingsResponseSchema, { settings, updatedAt });
  } catch (error) { next(error); }
});

router.put("/:eventId/registration-settings", requireOrganizer, async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = eventRegistrationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid registration settings." });
    return;
  }
  try {
    const organizerId = (req as AuthenticatedRequest).userId!;
    const event = await findEventForOrganizer(req.params.eventId, organizerId);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }

    const data = parsed.data;
    const client = await pool.connect();
    let updatedAt: Date;
    try {
      await client.query("BEGIN");
      const result = await client.query<{ updated_at: Date }>(
        `INSERT INTO public.event_registration_settings(
           event_id, is_open, show_qr_code, max_registrations_per_device, max_scans_per_attendee, scan_mode,
           title, description, success_message, fields, updated_by, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, now())
         ON CONFLICT(event_id) DO UPDATE SET
           is_open = EXCLUDED.is_open,
           show_qr_code = EXCLUDED.show_qr_code,
           max_registrations_per_device = EXCLUDED.max_registrations_per_device,
           max_scans_per_attendee = EXCLUDED.max_scans_per_attendee,
           scan_mode = EXCLUDED.scan_mode,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           success_message = EXCLUDED.success_message,
           fields = EXCLUDED.fields,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING updated_at`,
        [
          event.id,
          data.isOpen,
          data.showQrCode,
          data.maxRegistrationsPerDevice,
          data.maxScansPerAttendee,
          data.scanMode,
          data.title,
          data.description,
          data.successMessage,
          JSON.stringify(data.fields),
          organizerId,
        ],
      );
      updatedAt = result.rows[0]!.updated_at;

      const fieldKeys = data.fields.map((field) => field.key);
      if (fieldKeys.length > 0) {
        await client.query(
          `INSERT INTO public.event_attendee_fields(event_id, field_key)
           SELECT $1, field.key FROM unnest($2::text[]) AS field(key) ON CONFLICT(event_id, field_key) DO NOTHING`,
          [event.id, fieldKeys],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }

    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, eventRegistrationSettingsResponseSchema, {
      settings: data,
      updatedAt: updatedAt.toISOString(),
    });
  } catch (error) { next(error); }
});

// ----------------------------------------------------
// Public Endpoints (No Auth Required)
// ----------------------------------------------------

router.get("/:eventId/public-registration", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const eventResult = await pool.query<{ id: string; name: string; starts_at: Date | null; venue: string | null }>(
      "SELECT id, name, starts_at, venue FROM public.events WHERE id = $1",
      [req.params.eventId],
    );
    const event = eventResult.rows[0];
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }

    const { settings } = await fetchRegistrationSettings(event.id);

    // Optional event branding
    const brandingResult = await pool.query<{ branding: unknown }>(
      "SELECT branding FROM public.event_admin_branding WHERE event_id = $1",
      [event.id],
    );
    let branding = undefined;
    if (brandingResult.rows[0]?.branding) {
      const parsedBranding = eventAdminBrandingSchema.safeParse(brandingResult.rows[0].branding);
      if (parsedBranding.success) branding = parsedBranding.data;
    }

    res.setHeader("Cache-Control", "public, max-age=15");
    return sendJson(res, publicEventRegistrationInfoSchema, {
      eventId: event.id,
      eventName: event.name,
      venue: event.venue,
      startsAt: event.starts_at ? event.starts_at.toISOString() : null,
      isOpen: settings.isOpen,
      maxRegistrationsPerDevice: settings.maxRegistrationsPerDevice,
      title: settings.title,
      description: settings.description,
      fields: settings.fields,
      branding,
    });
  } catch (error) { next(error); }
});

router.post("/:eventId/public-registration", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = publicRegistrationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Please check your registration details." });
    return;
  }
  try {
    const eventLookup = await pool.query<EventRow>(
      `SELECT id, project_id, name, starts_at, venue, schema_name, attendee_table_name, checkin_table_name, created_at
       FROM public.events WHERE id = $1`,
      [req.params.eventId],
    );
    const event = eventLookup.rows[0];
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }

    const { settings } = await fetchRegistrationSettings(event.id);
    if (!settings.isOpen) {
      res.status(403).json({ error: "Registration is currently closed for this event." });
      return;
    }

    // Device registration limit check
    const deviceId = parsed.data.deviceId || (typeof req.ip === "string" ? req.ip : "default_device");
    if (settings.maxRegistrationsPerDevice > 0) {
      const devCheck = await pool.query<{ count: number }>(
        "SELECT count FROM public.event_device_registrations WHERE event_id = $1 AND device_id = $2",
        [event.id, deviceId],
      );
      const currentDeviceCount = devCheck.rows[0]?.count ?? 0;
      if (currentDeviceCount >= settings.maxRegistrationsPerDevice) {
        res.status(403).json({
          error: `تم استنفاد الحد الأقصى للتسجيل من هذا الجهاز (${settings.maxRegistrationsPerDevice} ${settings.maxRegistrationsPerDevice === 1 ? "مرة واحدة فقط" : "مرات"}).`,
        });
        return;
      }
    }

    // Validate required custom fields
    for (const field of settings.fields) {
      if (field.required) {
        const val = parsed.data.customFields[field.key];
        if (!val || val.trim().length === 0) {
          res.status(400).json({ error: `حقل "${field.label}" مطلوب.` });
          return;
        }
      }
    }

    const { schema, attendees } = tenantSqlNames(event);
    const token = newOpaqueToken(24);
    const qrDataUrl = settings.showQrCode ? await QRCode.toDataURL(token, qrOptions) : null;

    const client = await pool.connect();
    let attendeeRow: { id: string; name: string; email: string | null; ticket_type: string };
    try {
      await client.query("BEGIN");
      const insertResult = await client.query<{ id: string; name: string; email: string | null; ticket_type: string }>(
        `INSERT INTO ${schema}.${attendees}(qr_token_hash, qr_token_ciphertext, name, email, ticket_type, custom_fields)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, name, email, ticket_type`,
        [
          hashToken(token),
          encryptToken(token),
          parsed.data.name,
          parsed.data.email || null,
          parsed.data.ticketType,
          JSON.stringify(parsed.data.customFields),
        ],
      );
      attendeeRow = insertResult.rows[0]!;

      // Track device registration count
      if (settings.maxRegistrationsPerDevice > 0) {
        await client.query(
          `INSERT INTO public.event_device_registrations(event_id, device_id, count)
           VALUES ($1, $2, 1)
           ON CONFLICT(event_id, device_id)
           DO UPDATE SET count = event_device_registrations.count + 1, updated_at = now()`,
          [event.id, deviceId],
        );
      }

      const customKeys = Object.keys(parsed.data.customFields);
      if (customKeys.length > 0) {
        await client.query(
          `INSERT INTO public.event_attendee_fields(event_id, field_key)
           SELECT $1, field.key FROM unnest($2::text[]) AS field(key) ON CONFLICT(event_id, field_key) DO NOTHING`,
          [event.id, customKeys],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }

    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, publicRegistrationResultSchema, {
      success: true,
      message: settings.successMessage.trim() || "تم تسجيل بياناتك بنجاح!",
      attendee: {
        id: attendeeRow.id,
        name: attendeeRow.name,
        email: attendeeRow.email,
        ticketType: attendeeRow.ticket_type,
      },
      showQrCode: settings.showQrCode,
      qrDataUrl,
    }, 201);
  } catch (error) { next(error); }
});

export default router;
