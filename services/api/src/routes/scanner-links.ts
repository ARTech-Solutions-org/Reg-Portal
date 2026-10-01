import { Router } from "express";
import { scannerLinkCopyResponseSchema, scannerLinkInputSchema, scannerLinkIssueResponseSchema, scannerLinkListSchema } from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { findEventForOrganizer } from "../db/tenant.js";
import { decryptScannerLinkToken, encryptScannerLinkToken, hashToken, newOpaqueToken } from "../lib/tokens.js";
import { sendJson } from "../lib/responses.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireOrganizer);
const organizerId = (req: AuthenticatedRequest) => req.userId!;

router.get("/:eventId/scanner-links", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query("SELECT id, label, token_ciphertext, expires_at, revoked_at, created_at FROM public.scanner_links WHERE event_id=$1 ORDER BY created_at DESC", [event.id]);
    return sendJson(res, scannerLinkListSchema, result.rows.map((row) => ({
      id: row.id,
      eventId: event.id,
      label: row.label,
      expiresAt: row.expires_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      canCopy: Boolean(row.token_ciphertext),
    })));
  } catch (error) { next(error); }
});

router.post("/:eventId/scanner-links", async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).json({ error: "Invalid event ID." }); return; }
  const parsed = scannerLinkInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a link label and expiry between 1 and 720 hours." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const rawToken = newOpaqueToken(32);
    const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000);
    const created = await pool.query<{ id: string }>(
      `INSERT INTO public.scanner_links(event_id,label,token_hash,token_ciphertext,expires_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [event.id, parsed.data.label, hashToken(rawToken), encryptScannerLinkToken(rawToken), expiresAt, organizerId(req)],
    );
    const url = `/scanner/${event.id}?token=${encodeURIComponent(rawToken)}`;
    return sendJson(res, scannerLinkIssueResponseSchema, { id: created.rows[0]!.id, eventId: event.id, label: parsed.data.label, url, expiresAt: expiresAt.toISOString() }, 201);
  } catch (error) { next(error); }
});

router.post("/:eventId/scanner-links/:linkId/copy", async (req, res, next) => {
  if (!requireUuid(req.params.eventId) || !requireUuid(req.params.linkId)) { res.status(400).json({ error: "Invalid scanner link ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query<{ token_ciphertext: string | null; expires_at: Date | null; revoked_at: Date | null }>(
      "SELECT token_ciphertext, expires_at, revoked_at FROM public.scanner_links WHERE id=$1 AND event_id=$2 LIMIT 1",
      [req.params.linkId, event.id],
    );
    const link = result.rows[0];
    if (!link) { res.status(404).json({ error: "Scanner link not found." }); return; }
    if (link.revoked_at || (link.expires_at && link.expires_at.getTime() <= Date.now())) {
      res.status(409).json({ error: "Only active, unexpired scanner links can be copied." });
      return;
    }
    if (!link.token_ciphertext) {
      res.status(409).json({ error: "This link was created before secure copy support; its original URL cannot be recovered. Create a new scanner link to get a copyable URL." });
      return;
    }

    let rawToken: string;
    try { rawToken = decryptScannerLinkToken(link.token_ciphertext); }
    catch {
      res.status(409).json({ error: "This link can no longer be recovered with the current encryption key. Create a new scanner link to get a copyable URL." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    return sendJson(res, scannerLinkCopyResponseSchema, { url: `/scanner/${event.id}?token=${encodeURIComponent(rawToken)}` });
  } catch (error) { next(error); }
});

router.delete("/:eventId/scanner-links/:linkId", async (req, res, next) => {
  if (!requireUuid(req.params.eventId) || !requireUuid(req.params.linkId)) { res.status(400).json({ error: "Invalid link ID." }); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, organizerId(req));
    if (!event) { res.status(404).json({ error: "Event not found." }); return; }
    const result = await pool.query("UPDATE public.scanner_links SET revoked_at=now() WHERE id=$1 AND event_id=$2 AND revoked_at IS NULL RETURNING id", [req.params.linkId, event.id]);
    if (!result.rowCount) { res.status(404).json({ error: "Active scanner link not found." }); return; }
    res.sendStatus(204);
  } catch (error) { next(error); }
});

export default router;
