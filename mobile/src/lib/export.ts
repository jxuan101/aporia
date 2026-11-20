import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

export async function downloadCaptureExport(exportData: unknown): Promise<string> {
  const name = `braindump-export-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
  const contents = JSON.stringify(exportData, null, 2);

  if (Platform.OS === "android") {
    const directory = await Directory.pickDirectoryAsync();
    const file = directory.createFile(name, "application/json");
    await file.write(contents);
    return name;
  }

  if (Platform.OS !== "ios") {
    throw new Error("Downloads are not available on this platform.");
  }

  const file = new File(Paths.document, name);
  file.create({ overwrite: true });
  await file.write(contents);
  return name;
}
