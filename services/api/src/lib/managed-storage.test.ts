import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedStorageError, downloadManagedObject, uploadManagedObject } from "./managed-storage.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("managed durable object storage", () => {
  it("obtains a presigned URL and sends only the PDF bytes to the object store", async () => {
    vi.stubEnv("MANUS_API_URL", "https://platform.example");
    vi.stubEnv("MANUS_API_KEY", "server-only-test-credential");
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      const response = calls.length === 1
        ? new Response(JSON.stringify({ url: "https://objects.example/upload?signed=temporary" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 200 });
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
    await uploadManagedObject("eventdesk/events/abc/badge-template/test.pdf", bytes, "application/pdf");

    expect(calls).toHaveLength(2);
    const presign = new URL(calls[0]!.input);
    expect(presign.pathname).toBe("/v1/storage/presign/put");
    expect(presign.searchParams.get("path")).toBe("eventdesk/events/abc/badge-template/test.pdf");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer server-only-test-credential");
    expect(calls[1]!.init?.method).toBe("PUT");
    expect(calls[1]!.init?.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(Array.from(calls[1]!.init?.body as Uint8Array)).toEqual(Array.from(bytes));
  });

  it("downloads through a signed GET URL without forwarding the server credential", async () => {
    vi.stubEnv("MANUS_API_URL", "https://platform.example");
    vi.stubEnv("MANUS_API_KEY", "server-only-test-credential");
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\nvalid test bytes");
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      const response = calls.length === 1
        ? new Response(JSON.stringify({ url: "https://objects.example/download?signed=temporary" }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(pdfBytes, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Length": String(pdfBytes.length) } });
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadManagedObject("eventdesk/events/abc/badge-template/test.pdf");

    expect(calls).toHaveLength(2);
    const presign = new URL(calls[0]!.input);
    expect(presign.pathname).toBe("/v1/storage/presign/get");
    expect(presign.searchParams.get("path")).toBe("eventdesk/events/abc/badge-template/test.pdf");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer server-only-test-credential");
    expect(calls[1]!.init?.headers).toEqual({ Accept: "application/pdf" });
    expect(calls[1]!.init?.redirect).toBe("error");
    expect(Array.from(result)).toEqual(Array.from(pdfBytes));
  });

  it("fails closed when platform storage credentials are missing or a path is not ASCII", async () => {
    vi.stubEnv("MANUS_API_URL", "");
    vi.stubEnv("MANUS_API_KEY", "");
    await expect(uploadManagedObject("eventdesk/test.pdf", new Uint8Array([1]), "application/pdf"))
      .rejects.toMatchObject({ name: "ManagedStorageError", status: 503 });

    vi.stubEnv("MANUS_API_URL", "https://platform.example");
    vi.stubEnv("MANUS_API_KEY", "test");
    await expect(uploadManagedObject("eventdesk/é.pdf", new Uint8Array([1]), "application/pdf"))
      .rejects.toMatchObject({ name: "ManagedStorageError", status: 400 });
  });
});
