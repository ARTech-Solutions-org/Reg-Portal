import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("NEON_DATABASE_URL must be configured in the protected project environment.");
}

export function secureConnectionString(value: string): string {
  const parsed = new URL(value);
  // TLS is enforced below; remove URL sslmode values so they cannot override the
  // explicit certificate-verification policy or trigger driver's legacy aliases.
  parsed.searchParams.delete("sslmode");
  return parsed.toString();
}

export const pool = new Pool({
  connectionString: secureConnectionString(connectionString),
  ssl: { rejectUnauthorized: true },
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});

pool.on("error", (error) => {
  // Intentionally avoid logging connection details or credential-bearing URLs.
  console.error("Unexpected idle Neon database connection error:", error.message);
});
