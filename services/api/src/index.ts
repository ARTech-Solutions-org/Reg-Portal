import "dotenv/config";
import app from "./app.js";
import pg from "pg";
import { pool, secureConnectionString } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { repairTenantProvisioning } from "./db/provisioning.js";
import { publishCheckIn } from "./realtime/hub.js";

const { Client } = pg;

const port = Number(process.env.PORT ?? 4100);

async function start() {
  await migrate();
  const tenantRepair = await repairTenantProvisioning();
  if (tenantRepair.events > 0) console.log(`Verified ${tenantRepair.events} event table sets for current tenant schema.`);
  let notificationClient: InstanceType<typeof Client> | null = null;
  if (process.env.NEON_DIRECT_DATABASE_URL) {
    try {
      notificationClient = new Client({ connectionString: secureConnectionString(process.env.NEON_DIRECT_DATABASE_URL), ssl: { rejectUnauthorized: true } });
      await notificationClient.connect();
      await notificationClient.query("LISTEN eventdesk_checkins");
      notificationClient.on("notification", (message) => {
        if (message.channel !== "eventdesk_checkins" || !message.payload) return;
        try {
          const payload = JSON.parse(message.payload) as { eventId?: unknown; attendeeId?: unknown; occurredAt?: unknown };
          if (typeof payload.eventId === "string" && typeof payload.attendeeId === "string" && typeof payload.occurredAt === "string") publishCheckIn({ eventId: payload.eventId, attendeeId: payload.attendeeId, occurredAt: payload.occurredAt });
        } catch { /* Ignore malformed notification payloads. */ }
      });
      notificationClient.on("error", (error) => console.warn("Neon notification listener disconnected:", error.message));
      console.log("Eventdesk PostgreSQL check-in notifications enabled.");
    } catch (error) {
      console.warn("Neon LISTEN/NOTIFY is unavailable; 5-second SSE refresh fallback remains active:", error instanceof Error ? error.message : "connection failed");
      if (notificationClient) await notificationClient.end().catch(() => undefined);
      notificationClient = null;
    }
  }
  const server = app.listen(port, "0.0.0.0", () => console.log(`Eventdesk API listening on ${port}`));
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; closing Eventdesk API.`);
    server.close(() => void Promise.all([pool.end(), notificationClient?.end()]).finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error: unknown) => {
  console.error("Eventdesk API startup failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
