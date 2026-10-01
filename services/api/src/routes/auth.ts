import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { PoolClient } from "pg";
import rateLimit from "express-rate-limit";
import {
  apiErrorResponseSchema,
  localLoginSchema,
  localSetupSchema,
  setupStatusSchema,
  userSchema,
} from "@eventdesk/contracts";
import { pool } from "../db/pool.js";
import { requireOrganizer, type AuthenticatedRequest } from "../middleware/auth.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { clearSessionCookie, setSessionCookie } from "../lib/session.js";
import { sendJson } from "../lib/responses.js";

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => sendJson(res, apiErrorResponseSchema, { error: "Too many sign-in attempts. Try again in a few minutes." }, 429) });
const setupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => sendJson(res, apiErrorResponseSchema, { error: "Too many setup attempts. Try again in a few minutes." }, 429) });

router.get("/setup-status", async (_req, res, next) => {
  try {
    const result = await pool.query<{ organizers: number; local_accounts: number }>(
      `SELECT count(*)::int AS organizers,
              count(*) FILTER (WHERE username IS NOT NULL AND password_hash IS NOT NULL)::int AS local_accounts
       FROM public.organizers`,
    );
    const { organizers = 0, local_accounts: localAccounts = 0 } = result.rows[0] ?? {};
    return sendJson(res, setupStatusSchema, {
      setupRequired: localAccounts === 0 && organizers <= 1,
      setupBlocked: localAccounts === 0 && organizers > 1,
    });
  } catch (error) { next(error); }
});

router.post("/setup", setupLimiter, async (req, res, next) => {
  const parsed = localSetupSchema.safeParse(req.body);
  if (!parsed.success) return sendJson(res, apiErrorResponseSchema, { error: "Choose a username and a password of at least 12 characters." }, 400);

  let passwordHash: string;
  try { passwordHash = await hashPassword(parsed.data.password); }
  catch (error) { next(error); return; }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventdesk:first-organizer:v1'))");
    const existing = await client.query<{ organizers: number; local_accounts: number }>(
      `SELECT count(*)::int AS organizers,
              count(*) FILTER (WHERE username IS NOT NULL AND password_hash IS NOT NULL)::int AS local_accounts
       FROM public.organizers`,
    );
    const { organizers = 0, local_accounts: localAccounts = 0 } = existing.rows[0] ?? {};
    if (localAccounts > 0 || organizers > 1) {
      await client.query("ROLLBACK");
      return sendJson(res, apiErrorResponseSchema, { error: "Initial setup is already complete. Sign in with your username." }, 409);
    }

    const username = parsed.data.username;
    const result = organizers === 1
      ? await client.query<{ id: string; username: string; display_name: string }>(
        `UPDATE public.organizers SET open_id=NULL, username=$1, display_name=$1, password_hash=$2
         WHERE id=(SELECT id FROM public.organizers ORDER BY created_at, id LIMIT 1)
         RETURNING id, username, display_name`, [username, passwordHash],
      )
      : await client.query<{ id: string; username: string; display_name: string }>(
        `INSERT INTO public.organizers(id, open_id, email, username, display_name, password_hash)
         VALUES ($1, NULL, NULL, $2, $2, $3) RETURNING id, username, display_name`,
        [randomUUID(), username, passwordHash],
      );
    await client.query("COMMIT");
    const organizer = result.rows[0];
    if (!organizer) throw new Error("The initial organizer account was not returned after insertion.");
    setSessionCookie(req, res, { organizerId: organizer.id });
    return sendJson(res, userSchema, { id: organizer.id, username: organizer.username, displayName: organizer.display_name });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally { client?.release(); }
});

router.post("/login", loginLimiter, async (req, res, next) => {
  const parsed = localLoginSchema.safeParse(req.body);
  if (!parsed.success) return sendJson(res, apiErrorResponseSchema, { error: "Enter a valid username and password." }, 400);
  try {
    const result = await pool.query<{ id: string; username: string | null; display_name: string; password_hash: string | null }>(
      "SELECT id, username, display_name, password_hash FROM public.organizers WHERE username=$1 LIMIT 1",
      [parsed.data.username],
    );
    const organizer = result.rows[0];
    const passwordMatches = organizer?.password_hash
      ? await verifyPassword(parsed.data.password, organizer.password_hash)
      : (await hashPassword(parsed.data.password), false);
    if (!organizer?.username || !passwordMatches) {
      return sendJson(res, apiErrorResponseSchema, { error: "Incorrect username or password." }, 401);
    }
    setSessionCookie(req, res, { organizerId: organizer.id });
    return sendJson(res, userSchema, { id: organizer.id, username: organizer.username, displayName: organizer.display_name });
  } catch (error) { next(error); }
});

router.post("/logout", (req, res) => { clearSessionCookie(req, res); res.sendStatus(204); });
router.get("/me", requireOrganizer, (req, res) => {
  const user = req as AuthenticatedRequest;
  res.setHeader("Cache-Control", "private, no-store");
  return sendJson(res, userSchema, { id: user.userId, username: user.username, displayName: user.userName });
});

export default router;
