import { describe, expect, it } from "vitest";

import {
  createMobileSessionToken,
  getBearerToken,
} from "./bearer-token";

describe("mobile bearer sessions", () => {
  it("creates opaque base64url tokens accepted by the API parser", () => {
    const token = createMobileSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getBearerToken(new Request("https://example.test", {
      headers: { authorization: `Bearer ${token}` },
    }))).toBe(token);
  });

  it("rejects malformed or non-bearer authorization headers", () => {
    expect(
      getBearerToken(
        new Request("https://example.test", {
          headers: { authorization: "Basic not-a-session-token" },
        }),
      ),
    ).toBeUndefined();
    expect(
      getBearerToken(
        new Request("https://example.test", {
          headers: { authorization: "Bearer short" },
        }),
      ),
    ).toBeUndefined();
  });
});
