export default function handler(req, res) {
  res.status(200).send("API is alive. Env NEON_DATABASE_URL=" + !!process.env.NEON_DATABASE_URL);
}
