import express, { Router, type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { apiErrorResponseSchema, badgeTemplateGetResponseSchema, badgeTemplatePutResponseSchema, badgeTemplateUploadMetadataSchema } from "@eventdesk/contracts";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { findEventForOrganizer } from "../db/tenant.js";
import { sendJson } from "../lib/responses.js";
import { downloadManagedObject, ManagedStorageError, uploadManagedObject } from "../lib/managed-storage.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireOrganizer);

type AuthorizedEvent = NonNullable<Awaited<ReturnType<typeof findEventForOrganizer>>>;
interface BadgeTemplateRow {
  storage_key: string;
  file_name: string;
  page_count: number;
  page_width: number;
  page_height: number;
  updated_at: Date;
}

const requireOwnedEvent: RequestHandler = async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) return sendJson(res, apiErrorResponseSchema, { error: "Invalid event ID." }, 400);
  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) return sendJson(res, apiErrorResponseSchema, { error: "Event not found." }, 404);
    res.locals.event = event;
    return next();
  } catch (error) {
    return next(error);
  }
};

function publicTemplate(row: BadgeTemplateRow) {
  return {
    assetPath: `/manus-storage/${row.storage_key}`,
    fileName: row.file_name,
    pageCount: row.page_count,
    pageWidth: row.page_width,
    pageHeight: row.page_height,
    updatedAt: row.updated_at.toISOString(),
  };
}

router.get("/:eventId/badge-template", requireOwnedEvent, async (_req, res, next) => {
  try {
    const event = res.locals.event as AuthorizedEvent;
    const result = await pool.query<BadgeTemplateRow>(
      "SELECT storage_key, file_name, page_count, page_width, page_height, updated_at FROM public.badge_templates WHERE event_id=$1",
      [event.id],
    );
    return sendJson(res, badgeTemplateGetResponseSchema, { template: result.rows[0] ? publicTemplate(result.rows[0]) : null });
  } catch (error) {
    return next(error);
  }
});

router.get("/:eventId/badge-template/file", requireOwnedEvent, async (_req, res, next) => {
  try {
    const event = res.locals.event as AuthorizedEvent;
    const result = await pool.query<{ storage_key: string; file_name: string }>(
      "SELECT storage_key, file_name FROM public.badge_templates WHERE event_id=$1",
      [event.id],
    );
    const template = result.rows[0];
    if (!template) return sendJson(res, apiErrorResponseSchema, { error: "No saved PDF template exists for this event." }, 404);

    const bytes = await downloadManagedObject(template.storage_key);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    if (error instanceof ManagedStorageError) return sendJson(res, apiErrorResponseSchema, { error: error.message }, error.status);
    return next(error);
  }
});

router.put(
  "/:eventId/badge-template",
  requireOwnedEvent,
  express.raw({ type: "application/pdf", limit: "20mb" }),
  async (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 5 || req.body.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return sendJson(res, apiErrorResponseSchema, { error: "Choose a valid PDF file under 20 MB." }, 400);
    }

    let decodedFileName: string;
    try {
      decodedFileName = decodeURIComponent(req.get("x-file-name") ?? "badge-template.pdf");
    } catch {
      return sendJson(res, apiErrorResponseSchema, { error: "The PDF filename is invalid." }, 400);
    }
    const fileName = decodedFileName.replace(/[\\/\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "badge-template.pdf";
    const metadata = badgeTemplateUploadMetadataSchema.safeParse({
      fileName,
      pageCount: Number(req.get("x-pdf-page-count")),
      pageWidth: Number(req.get("x-pdf-page-width")),
      pageHeight: Number(req.get("x-pdf-page-height")),
    });
    if (!metadata.success) return sendJson(res, apiErrorResponseSchema, { error: "The PDF page metadata is invalid or outside supported limits." }, 400);

    const event = res.locals.event as AuthorizedEvent;
    const storageKey = `eventdesk/events/${event.id}/badge-template/${randomUUID()}.pdf`;
    try {
      await uploadManagedObject(storageKey, req.body, "application/pdf");
    } catch (error) {
      if (error instanceof ManagedStorageError) return sendJson(res, apiErrorResponseSchema, { error: error.message }, error.status);
      return next(error);
    }

    try {
      const organizerId = (req as AuthenticatedRequest).userId!;
      const result = await pool.query<{ updated_at: Date }>(
        `INSERT INTO public.badge_templates(event_id,storage_key,file_name,page_count,page_width,page_height,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(event_id) DO UPDATE SET storage_key=EXCLUDED.storage_key,file_name=EXCLUDED.file_name,
           page_count=EXCLUDED.page_count,page_width=EXCLUDED.page_width,page_height=EXCLUDED.page_height,
           updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING updated_at`,
        [event.id, storageKey, metadata.data.fileName, metadata.data.pageCount, metadata.data.pageWidth, metadata.data.pageHeight, organizerId],
      );
      const template = {
        assetPath: `/manus-storage/${storageKey}`,
        ...metadata.data,
        updatedAt: result.rows[0]!.updated_at.toISOString(),
      };
      return sendJson(res, badgeTemplatePutResponseSchema, { template }, 200);
    } catch (error) {
      return next(error);
    }
  },
);

const uploadBodyErrors: ErrorRequestHandler = (error, _req, res, next) => {
  const details = error as { status?: number; type?: string };
  if (details?.type === "entity.too.large" || details?.status === 413) {
    return sendJson(res, apiErrorResponseSchema, { error: "PDF templates must be 20 MB or smaller." }, 413);
  }
  if (details?.type === "entity.parse.failed" || details?.status === 400) {
    return sendJson(res, apiErrorResponseSchema, { error: "The PDF request body could not be read." }, 400);
  }
  return next(error);
};
router.use(uploadBodyErrors);

export default router;
