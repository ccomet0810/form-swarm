import { describe, expect, it } from "vitest";
import {
  isValidResponseCount,
  MAX_RESPONSE_COUNT,
  MIN_RESPONSE_COUNT,
} from "../lib/ui/response-count";

describe("response count", () => {
  it("accepts integer counts within the supported range", () => {
    expect(isValidResponseCount(MIN_RESPONSE_COUNT)).toBe(true);
    expect(isValidResponseCount(10)).toBe(true);
    expect(isValidResponseCount(MAX_RESPONSE_COUNT)).toBe(true);
  });

  it("rejects empty, fractional, and out-of-range counts", () => {
    expect(isValidResponseCount("")).toBe(false);
    expect(isValidResponseCount(0)).toBe(false);
    expect(isValidResponseCount(1.5)).toBe(false);
    expect(isValidResponseCount(MAX_RESPONSE_COUNT + 1)).toBe(false);
    expect(isValidResponseCount(Number.NaN)).toBe(false);
  });
});
