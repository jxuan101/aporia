import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuthSession } from "../lib/auth-session";
import { exchangeGoogleIdToken } from "../lib/api";
import { googleSignInConfigured, signInWithGoogle } from "../lib/google-auth";
import { SESSION_KEY } from "../lib/session";

export default function LoginScreen() {
  const { setSessionToken } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithGoogle();
      if (!idToken) return;
      const session = await exchangeGoogleIdToken(idToken);
      await SecureStore.setItemAsync(SESSION_KEY, session.token);
      setSessionToken(session.token);
      router.replace("/");
    } catch (signInError) {
      const isGoogleDeveloperError =
        typeof signInError === "object" &&
        signInError !== null &&
        "code" in signInError &&
        signInError.code === "DEVELOPER_ERROR";
      setError(
        isGoogleDeveloperError
          ? "Google rejected this app’s OAuth setup. Confirm the configured ID is a Web client from the same Google Cloud project as the Android client for com.braindump.mobile."
          : signInError instanceof Error
            ? signInError.message
            : "Sign-in could not be completed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <View style={styles.logoMark}><Text style={styles.logoLetter}>b</Text></View>
          <Text style={styles.eyebrow}>CAPTURE · CLARIFY · ACT</Text>
          <Text accessibilityRole="header" style={styles.title}>Make room to think.</Text>
          <Text style={styles.subtitle}>
            A private place for the ideas, reminders, and loose ends on your mind.
            Capture now, decide what to do later.
          </Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {error ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void handleSignIn()} style={styles.retry}>
              <Text style={styles.retryText}>Try signing in again</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !googleSignInConfigured}
            onPress={() => void handleSignIn()}
            style={({ pressed }) => [styles.button, (busy || !googleSignInConfigured) && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>
              {busy ? "Connecting..." : googleSignInConfigured ? "Continue with Google" : "Configure Google sign-in"}
            </Text>
          </Pressable>
          {!googleSignInConfigured ? (
            <Text style={styles.error}>Set the Google client IDs in mobile/.env.local to sign in.</Text>
          ) : null}
          <Text style={styles.privacy}>
            Sign-in only shares your basic Google profile and email. BrainDump does not request access to Drive.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F6F4EE", flex: 1 },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingBottom: 36, paddingHorizontal: 28 },
  logoMark: { alignItems: "center", backgroundColor: "#D66B4D", borderRadius: 18, height: 56, justifyContent: "center", marginBottom: 30, width: 56 },
  logoLetter: { color: "#FFFFFF", fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }), fontSize: 36, fontWeight: "700", lineHeight: 40 },
  eyebrow: { color: "#68746B", fontSize: 11, fontWeight: "700", letterSpacing: 1.6 },
  title: { color: "#24342A", fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }), fontSize: 36, fontWeight: "600", lineHeight: 43, marginTop: 10, maxWidth: 340 },
  subtitle: { color: "#59645C", fontSize: 16, lineHeight: 24, marginTop: 12, maxWidth: 420 },
  error: { color: "#A33D32", fontSize: 14, lineHeight: 20, marginTop: 14 },
  retry: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center" },
  retryText: { color: "#53685A", fontSize: 14, fontWeight: "700" },
  button: { alignItems: "center", backgroundColor: "#243B2D", borderRadius: 14, justifyContent: "center", marginTop: 20, minHeight: 54, paddingHorizontal: 20 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.78 },
  privacy: { color: "#6A746B", fontSize: 13, lineHeight: 19, marginTop: 20 },
});
