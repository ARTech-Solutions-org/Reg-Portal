import "dotenv/config";
import { pool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { repairTenantProvisioning } from "../db/provisioning.js";

try {
  await migrate();
  const result = await repairTenantProvisioning();
  console.log(`Tenant reconciliation complete: ${result.projects} project schemas and ${result.events} event table sets verified.`);
} catch (error) {
  console.error("Tenant reconciliation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
