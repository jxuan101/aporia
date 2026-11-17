import type { captures } from "@/db/schema";

type CaptureRow = typeof captures.$inferSelect;

export function serializeCapture(capture: CaptureRow) {
  return {
    id: capture.id,
    originalText: capture.rawText,
    currentText: capture.currentText,
    createdAt: capture.createdAt.toISOString(),
    updatedAt: capture.updatedAt.toISOString(),
  };
}
