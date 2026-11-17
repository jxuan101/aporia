import { describe, expect, it } from "vitest";

import { createCaptureExport } from "./export";

describe("createCaptureExport", () => {
  it("exports original and edited text with ISO timestamps", () => {
    const createdAt = new Date("2026-11-16T12:00:00.000Z");
    const updatedAt = new Date("2026-11-16T13:00:00.000Z");
    const exportedAt = new Date("2026-11-16T14:00:00.000Z");

    expect(
      createCaptureExport(
        [
          {
            id: "capture-id",
            originalText: "Original thought",
            currentText: "Edited thought",
            createdAt,
            updatedAt,
          },
        ],
        exportedAt,
      ),
    ).toEqual({
      schema_version: "1",
      exported_at: "2026-11-16T14:00:00.000Z",
      captures: [
        {
          id: "capture-id",
          original_text: "Original thought",
          current_text: "Edited thought",
          created_at: "2026-11-16T12:00:00.000Z",
          updated_at: "2026-11-16T13:00:00.000Z",
        },
      ],
    });
  });
});
