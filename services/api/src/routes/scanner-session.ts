import { Router } from "express";
import { scannerSessionSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { hashToken } from "../lib/tokens.js";
import { requireUuid } from "../middleware/auth.js";
import { sendJson } from "../lib/responses.js";

const router = Router();
router.get("/:eventId/scanner-session", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const token = req.get("x-scanner-token");
  if (!token) { res.status(401).json({ error: "A scanner link is required." }); return; }
  try {
    const result = await pool.query<{ event_id: string; name: string; label: string; expires_at: Date | null }>(
      `SELECT e.id AS event_id, e.name, sl.label, sl.expires_at
       FROM public.scanner_links sl JOIN public.events e ON e.id=sl.event_id
       WHERE e.id=$1 AND sl.token_hash=$2 AND sl.revoked_at IS NULL AND (sl.expires_at IS NULL OR sl.expires_at > now()) LIMIT 1`,
      [req.params.eventId, hashToken(token)],
    );
    const session = result.rows[0];
    if (!session) { res.status(401).json({ error: "This scanner link is invalid, expired, or revoked." }); return; }
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, scannerSessionSchema, { eventId: session.event_id, eventName: session.name, label: session.label, expiresAt: session.expires_at?.toISOString() ?? null });
  } catch (error) { next(error); }
});
export default router;
