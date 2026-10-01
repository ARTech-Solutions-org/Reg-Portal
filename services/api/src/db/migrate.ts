import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

export async function migrate(): Promise<void> {
  const sql = await readFile(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventdesk:migrations:v1'))");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(async () => {
    console.log("Eventdesk registry migrations complete.");
    await pool.end();
  }).catch(async (error: unknown) => {
    console.error("Eventdesk registry migration failed:", error instanceof Error ? error.message : "unknown error");
    await pool.end();
    process.exitCode = 1;
  });
}
