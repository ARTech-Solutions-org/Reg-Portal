import type { Response } from "express";
import type { z } from "zod";

export function sendJson<S extends z.ZodTypeAny>(res: Response, schema: S, payload: unknown, status = 200) {
  const validated = schema.parse(payload);
  return res.status(status).json(validated);
}
