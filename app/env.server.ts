/** Load .env into process.env (Node's built-in loader) for code outside Prisma, e.g. the job queue. */
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // No .env file: production sets real environment variables.
  }
}
export {};
