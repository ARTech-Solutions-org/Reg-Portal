import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, connectMock } = vi.hoisted(() => ({ queryMock: vi.fn(), connectMock: vi.fn() }));
vi.mock("./db/pool.js", () => ({ pool: { query: queryMock, connect: connectMock } }));

import app from "./app.js";
import { defaultScannerBranding } from "@eventdesk/contracts";
import { SESSION_COOKIE, signSession } from "./lib/session.js";
import { decryptScannerLinkToken, encryptScannerLinkToken, hashToken } from "./lib/tokens.js";

const eventId = "06ae1e46-78c5-4db4-b090-e36112ca7311";
const organizerId = "9fbbd89a-0901-43cf-8b7d-a071b8320d48";
const sessionSecretBeforeTests = process.env.SESSION_SECRET;
const testSessionSecret = "test-only-eventdesk-scanner-branding-session-secret";
const organizerCookie = () => `${SESSION_COOKIE}=${signSession({ organizerId })}`;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  process.env.SESSION_SECRET = testSessionSecret;
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (sessionSecretBeforeTests === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = sessionSecretBeforeTests;
});

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  connectMock.mockReset();
});

describe("public scanner check-in route", () => {
  it("validates staff-token access before organizer-only event routers can intercept it", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/check-ins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Scanner-Token": "test-invalid-staff-token-with-sufficient-length",
      },
      body: JSON.stringify({ token: "test-invalid-attendee-qr-token-with-sufficient-length" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "This scanner link is invalid, expired, or no longer authorized." });
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0]?.[0]).toContain("public.scanner_links");
  });
});

describe("scanner branding route", () => {
  it("serves only the event's public branding without organizer login", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-branding`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ branding: defaultScannerBranding, updatedAt: null });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("returns a saved custom theme and update timestamp to the public staff scanner", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    const savedBranding = { ...defaultScannerBranding, brandName: "Northstar Summit", accentColor: "#7ab0ff" };
    const updatedAt = new Date("2026-09-30T09:00:00.000Z");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ branding: savedBranding, updated_at: updatedAt }] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-branding`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ branding: savedBranding, updatedAt: updatedAt.toISOString() });
  });

  it("requires organizer login before accepting an event branding write", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    queryMock.mockReset();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-branding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(defaultScannerBranding),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to continue." });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows an organizer to save branding only after matching event membership", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    const branding = { ...defaultScannerBranding, brandName: "Northstar Summit", accentColor: "#7ab0ff" };
    const updatedAt = new Date("2026-09-30T10:00:00.000Z");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: updatedAt }] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-branding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: organizerCookie() },
      body: JSON.stringify(branding),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ branding, updatedAt: updatedAt.toISOString() });
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(queryMock.mock.calls[1]?.[0]).toContain("JOIN public.project_memberships");
    expect(queryMock.mock.calls[1]?.[1]).toEqual([eventId, organizerId]);
    expect(queryMock.mock.calls[2]?.[0]).toContain("INSERT INTO public.scanner_branding");
    expect(queryMock.mock.calls[2]?.[1]).toEqual([eventId, JSON.stringify(branding), organizerId]);
  });

  it("does not write branding for an event without the organizer's membership", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    const foreignEventId = "2d63b1ca-19e1-4a2f-9587-5d574bc91234";
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${foreignEventId}/scanner-branding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: organizerCookie() },
      body: JSON.stringify(defaultScannerBranding),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Event not found." });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1]?.[1]).toEqual([foreignEventId, organizerId]);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO public.scanner_branding"))).toBe(false);
  });
});

describe("scanner-link URL recovery", () => {
  const linkId = "7ce2e42e-03d5-4edf-9c27-b7e5aeb17bbb";

  it("issues a link with a one-way hash and separately encrypted recovery token", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ id: linkId }] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: organizerCookie() },
      body: JSON.stringify({ label: "Front gate", expiresInHours: 72 }),
    });
    expect(response.status).toBe(201);
    const issued = await response.json() as { id: string; url: string };
    const token = new URL(issued.url, "https://eventdesk.test").searchParams.get("token");
    expect(token).toBeTruthy();
    const insert = queryMock.mock.calls[2]?.[1] as unknown[];
    expect(queryMock.mock.calls[2]?.[0]).toContain("token_hash,token_ciphertext");
    expect(insert[2]).toBe(hashToken(token!));
    expect(decryptScannerLinkToken(String(insert[3]))).toBe(token);
    expect(String(insert[3])).not.toContain(token!);
  });

  it("lists copyability without exposing ciphertext, then returns the same URL to an event organizer", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    const rawToken = "known-staff-bearer-token-for-copy-test";
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ id: linkId, label: "Front gate", token_ciphertext: encryptScannerLinkToken(rawToken), expires_at: expiresAt, revoked_at: null, created_at: new Date() }] });

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-links`, { headers: { Cookie: organizerCookie() } });
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as Array<Record<string, unknown>>;
    expect(listed[0]?.canCopy).toBe(true);
    expect(listed[0]).not.toHaveProperty("token_ciphertext");

    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ token_ciphertext: encryptScannerLinkToken(rawToken), expires_at: expiresAt, revoked_at: null }] });
    const copyResponse = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-links/${linkId}/copy`, {
      method: "POST",
      headers: { Cookie: organizerCookie() },
    });
    expect(copyResponse.status).toBe(200);
    expect(copyResponse.headers.get("cache-control")).toContain("no-store");
    const copied = await copyResponse.json() as { url: string };
    expect(new URL(copied.url, "https://eventdesk.test").searchParams.get("token")).toBe(rawToken);
    expect(queryMock.mock.calls[1]?.[1]).toEqual([eventId, organizerId]);
  });

  it("refuses to fabricate a URL for legacy hash-only links", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ token_ciphertext: null, expires_at: new Date(Date.now() + 60 * 60 * 1000), revoked_at: null }] });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-links/${linkId}/copy`, {
      method: "POST",
      headers: { Cookie: organizerCookie() },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This link was created before secure copy support; its original URL cannot be recovered. Create a new scanner link to get a copyable URL." });
  });

  it("does not retrieve a scanner token for an event outside organizer membership", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: organizerId, username: "owner", display_name: "Event Owner" }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-links/${linkId}/copy`, {
      method: "POST",
      headers: { Cookie: organizerCookie() },
    });
    expect(response.status).toBe(404);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
