/**
 * Applies pending Drizzle migrations as part of a production deploy.
 *
 * The app's queries name every column in schema.ts, so a deploy that ships a
 * schema change before the migration runs takes the site down until someone
 * notices. Running the migration inside the build makes the two ship together:
 * if it fails, the build fails and the broken code never goes live.
 *
 * Deliberately narrow about when it runs:
 *   - Vercel production builds only. Preview and development builds share the
 *     same DATABASE_URL, and a preview branch must never migrate production.
 *   - Local `npm run build` skips it, so building locally cannot touch the
 *     real database by accident.
 *   - Set MIGRATE_ON_BUILD=1 to force it anywhere (CI, a manual run).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const forced = process.env.MIGRATE_ON_BUILD === "1";
const isVercelProduction = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

if (!forced && !isVercelProduction) {
  const where = process.env.VERCEL === "1" ? `Vercel ${process.env.VERCEL_ENV} build` : "local build";
  console.log(`[migrate] skipped — ${where}. Set MIGRATE_ON_BUILD=1 to force.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set. Refusing to build without it.");
  process.exit(1);
}

console.log("[migrate] applying pending migrations…");
const drizzleKit = join(projectRoot, "node_modules", ".bin", "drizzle-kit");
const result = spawnSync(drizzleKit, ["migrate"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`[migrate] could not run drizzle-kit: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[migrate] migration failed (exit ${result.status}). Aborting the build.`);
  process.exit(result.status ?? 1);
}
console.log("[migrate] done.");
