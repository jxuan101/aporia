import { describe, expect, it } from "vitest";

import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
} from "./http";

describe("mobile API request parsing", () => {
  it("parses bounded JSON bodies", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ text: "A private thought" }),
    });

    await expect(readJsonBody(request)).resolves.toEqual({
      text: "A private thought",
    });
  });

  it("rejects malformed or oversized bodies", async () => {
    const invalidRequest = new Request("https://example.test", {
      method: "POST",
      body: "{",
    });
    const oversizedRequest = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ text: "too long" }),
    });

    await expect(readJsonBody(invalidRequest)).rejects.toBeInstanceOf(
      InvalidJsonBodyError,
    );
    await expect(readJsonBody(oversizedRequest, 4)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
