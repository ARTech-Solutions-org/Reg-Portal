import { afterEach, describe, expect, it } from "vitest";
import { organizerSessionCookieOptions, SESSION_COOKIE, signSession, verifySession } from "./session.js";

const organizerId = "06ae1e46-78c5-4db4-b090-e36112ca7311";
const previousSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

describe("local organizer session", () => {
  it("uses an app-owned cookie instead of a platform session cookie", () => {
    expect(SESSION_COOKIE).toBe("eventdesk_session");
  });

  it("signs and verifies sessions using the local organizer ID", () => {
    process.env.SESSION_SECRET = "test-only-local-auth-master-secret-0123456789";
    const token = signSession({ organizerId });
    expect(verifySession(token)).toEqual({ organizerId });
    expect(verifySession(`${token}tampered`)).toBeNull();
  });

  it("uses secure, same-site-none, partitioned cookies behind HTTPS Preview", () => {
    expect(organizerSessionCookieOptions(false, "preview.example", "development")).toMatchObject({
      httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/",
    });
  });

  it("keeps local HTTP development usable without Secure or Partitioned flags", () => {
    expect(organizerSessionCookieOptions(false, undefined, "development")).toMatchObject({
      httpOnly: true, secure: false, sameSite: "lax", path: "/",
    });
    expect(organizerSessionCookieOptions(false, undefined, "development")).not.toHaveProperty("partitioned");
  });
});
