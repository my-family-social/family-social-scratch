import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const SECRET_CACHE_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const ssm = new SSMClient({});
let cachedSecret;

/**
 * Queues the weekly activity digest for the previous Monday-Sunday UTC week.
 *
 * Event fields (all optional):
 *   scheduledTime  ISO time supplied by EventBridge Scheduler; retries reuse it, so they target the same week.
 *   weekStartUtc   Monday 00:00:00Z override for manual backfills.
 *   dryRun         Queue a dry run instead of a live send.
 */
export async function handler(event = {}) {
  const config = readConfig();
  const dryRun = event.dryRun === true;
  const weekStart = event.weekStartUtc ? parseMonday(event.weekStartUtc) : previousWeekStart(event.scheduledTime);
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1);
  // Deterministic per week, so duplicate invocations hit the run table's unique constraint (409) instead of re-sending.
  const idempotencyKey = `eventbridge-weekly-${weekStart.toISOString().slice(0, 10)}${dryRun ? "-dryrun" : ""}`;

  const body = { weekStartUtc: weekStart.toISOString(), weekEndUtc: weekEnd.toISOString(), dryRun };
  const response = await fetch(config.endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-fs-internal-secret": await getSecret(config.secretParameterName),
      "x-fs-request-ts": new Date().toISOString(),
      "x-fs-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  const summary = { status: response.status, idempotencyKey, ...body, runId: payload?.runId };

  if (response.status === 202) {
    console.log("[digest-kickoff] Run queued", summary);
    return { outcome: "queued", ...summary };
  }
  if (response.status === 409) {
    console.log("[digest-kickoff] Run already queued for this week", summary);
    return { outcome: "already-queued", ...summary };
  }
  if (response.status === 401) cachedSecret = undefined;
  console.error("[digest-kickoff] Kickoff failed", { ...summary, code: payload?.code, issues: payload?.issues });
  throw new Error(`Digest kickoff failed with HTTP ${response.status} (${payload?.code ?? "no code"}).`);
}

export function previousWeekStart(scheduledTime) {
  const reference = scheduledTime ? new Date(scheduledTime) : new Date();
  if (Number.isNaN(reference.getTime())) throw new Error(`Invalid scheduledTime: ${scheduledTime}`);
  const daysSinceMonday = (reference.getUTCDay() + 6) % 7;
  const currentMonday = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate() - daysSinceMonday);
  return new Date(currentMonday - WEEK_MS);
}

function parseMonday(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCDay() !== 1 || date.getTime() % DAY_MS !== 0) {
    throw new Error(`weekStartUtc must be a Monday at 00:00:00Z: ${value}`);
  }
  return date;
}

function readConfig() {
  const baseUrl = process.env.APP_BASE_URL;
  const secretParameterName = process.env.INTERNAL_SECRET_PARAMETER_NAME;
  if (!baseUrl || !secretParameterName) {
    throw new Error("APP_BASE_URL and INTERNAL_SECRET_PARAMETER_NAME must be configured.");
  }
  return {
    endpointUrl: new URL("/api/internal/weekly-activity-digest/run", baseUrl).toString(),
    secretParameterName,
  };
}

async function getSecret(name) {
  if (cachedSecret && cachedSecret.expiresAt > Date.now()) return cachedSecret.value;
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty.`);
  cachedSecret = { value, expiresAt: Date.now() + SECRET_CACHE_MS };
  return value;
}
