import { apiErrorResponseSchema } from "@eventdesk/contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const response = await fetch(`/api${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined;
  const raw = await response.text();
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(data);
    throw new ApiError(parsed.success ? parsed.data.error : `Request failed (${response.status})`, response.status, data);
  }
  return data;
}

export async function apiNoContent(path: string, init: RequestInit = {}): Promise<void> {
  const response = await api(path, init);
  if (response !== undefined) throw new ApiError("The server returned a body where the API contract requires no content.", 502, response);
}

export async function apiContract<S extends z.ZodTypeAny>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const response = await api(path, init);
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new ApiError("The server returned data that did not match its shared API contract.", 502, parsed.error.issues);
  return parsed.data;
}
