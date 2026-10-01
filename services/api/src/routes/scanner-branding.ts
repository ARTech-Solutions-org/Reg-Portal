import { Router } from "express";
import { defaultScannerBranding, scannerBrandingGetResponseSchema, scannerBrandingPutResponseSchema, scannerBrandingSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer } from "../db/tenant.js";
import { isValidScannerLogoDataUrl } from "../lib/scanner-branding.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

router.get("/:eventId/scanner-branding", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await pool.query<{ id: string }>("SELECT id FROM public.events WHERE id=$1", [req.params.eventId]);
    if (!event.rows[0]) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query<{ branding: unknown; updated_at: Date }>(
      "SELECT branding, updated_at FROM public.scanner_branding WHERE event_id=$1", [req.params.eventId],
    );
    const saved = result.rows[0];
    const branding = saved ? scannerBrandingSchema.parse(saved.branding) : defaultScannerBranding;
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, scannerBrandingGetResponseSchema, {
      branding,
      updatedAt: saved?.updated_at.toISOString() ?? null,
    });
  } catch (error) { next(error); }
});

router.put("/:eventId/scanner-branding", requireOrganizer, async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = scannerBrandingSchema.safeParse(req.body);
  if (!parsed.success || !isValidScannerLogoDataUrl(parsed.data?.logoDataUrl ?? null)) {
    res.status(400).json({ error: "Scanner branding is invalid. Use accessible color contrast and a PNG, JPEG or WebP logo under 256 KB." });
    return;
  }
  try {
    const organizerId = (req as AuthenticatedRequest).userId!;
    const event = await findEventForOrganizer(req.params.eventId, organizerId);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query<{ updated_at: Date }>(
      `INSERT INTO public.scanner_branding(event_id,branding,updated_by)
       VALUES ($1,$2::jsonb,$3)
       ON CONFLICT(event_id) DO UPDATE SET branding=EXCLUDED.branding,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING updated_at`, [event.id, JSON.stringify(parsed.data), organizerId],
    );
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, scannerBrandingPutResponseSchema, { branding: parsed.data, updatedAt: result.rows[0]!.updated_at.toISOString() });
  } catch (error) { next(error); }
});

export default router;
