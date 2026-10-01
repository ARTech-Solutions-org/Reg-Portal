import { apiErrorResponseSchema } from "@eventdesk/contracts";
import type { z } from "zod";

export class ScannerApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ScannerApiError"; }
}

export async function scannerApiContract<S extends z.ZodTypeAny>(path: string, token: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const headers = new Headers(init.headers);
  headers.set("X-Scanner-Token", token);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  const data: unknown = response.status === 204 ? undefined : await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(data);
    throw new ScannerApiError(error.success ? error.data.error : `Scanner request failed (${response.status}).`, response.status);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ScannerApiError("The server returned data that did not match its shared API contract.", 502);
  return parsed.data;
}
