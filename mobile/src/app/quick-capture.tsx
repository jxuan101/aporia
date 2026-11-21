import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { createCapture } from "../lib/api";
import { getSessionToken } from "../lib/session";
import { MAX_CAPTURE_LENGTH } from "../lib/limits";

export default function QuickCaptureScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const { transcript } = useLocalSearchParams<{ transcript?: string }>();
  const [text, setText] = useState(() =>
    typeof transcript === "string" ? transcript : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const captureText = text.trim();
    if (!captureText) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getSessionToken();
      if (!token) {
        router.replace("/");
        return;
      }
      await createCapture(token, captureText);
      router.replace("/");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The capture could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>Quick capture</Text>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.closeButton}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={styles.description}>Review or edit your capture before saving it to the inbox.</Text>
          <TextInput
            accessibilityLabel="Capture text"
            autoFocus
            editable={!busy}
            maxLength={MAX_CAPTURE_LENGTH}
            multiline
            onChangeText={setText}
            placeholder="What is on your mind?"
            style={[
              styles.input,
              {
                maxHeight: Math.min(windowHeight * 0.45, 360),
                minHeight: Math.min(180, windowHeight * 0.35),
              },
            ]}
            textAlignVertical="top"
            value={text}
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy || !text.trim()} onPress={() => void save()} style={[styles.saveButton, (busy || !text.trim()) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save to inbox</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F6F4EE", flex: 1 },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  title: { color: "#24342A", fontFamily: "Georgia", fontSize: 27, fontWeight: "700" },
  closeButton: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  closeText: { color: "#53685A", fontSize: 14, fontWeight: "700" },
  description: { color: "#59645C", fontSize: 14, lineHeight: 21, marginTop: 8 },
  input: { backgroundColor: "#FFFFFF", borderColor: "#E5E3DA", borderRadius: 16, borderWidth: 1, color: "#28372D", fontSize: 16, lineHeight: 24, marginVertical: 18, padding: 15 },
  saveButton: { alignItems: "center", backgroundColor: "#2F4636", borderRadius: 12, justifyContent: "center", marginTop: 20, minHeight: 54 },
  saveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  error: { color: "#A33D32", fontSize: 14, lineHeight: 20, marginTop: 12 },
});
