import express, { type ErrorRequestHandler } from "express";
import { apiErrorResponseSchema, healthResponseSchema } from "@eventdesk/contracts";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { extname, resolve } from "node:path";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import eventsRouter from "./routes/events.js";
import attendeesRouter from "./routes/attendees.js";
import checkinsRouter from "./routes/checkins.js";
import dashboardRouter from "./routes/dashboard.js";
import scannerLinksRouter from "./routes/scanner-links.js";
import layoutsRouter from "./routes/layouts.js";
import badgeTemplatesRouter from "./routes/badge-templates.js";
import badgesRouter from "./routes/badges.js";
import streamRouter from "./routes/stream.js";
import scannerSessionRouter from "./routes/scanner-session.js";
import scannerBrandingRouter from "./routes/scanner-branding.js";
import eventAdminBrandingRouter from "./routes/event-admin-branding.js";
import { pool } from "./db/pool.js";
import { sendJson } from "./lib/responses.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
// Preview is embedded cross-site, so omit X-Frame-Options/frame-ancestors rather than
// blocking the host iframe. All app APIs remain same-origin and session protected.
app.use(helmet({ frameguard: false, contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: "no-referrer" } }));
const developmentOrigins = "http://localhost:3000,http://localhost:3001";
const allowedOrigins = new Set((process.env.CORS_ORIGINS ?? (process.env.NODE_ENV === "production" ? "" : developmentOrigins)).split(",").map((origin) => origin.trim()).filter(Boolean));
app.use(cors({ credentials: true, origin(origin, callback) {
  if (!origin || allowedOrigins.has(origin) || (process.env.NODE_ENV !== "production")) callback(null, true);
  else if (process.env.APP_ORIGIN && origin === process.env.APP_ORIGIN) callback(null, true);
  else callback(null, false);
} }));
app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());
app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });


app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); return sendJson(res, healthResponseSchema, { ok: true, service: "eventdesk-api", database: "connected" }); }
  catch { return sendJson(res, healthResponseSchema, { ok: false, service: "eventdesk-api", database: "unavailable" }, 503); }
});
app.use("/api/auth", authRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/events", eventAdminBrandingRouter);
app.use("/api/events", scannerSessionRouter);
app.use("/api/events", scannerBrandingRouter);
// These staff-token routes must run before the organizer-only event/attendee routers below.
app.use("/api/events", checkinsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/events", attendeesRouter);
app.use("/api/events", dashboardRouter);
app.use("/api/events", scannerLinksRouter);
app.use("/api/events", layoutsRouter);
app.use("/api/events", badgeTemplatesRouter);
app.use("/api/events", badgesRouter);
app.use("/api/events", streamRouter);

app.use((_req, res) => sendJson(res, apiErrorResponseSchema, { error: "API route not found." }, 404));
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("API request failed:", error instanceof Error ? error.message : "unknown error");
  if (res.headersSent) return;
  return sendJson(res, apiErrorResponseSchema, { error: "The request could not be completed." }, 500);
};
app.use(errorHandler);

export default app;
