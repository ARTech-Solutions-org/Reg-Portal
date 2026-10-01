import { Router } from "express";
import { eventDashboardSchema } from "@eventdesk/contracts";
import { findEventForOrganizer, publicEvent, findEventById } from "../db/tenant.js";
import { getDashboardSummary } from "../services/dashboard.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";
import { sendJson } from "../lib/responses.js";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { defaultEventAdminBranding, eventAdminBrandingSchema } from "@eventdesk/contracts";

const router = Router();

router.get("/public/share", async (req, res, next) => {
  try {
    const token = req.query.token as string;
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }
    let payload;
    try {
      payload = jwt.verify(token, process.env.SESSION_SECRET!) as { eventId: string, purpose: string };
    } catch {
      res.status(401).json({ error: "Invalid token" }); return;
    }
    if (payload.purpose !== "dashboard_share") {
      res.status(401).json({ error: "Invalid token purpose" }); return;
    }
    const event = await findEventById(payload.eventId);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query("SELECT branding FROM public.event_admin_branding WHERE event_id=$1", [event.id]);
    const branding = result.rows[0] ? eventAdminBrandingSchema.parse(result.rows[0].branding) : defaultEventAdminBranding;
    return sendJson(res, eventDashboardSchema, { event: publicEvent(event), summary: await getDashboardSummary(event), branding });
  } catch (error) { next(error); }
});

router.use(requireOrganizer);

router.post("/:eventId/share-link", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const token = jwt.sign({ eventId: event.id, purpose: "dashboard_share" }, process.env.SESSION_SECRET!);
    res.json({ token });
  } catch (error) { next(error); }
});

router.get("/:eventId/dashboard", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query("SELECT branding FROM public.event_admin_branding WHERE event_id=$1", [event.id]);
    const branding = result.rows[0] ? eventAdminBrandingSchema.parse(result.rows[0].branding) : defaultEventAdminBranding;
    return sendJson(res, eventDashboardSchema, { event: publicEvent(event), summary: await getDashboardSummary(event), branding });
  } catch (error) { next(error); }
});

export default router;
