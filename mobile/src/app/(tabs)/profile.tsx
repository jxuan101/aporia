import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";

import { exportCaptures, revokeSession } from "../../lib/api";
import { downloadCaptureExport } from "../../lib/export";
import { clearGoogleSignIn } from "../../lib/google-auth";
import { SESSION_KEY } from "../../lib/session";
import { AporiaHeader } from "../../components/AporiaHeader";
import { useAuthSession } from "../../lib/auth-session";
import { tabTypography } from "../../theme/tabTypography";

export default function ProfileScreen() {
  const { sessionToken: token, setSessionToken } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const filename = await downloadCaptureExport(await exportCaptures(token));
      Alert.alert("Export saved", `${filename} is saved on this device.`);
    } catch (exportError) {
      if (
        exportError instanceof Error &&
        exportError.message.toLowerCase().includes("cancel")
      ) return;
      setError("Your export could not be prepared. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!token) return;
    setBusy(true);
    setError(null);
    let serverRevokeFailed = false;
    try {
      await revokeSession(token);
    } catch {
      serverRevokeFailed = true;
    }
    try {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      await clearGoogleSignIn();
      if (serverRevokeFailed) {
        Alert.alert(
          "Signed out on this device",
          "The server could not confirm revocation. The local session was removed.",
          [{ text: "OK", onPress: () => setSessionToken(null) }],
        );
      } else {
        setSessionToken(null);
      }
    } catch {
      setError("This device could not finish signing out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <AporiaHeader />
      <View style={styles.content}>
        <Text style={tabTypography.eyebrow}>PROFILE</Text>
        <Text accessibilityRole="header" style={tabTypography.title}>Account</Text>
        <Text style={tabTypography.subtitle}>
          Manage your Aporia data and account on this device.
        </Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void exportData()} style={styles.action}>
          <Text style={styles.actionText}>{busy ? "Please wait…" : "Download my data"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void signOut()} style={[styles.action, styles.signOut]}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F6F4EE", flex: 1 },
  content: { padding: 20, paddingTop: 20 },
  action: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E5E3DA", borderRadius: 12, borderWidth: 1, justifyContent: "center", marginTop: 22, minHeight: 52 },
  actionText: { color: "#2F4636", fontSize: 15, fontWeight: "700" },
  signOut: { backgroundColor: "#FFF7F5", borderColor: "#EBC8C1", marginTop: 12 },
  signOutText: { color: "#A33D32", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33D32", fontSize: 14, lineHeight: 20, marginTop: 16 },
});
