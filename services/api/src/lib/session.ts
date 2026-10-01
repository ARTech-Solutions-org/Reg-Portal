import { hkdfSync } from "node:crypto";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "eventdesk_session";
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 12;

export interface SessionClaims { organizerId: string }

function sessionSecret(): Buffer {
  const master = process.env.SESSION_SECRET;
  if (!master || master.length < 32) throw new Error("A strong SESSION_SECRET is required for organizer sessions.");
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(master, "utf8"),
    Buffer.from("eventdesk:key-derivation:v1", "utf8"),
    Buffer.from("eventdesk:organizer-session:v1", "utf8"),
    32,
  ));
}

export function signSession(user: SessionClaims): string {
  return jwt.sign({ sub: user.organizerId }, sessionSecret(), {
    algorithm: "HS256",
    expiresIn: "12h",
    issuer: "eventdesk",
    audience: "eventdesk-api",
  });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, sessionSecret(), {
      algorithms: ["HS256"],
      issuer: "eventdesk",
      audience: "eventdesk-api",
    });
    if (typeof decoded === "string" || typeof decoded.sub !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.sub)) return null;
    return { organizerId: decoded.sub };
  } catch {
    return null;
  }
}

export function organizerSessionCookieOptions(secureConnection: boolean, forwardedHost?: string, environment = process.env.NODE_ENV) {
  const secure = secureConnection || environment === "production" || Boolean(forwardedHost?.trim());
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" as const : "lax" as const,
    ...(secure ? { partitioned: true } : {}),
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

function cookieOptions(req: Request) {
  return organizerSessionCookieOptions(req.secure, req.get("x-forwarded-host"));
}

export function setSessionCookie(req: Request, res: Response, user: SessionClaims): void {
  res.cookie(SESSION_COOKIE, signSession(user), cookieOptions(req));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const { maxAge: _maxAge, ...options } = cookieOptions(req);
  res.clearCookie(SESSION_COOKIE, options);
}
