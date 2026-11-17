export type CaptureExportInput = {
  id: string;
  originalText: string;
  currentText: string;
  createdAt: Date;
  updatedAt: Date;
};

export function createCaptureExport(
  captures: readonly CaptureExportInput[],
  exportedAt: Date,
) {
  return {
    schema_version: "1",
    exported_at: exportedAt.toISOString(),
    captures: captures.map((capture) => ({
      id: capture.id,
      original_text: capture.originalText,
      current_text: capture.currentText,
      created_at: capture.createdAt.toISOString(),
      updated_at: capture.updatedAt.toISOString(),
    })),
  };
}
