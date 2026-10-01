import { Router } from "express";
import { findEventForOrganizer } from "../db/tenant.js";
import { subscribeToEvent } from "../realtime/hub.js";
import { requireOrganizer, requireUuid, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();
router.get("/:eventId/stream", requireOrganizer, async (req, res, next) => {
  if (!requireUuid(req.params.eventId)) { res.status(400).end(); return; }
  try {
    const event = await findEventForOrganizer(req.params.eventId, (req as AuthenticatedRequest).userId!);
    if (!event) { res.status(404).end(); return; }
    res.status(200);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "private, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ eventId: event.id })}\n\n`);
    const unsubscribe = subscribeToEvent(event.id, (notice) => res.write(`event: checkin\ndata: ${JSON.stringify(notice)}\n\n`));
    // A refresh notice prompts each instance's browser clients to refetch the durable Neon snapshot.
    // It also keeps streams behind a load balancer alive when the write happened on another instance.
    const refresh = setInterval(() => res.write(`event: refresh\ndata: ${Date.now()}\n\n`), 5_000);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => { clearInterval(refresh); clearInterval(heartbeat); unsubscribe(); });
  } catch (error) { next(error); }
});
export default router;
