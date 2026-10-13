import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { Client } from "pg";
import { z } from "zod";

async function main() {
  const envFile = process.argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length);
  if (envFile) process.loadEnvFile(resolve(envFile));
  else loadEnvConfig(process.cwd());
  const { databaseConnectionString } = await import("../src/components/db/drizzle");
  const { getNextDigestRun } = await import("../src/components/db/sql/queries-weekly-activity-digest");
  const { processDigestRun } = await import("../src/features/weekly-activity-digest/service");
  const runIdArg = process.argv.find((arg) => arg.startsWith("--run-id="))?.slice("--run-id=".length);
  const runId = runIdArg === undefined ? undefined : z.uuid().parse(runIdArg);
  const client = new Client({ connectionString: databaseConnectionString });
  let healthy = true;
  let stopping = false;
  client.on("error", (error) => {
    healthy = false;
    console.error("[weekly-activity-digest.worker] Lock connection lost", error);
  });
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  await client.connect();
  try {
    // A session lock releases automatically on worker termination. Processing runs are resumed.
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(734210986) AS acquired");
    if (!lock.rows[0].acquired) throw new Error("Another weekly digest worker is already running.");
    console.log("[weekly-activity-digest.worker] Ready; polling persisted runs every 5 seconds.");
    do {
      const run = await getNextDigestRun({ runId, dryRunOnly: process.argv.includes("--dry-run-only") });
      if (run) {
        console.log("[weekly-activity-digest.worker] Processing", { runId: run.runId, dryRun: run.dryRun });
        await processDigestRun(run, () => healthy);
        console.log("[weekly-activity-digest.worker] Finished", { runId: run.runId });
      }
      if (process.argv.includes("--once")) break;
      if (!stopping && healthy) await new Promise((done) => setTimeout(done, 5000));
    } while (!stopping && healthy);
    if (!healthy) throw new Error("Digest worker stopped after losing its lock connection.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[weekly-activity-digest.worker] Fatal error", error);
  process.exitCode = 1;
});
