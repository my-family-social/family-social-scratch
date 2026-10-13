import { describe, expect, it } from "vitest";
import { getDigestImageExpiry } from "./weekly-activity-digest-email-images";

describe("getDigestImageExpiry", () => {
  const weekEnd = "2026-10-11T23:59:59.999Z";

  it("is derived from the digest week so retries produce identical links", () => {
    const first = getDigestImageExpiry(weekEnd, new Date("2026-10-12T01:00:00Z"));
    const retry = getDigestImageExpiry(weekEnd, new Date("2026-10-13T22:00:00Z"));
    expect(first.toISOString()).toBe("2027-01-10T00:00:00.000Z");
    expect(retry).toEqual(first);
  });

  it("re-bases late replays on the current day", () => {
    expect(getDigestImageExpiry(weekEnd, new Date("2027-01-01T08:00:00Z")).toISOString()).toBe("2027-04-02T00:00:00.000Z");
  });
});
