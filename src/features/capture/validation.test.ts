import { describe, expect, it } from "vitest";

import { captureTextSchema } from "./validation";

describe("captureTextSchema", () => {
  it("preserves the exact user text", () => {
    const text = "  Call Sam about the apartment.\n";

    expect(captureTextSchema.parse(text)).toBe(text);
  });

  it("rejects empty or whitespace-only captures", () => {
    expect(captureTextSchema.safeParse("").success).toBe(false);
    expect(captureTextSchema.safeParse(" \n\t ").success).toBe(false);
  });

  it("limits captures to 10,000 characters", () => {
    expect(captureTextSchema.safeParse("x".repeat(10_000)).success).toBe(true);
    expect(captureTextSchema.safeParse("x".repeat(10_001)).success).toBe(false);
  });
});
