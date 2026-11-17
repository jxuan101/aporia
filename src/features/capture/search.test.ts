import { describe, expect, it } from "vitest";

import {
  createCaptureSearchPattern,
  getCaptureSearchExcerpt,
} from "./search";
import {
  captureSearchQuerySchema,
  MAX_SEARCH_QUERY_LENGTH,
} from "./validation";

describe("capture search", () => {
  it("escapes SQL LIKE wildcard characters in literal searches", () => {
    expect(createCaptureSearchPattern("100%_\\")).toBe("%100\\%\\_\\\\%");
  });

  it("trims and bounds search queries", () => {
    expect(captureSearchQuerySchema.parse("  Sam  ")).toBe("Sam");
    expect(
      captureSearchQuerySchema.safeParse(
        "x".repeat(MAX_SEARCH_QUERY_LENGTH + 1),
      ).success,
    ).toBe(false);
  });

  it("returns an excerpt around a case-insensitive match", () => {
    const text = `${"Earlier note. ".repeat(8)}Meet Sam next week.${" Later note.".repeat(8)}`;
    const excerpt = getCaptureSearchExcerpt(text, "", "SAM NEXT");

    expect(excerpt).toContain("Meet Sam next week.");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("searches original text when the current text no longer matches", () => {
    expect(getCaptureSearchExcerpt("Edited text", "Original plan with Sam", "Sam"))
      .toContain("Original plan with Sam");
  });
});
