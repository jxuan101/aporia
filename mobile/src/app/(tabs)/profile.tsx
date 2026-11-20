import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { exportCaptures, revokeSession } from "../../lib/api";
import { shareCaptureExport } from "../../lib/export";
import { clearGoogleSignIn } from "../../lib/google-auth";
import { SESSION_KEY } from "../../lib/session";
import { BrainDumpHeader } from "../../components/BrainDumpHeader";

export default function ProfileScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void SecureStore.getItemAsync(SESSION_KEY).then((sessionToken) => {
      if (sessionToken) setToken(sessionToken);
      else router.replace("/");
    }).catch(() => setError("Your profile could not be loaded."));
  }, []);

  async function exportData() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await shareCaptureExport(await exportCaptures(token));
    } catch {
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
          [{ text: "OK", onPress: () => router.replace("/") }],
        );
      } else {
        router.replace("/");
      }
    } catch {
      setError("This device could not finish signing out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <BrainDumpHeader />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>PROFILE</Text>
        <Text accessibilityRole="header" style={styles.title}>Account</Text>
        <Text style={styles.description}>
          Manage your BrainDump data and account on this device.
        </Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void exportData()} style={styles.action}>
          <Text style={styles.actionText}>{busy ? "Please wait…" : "Export my data"}</Text>
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
  eyebrow: { color: "#68746B", fontSize: 11, fontWeight: "700", letterSpacing: 1.6 },
  title: { color: "#24342A", fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }), fontSize: 36, fontWeight: "600", lineHeight: 43, marginTop: 10, maxWidth: 340 },
  description: { color: "#59645C", fontSize: 15, lineHeight: 22, marginTop: 8 },
  action: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E5E3DA", borderRadius: 12, borderWidth: 1, justifyContent: "center", marginTop: 22, minHeight: 52 },
  actionText: { color: "#2F4636", fontSize: 15, fontWeight: "700" },
  signOut: { backgroundColor: "#FFF7F5", borderColor: "#EBC8C1", marginTop: 12 },
  signOutText: { color: "#A33D32", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33D32", fontSize: 14, lineHeight: 20, marginTop: 16 },
});
