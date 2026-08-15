import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Only `db:migrate` needs a live connection; `db:generate` just introspects schema.ts.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
});
