import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, connectMock } = vi.hoisted(() => ({ queryMock: vi.fn(), connectMock: vi.fn() }));
vi.mock("./db/pool.js", () => ({ pool: { query: queryMock, connect: connectMock } }));

import app from "./app.js";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { defaultScannerBranding } from "@eventdesk/contracts";
import { SESSION_COOKIE, signSession } from "./lib/session.js";
import { decryptScannerLinkToken, encryptScannerLinkToken, encryptToken, hashToken } from "./lib/tokens.js";

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


describe("attendee import and QR issuance", () => {
  it("saves only file data, then generates a QR that stays stable on retry", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test server did not bind a TCP port.");
    const base = `http://127.0.0.1:${address.port}/api/events/${eventId}/attendees`;
    const post = (route: string, body: unknown) => fetch(`${base}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: organizerCookie() },
      body: JSON.stringify(body),
    });
    const suffix = eventId.replaceAll("-", "");
    const event = { id: eventId, schema_name: `project_${suffix}`, attendee_table_name: `attendees_${suffix}`, checkin_table_name: `checkins_${suffix}` };
    const attendee = {
      id: "",
      name: null,
      email: null,
      ticket_type: null,
      custom_fields: { "القسم": "الدعم", Code: "0007" },
      checked_in_at: null,
      created_at: new Date("2026-09-30T11:00:00.000Z"),
      qr_token_ciphertext: null as string | null,
    };
    queryMock.mockImplementation(async (sql: string, params: [string[], ...unknown[]]) => {
      if (sql.includes("public.organizers")) return { rows: [{ id: organizerId, username: "owner" }] };
      if (sql.includes("public.project_memberships")) return { rows: [event] };
      expect(sql).toContain("(id, name, email, ticket_type, custom_fields)");
      expect(sql).not.toContain("qr_token");
      expect(params.slice(1)).toEqual([[null], [null], [null], [JSON.stringify(attendee.custom_fields)], eventId, ["القسم", "Code"]]);
      attendee.id = params[0][0]!;
      return { rows: [{ ...attendee, qr_issued: false }] };
    });
    const saved = await post("import", { attendees: [{ customFields: attendee.custom_fields }] });
    expect(saved.status).toBe(201);
    expect(await saved.json()).toEqual([{
      id: attendee.id, name: null, email: null, ticketType: null, customFields: attendee.custom_fields,
      checkedInAt: null, createdAt: attendee.created_at.toISOString(), qrIssued: false,
    }]);
    expect(connectMock).not.toHaveBeenCalled();

    const transaction = vi.fn(async (sql: string, params?: string[][]) => {
      if (sql.includes("FOR UPDATE")) return { rows: [{ ...attendee }] };
      if (sql.startsWith("UPDATE")) attendee.qr_token_ciphertext = params?.[2]?.[0] ?? null;
      return { rows: [] };
    });
    connectMock.mockResolvedValue({ query: transaction, release: vi.fn() });
    const issued = await post("issue-qr", { attendeeIds: [attendee.id] });
    expect(issued.status).toBe(200);
    const result = await issued.json();
    expect(result).toMatchObject({
      count: 1,
      attendees: [{ attendee: { id: attendee.id, qrIssued: true }, qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/) }],
    });
    expect(attendee.qr_token_ciphertext).toMatch(/^v1\./);

    const retried = await post("issue-qr", { attendeeIds: [attendee.id] });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(result);
    expect(transaction.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"))).toHaveLength(1);
  });
});



describe("clear attendee list", () => {
  it("deletes all attendees from the owner's event and rejects other organizers", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test server did not bind a TCP port.");
    const projectId = "513570a8-9554-48a9-be3c-293394b1f37a";
    const schemaName = `project_${projectId.replaceAll("-", "")}`;
    const tableName = `attendees_${eventId.replaceAll("-", "")}`;
    const event = {
      id: eventId,
      project_id: projectId,
      schema_name: schemaName,
      attendee_table_name: tableName,
      checkin_table_name: `checkins_${eventId.replaceAll("-", "")}`,
      membership_role: "viewer",
    };
    let member = true;
    const deleteQuery = vi.fn().mockResolvedValue({ rowCount: 4 });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("public.organizers")) return { rows: [{ id: organizerId, username: "owner" }] };
      if (sql.includes("public.project_memberships")) return { rows: member ? [event] : [] };
      if (sql.startsWith("DELETE")) return deleteQuery(sql);
      throw new Error("Unexpected query");
    });

    const clear = () => fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/attendees?q=filtered`, {
      method: "DELETE",
      headers: { Cookie: organizerCookie() },
    });
    expect((await clear()).status).toBe(403);
    member = false;
    expect((await clear()).status).toBe(404);
    expect(deleteQuery).not.toHaveBeenCalled();

    member = true;
    event.membership_role = "owner";
    const cleared = await clear();
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ deletedCount: 4 });
    expect(deleteQuery).toHaveBeenCalledOnce();
    expect(deleteQuery).toHaveBeenCalledWith(`DELETE FROM "${schemaName}"."${tableName}"`);
  });
});

