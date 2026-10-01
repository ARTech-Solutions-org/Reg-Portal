import pg from "pg";
import fs from "fs";

const { Pool } = pg;
const connectionString = "postgresql://neondb_owner:npg_h2SUkp1zGNTJ@ep-dark-dew-b2r5khle-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require";

async function run() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    const schema = fs.readFileSync("src/db/schema.sql", "utf-8");
    console.log("Running schema...");
    await pool.query(schema);
    console.log("Schema created successfully!");
  } catch (error) {
    console.error("Error creating schema:", error);
  } finally {
    await pool.end();
  }
}

run();
