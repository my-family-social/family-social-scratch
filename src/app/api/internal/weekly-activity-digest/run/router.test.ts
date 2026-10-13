import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./router";

const queue = vi.hoisted(() => vi.fn());
vi.mock("@/features/weekly-activity-digest/service", () => ({
  queueDigestRun: queue,
  InvalidFamilyScopeError: class InvalidFamilyScopeError extends Error {},
}));
const body = { weekStartUtc: "2026-10-05T00:00:00Z", weekEndUtc: "2026-10-11T23:59:59.999Z" };
function request(payload: unknown = body, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/internal/weekly-activity-digest/run", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-fs-internal-secret": "test-secret",
      "x-fs-request-ts": new Date().toISOString(), "x-fs-idempotency-key": "weekly-test", ...headers,
    }, body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("digest kickoff contract", () => {
  beforeEach(() => {
    vi.stubEnv("FS_INTERNAL_API_SECRET", "test-secret");
    queue.mockReset().mockResolvedValue({ queued: true, runId: "b36c9bfb-1d76-4c49-9fb3-74fd7fd42243", familyCount: 2 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("returns the complete 202 shape with defaults", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true, runId: "b36c9bfb-1d76-4c49-9fb3-74fd7fd42243", status: "queued",
      weekStartUtc: "2026-10-05T00:00:00.000Z", weekEndUtc: body.weekEndUtc,
      familyScope: "all", requestedFamilyCount: 2, dryRun: false,
      message: "Digest run persisted. The digest worker will process it.",
    });
    expect(queue).toHaveBeenCalledWith({ ...body, dryRun: false, forceReplay: false }, "weekly-test");
  });
  it("returns subset/dry-run information", async () => {
    const response = await POST(request({ ...body, dryRun: true, familyIds: [1, 2] }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ familyScope: "subset", dryRun: true, requestedFamilyCount: 2 });
  });
  it.each<Record<string, string>>([
    { "x-fs-internal-secret": "" }, { "x-fs-internal-secret": "test-secretX" },
    { "x-fs-request-ts": "" }, { "x-fs-request-ts": "not-a-date" },
    { "x-fs-request-ts": "2026-10-09T12:00:00+01:00" },
    { "x-fs-request-ts": new Date(Date.now() - 360000).toISOString() },
    { "x-fs-request-ts": new Date(Date.now() + 360000).toISOString() },
  ])("rejects invalid authentication %j before queuing", async (headers) => {
    const response = await POST(request(body, headers));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    expect(queue).not.toHaveBeenCalled();
  });
  it.each([
    {}, { ...body, weekStartUtc: "2026-10-06T00:00:00Z" },
    { ...body, weekStartUtc: "2026-10-05T00:01:00Z" },
    { ...body, weekEndUtc: "2026-10-11T23:59:59Z" },
    { ...body, weekEndUtc: "2026-10-18T23:59:59.999Z" },
    { ...body, dryRun: "true" }, { ...body, familyIds: [] },
    { ...body, familyIds: [1, 1] }, { ...body, familyIds: [-1] },
    { ...body, familyIds: [1.1] }, { ...body, minActivityScoreOverride: -1 },
    { ...body, minActivityScoreOverride: 1.1 }, { ...body, unexpected: true },
    { ...body, forceReplay: true }, "{",
  ])("returns issues for invalid payload %j", async (payload) => {
    const response = await POST(request(payload));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: "INVALID_REQUEST", issues: expect.any(Array) });
    expect(queue).not.toHaveBeenCalled();
  });
  it("accepts an explicit annotated replay", async () => {
    expect((await POST(request({ ...body, forceReplay: true, operatorNotes: "Retry rejection" }))).status).toBe(202);
  });
  it("rejects a missing scheduler key", async () => {
    expect((await POST(request(body, { "x-fs-idempotency-key": "" }))).status).toBe(400);
    expect(queue).not.toHaveBeenCalled();
  });
  it("returns 409 and the original run ID for duplicate kickoffs", async () => {
    queue.mockResolvedValue({ queued: false, runId: "original" });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "ALREADY_QUEUED", runId: "original" });
  });
  it("returns a safe 500 and logs persistence failures", async () => {
    queue.mockRejectedValue(new Error("private database error"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR", message: "Unable to queue the digest run." });
    expect(console.error).toHaveBeenCalled();
  });
  it("fails closed with missing server configuration", async () => {
    vi.stubEnv("FS_INTERNAL_API_SECRET", "");
    expect((await POST(request())).status).toBe(500);
    expect(queue).not.toHaveBeenCalled();
  });
});
