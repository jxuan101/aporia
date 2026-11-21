import * as SecureStore from "expo-secure-store";

export const SESSION_KEY = "aporia-mobile-session";
const LEGACY_SESSION_KEY = "braindump-mobile-session";

export async function getSessionToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(SESSION_KEY);
  if (token) return token;

  const legacyToken = await SecureStore.getItemAsync(LEGACY_SESSION_KEY);
  if (!legacyToken) return null;

  await SecureStore.setItemAsync(SESSION_KEY, legacyToken);
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
  return legacyToken;
}
