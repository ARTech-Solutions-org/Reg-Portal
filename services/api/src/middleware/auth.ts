import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";
import { SESSION_COOKIE, verifySession } from "../lib/session.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  username?: string;
  userName?: string;
}

export async function requireOrganizer(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const claims = typeof token === "string" ? verifySession(token) : null;
  if (!claims) { res.status(401).json({ error: "Sign in to continue." }); return; }
  try {
    const result = await pool.query<{ id: string; username: string | null; display_name: string }>(
      "SELECT id, username, display_name FROM public.organizers WHERE id=$1 LIMIT 1", [claims.organizerId],
    );
    const organizer = result.rows[0];
    if (!organizer?.username) { res.status(401).json({ error: "This organizer account is no longer available." }); return; }
    req.userId = organizer.id;
    req.username = organizer.username;
    req.userName = organizer.display_name;
    next();
  } catch (error) { next(error); }
}

export function requireUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
