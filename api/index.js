// Vercel Serverless Function entrypoint
// Imports the compiled Express app from the API service build output

import app from "../services/api/dist/app.js";

export default app;