describe("badge ZIP download", () => {
  it("downloads one PDF per attendee with selected fields and unique filenames", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test server did not bind a TCP port.");
    const suffix = eventId.replaceAll("-", "");
    const ids = ["2517ea53-bf71-408f-9a28-70f437de3b41", "2517ea53-bf71-408f-9a28-70f437de3b42", "2517ea53-bf71-408f-9a28-70f437de3b43"];
    const event = { id: eventId, name: "Test event", schema_name: `project_${suffix}`, attendee_table_name: `attendees_${suffix}`, checkin_table_name: `checkins_${suffix}` };
    const rows = ids.map((id, index) => ({
      id,
      name: "Avery Stone",
      email: null,
      ticket_type: null,
      custom_fields: { ID: index < 2 ? "0007" : "قسم/8" },
      qr_token_ciphertext: encryptToken(`example-test-qr-credential-${index}`),
    }));
    const layout = {
      pageIndex: 0,
      pageWidth: 612,
      pageHeight: 792,
      elements: [
        { id: "name", kind: "text", field: "name", x: 0.1, y: 0.1, width: 0.7, height: 0.1 },
        { id: "qr", kind: "qr", x: 0.1, y: 0.3, width: 0.3, height: 0.3 },
      ],
    };
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("public.organizers")) return { rows: [{ id: organizerId, username: "owner" }] };
      if (sql.includes("public.project_memberships")) return { rows: [event] };
      if (sql.includes("public.badge_layouts")) return { rows: [{ layout }] };
      if (sql.includes("public.badge_templates")) return { rows: [] };
      if (sql.includes("qr_token_ciphertext")) return { rows };
      throw new Error("Unexpected query");
    });
    const post = (filenameFields: string[]) => fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/badges/bulk.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: organizerCookie() },
      body: JSON.stringify({ attendeeIds: ids, filenameFields }),
    });

    const response = await post(["custom:ID", "name"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(response.headers.get("content-disposition")).toContain("eventdesk-badges.zip");
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["0007 - Avery Stone.pdf", "0007 - Avery Stone (2).pdf", "قسم-8 - Avery Stone.pdf"]);
    for (const pdf of Object.values(entries)) {
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    }
    expect(entries["0007 - Avery Stone.pdf"]).not.toEqual(entries["0007 - Avery Stone (2).pdf"]);

    const namesOnly = await post(["name"]);
    expect(Object.keys(unzipSync(new Uint8Array(await namesOnly.arrayBuffer())))).toEqual(["Avery Stone.pdf", "Avery Stone (2).pdf", "Avery Stone (3).pdf"]);

    const idsOnly = await post(["id"]);
    expect(Object.keys(unzipSync(new Uint8Array(await idsOnly.arrayBuffer())))).toEqual(ids.map((id) => `${id}.pdf`));

    rows[2]!.qr_token_ciphertext = "";
    const pending = await post(["id"]);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toEqual({ error: "Generate QR codes for all selected attendees before downloading badges." });
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
    const savedBranding = { ...defaultScannerBranding, brandName: "Northstar Summit", accentColor: "#7ab0ff", additionalLogoDataUrls: ["data:image/jpeg;base64,/9j/"] };
    const updatedAt = new Date("2026-09-30T09:00:00.000Z");
    queryMock.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ branding: savedBranding, updated_at: updatedAt }] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-branding`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ branding: savedBranding, updatedAt: updatedAt.toISOString() });
  });

  it("shows ARTECH for a saved legacy default theme and keeps the event colors", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The test API server did not bind a TCP port.");
    const branding = { ...defaultScannerBranding, brandName: "ALMIRA AUREA", brandTagline: "Gatepass / scanner", accentColor: "#7ab0ff" };
    const updatedAt = new Date("2026-09-30T09:00:00.000Z");
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: eventId }] })
      .mockResolvedValueOnce({ rows: [{ branding, updated_at: updatedAt }] });

    const response = await fetch(`http://127.0.0.1:${address.port}/api/events/${eventId}/scanner-branding`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ branding: { ...defaultScannerBranding, accentColor: "#7ab0ff" }, updatedAt: updatedAt.toISOString() });
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
    const branding = {
      ...defaultScannerBranding,
      brandName: "Northstar Summit",
      accentColor: "#7ab0ff",
      logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      additionalLogoDataUrls: ["data:image/jpeg;base64,/9j/"],
    };
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
    const [savedEventId, savedTheme, savedBy] = queryMock.mock.calls[2]![1];
    expect([savedEventId, JSON.parse(savedTheme), savedBy]).toEqual([eventId, branding, organizerId]);
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
