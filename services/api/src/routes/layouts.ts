import { Router } from "express";
import { badgeLayoutGetResponseSchema, badgeLayoutPutResponseSchema, badgeLayoutSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer } from "../db/tenant.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";
import { sendJson } from "../lib/responses.js";

const router = Router();
router.use(requireOrganizer);
router.get("/:eventId/badge-layout", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query<{ layout: unknown; updated_at: Date }>("SELECT layout, updated_at FROM public.badge_layouts WHERE event_id=$1", [event.id]);
    return sendJson(res, badgeLayoutGetResponseSchema, result.rows[0] ? { layout: result.rows[0].layout, updatedAt: result.rows[0].updated_at.toISOString() } : { layout: null, updatedAt: null });
  } catch (error) { next(error); }
});
router.put("/:eventId/badge-layout", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = badgeLayoutSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Badge layout is invalid or exceeds supported limits." }); return; }
  try {
    const organizerId = (req as AuthenticatedRequest).userId!;
    const event = await findEventForOrganizer(req.params.eventId, organizerId);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query<{ updated_at: Date }>(
      `INSERT INTO public.badge_layouts(event_id,layout,updated_by) VALUES ($1,$2,$3)
       ON CONFLICT(event_id) DO UPDATE SET layout=EXCLUDED.layout,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING updated_at`, [event.id, JSON.stringify(parsed.data), organizerId],
    );
    return sendJson(res, badgeLayoutPutResponseSchema, { layout: parsed.data, updatedAt: result.rows[0]!.updated_at.toISOString() });
  } catch (error) { next(error); }
});
export default router;
