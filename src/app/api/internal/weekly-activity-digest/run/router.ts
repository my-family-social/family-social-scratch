import { authenticateInternalRequest } from "../../auth";
import { digestRequestSchema } from "@/features/weekly-activity-digest/contract";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!authenticateInternalRequest(request.headers)) {
      return Response.json({ success: false, code: "UNAUTHORIZED", message: "Invalid internal credentials or request timestamp." }, { status: 401 });
    }
    const key = request.headers.get("x-fs-idempotency-key");
    if (!key || !/^[A-Za-z0-9._:-]{1,200}$/.test(key)) {
      return invalid([{ path: ["x-fs-idempotency-key"], message: "A 1-200 character scheduler key is required (letters, digits, dot, underscore, colon, hyphen)." }]);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return invalid([{ path: [], message: "Body must be valid JSON." }]);
    }
    const parsed = digestRequestSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error.issues);
    // Load database code only after authentication and payload validation.
    const { queueDigestRun, InvalidFamilyScopeError } = await import("@/features/weekly-activity-digest/service");
    try {
      const result = await queueDigestRun(parsed.data, key);
      if (!result.queued) {
        return Response.json({ success: false, code: "ALREADY_QUEUED", runId: result.runId, message: "This key and week already identify a persisted run." }, { status: 409 });
      }
      return Response.json({
        success: true,
        runId: result.runId,
        status: "queued",
        weekStartUtc: new Date(parsed.data.weekStartUtc).toISOString(),
        weekEndUtc: new Date(parsed.data.weekEndUtc).toISOString(),
        familyScope: parsed.data.familyIds ? "subset" : "all",
        requestedFamilyCount: result.familyCount,
        dryRun: parsed.data.dryRun,
        message: "Digest run persisted. The digest worker will process it.",
      }, { status: 202 });
    } catch (error) {
      if (error instanceof InvalidFamilyScopeError) {
        return invalid([{ path: ["familyIds"], message: error.message }]);
      }
      throw error;
    }
  } catch (error) {
    console.error("[weekly-activity-digest.kickoff]", error);
    return Response.json({ success: false, code: "INTERNAL_ERROR", message: "Unable to queue the digest run." }, { status: 500 });
  }
}

function invalid(issues: unknown[]): Response {
  return Response.json({ success: false, code: "INVALID_REQUEST", message: "Invalid digest request.", issues }, { status: 400 });
}
