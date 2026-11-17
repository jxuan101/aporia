import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InvalidGoogleIdTokenError,
  verifyGoogleIdToken,
} from "./google-id-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google ID token verification", () => {
  it("rejects malformed tokens without accepting unverified claims", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "configured-web-client-id");

    await expect(verifyGoogleIdToken("not-a-jwt")).rejects.toBeInstanceOf(
      InvalidGoogleIdTokenError,
    );
  });

  it("fails explicitly when the expected OAuth audience is not configured", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "");

    await expect(verifyGoogleIdToken("not-a-jwt")).rejects.toThrow(
      "AUTH_GOOGLE_ID must be configured",
    );
  });
});
