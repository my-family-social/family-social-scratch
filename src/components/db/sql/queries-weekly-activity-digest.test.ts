import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  logDbQueryError: vi.fn(),
}));

vi.mock("@/components/db/drizzle", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: mocks.limit }),
        }),
      }),
    }),
  },
}));
vi.mock("./db-error-logger", () => ({ logDbQueryError: mocks.logDbQueryError }));

import { getNextDigestRun } from "./queries-weekly-activity-digest";

describe("getNextDigestRun", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the next persisted run without logging an error", async () => {
    const row = { runId: "queued-run", status: "queued" };
    mocks.limit.mockResolvedValue([row]);
    expect(await getNextDigestRun()).toBe(row);
    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.logDbQueryError).not.toHaveBeenCalled();
  });

  it("returns undefined when no runs are pending", async () => {
    mocks.limit.mockResolvedValue([]);
    expect(await getNextDigestRun()).toBeUndefined();
    expect(mocks.logDbQueryError).not.toHaveBeenCalled();
  });

  it("logs query context and rethrows the original connection failure", async () => {
    const error = new Error("Failed query", { cause: new Error("fetch failed") });
    mocks.limit.mockRejectedValue(error);
    await expect(getNextDigestRun({ runId: "target-run", dryRunOnly: true })).rejects.toBe(error);
    expect(mocks.logDbQueryError).toHaveBeenCalledTimes(1);
    expect(mocks.logDbQueryError).toHaveBeenCalledWith(
      "weekly-activity-digest.getNextDigestRun", error,
      { runId: "target-run", dryRunOnly: true },
    );
  });
});
