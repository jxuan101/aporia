import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function shareCaptureExport(exportData: unknown): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("File sharing is not available on this device.");
  }

  const file = new File(
    Paths.cache,
    `braindump-export-${Date.now()}.json`,
  );
  file.create();
  await file.write(JSON.stringify(exportData, null, 2));
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Export BrainDump captures",
    mimeType: "application/json",
    UTI: "public.json",
  });
}
