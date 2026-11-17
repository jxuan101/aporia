import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { getItem, type BrainDumpItemDetail } from "../../lib/api";
import { SESSION_KEY } from "../../lib/session";

export default function ItemDetailScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const [item, setItem] = useState<BrainDumpItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadDetail() {
      try {
        const token = await SecureStore.getItemAsync(SESSION_KEY);
        if (!token) {
          router.replace("/");
          return;
        }
        const result = await getItem(token, itemId);
        if (active) setItem(result);
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "This item could not be loaded.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDetail();
    return () => {
      active = false;
    };
  }, [itemId]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹ Saved items</Text>
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#2F4636" />
        </View>
      ) : error || !item ? (
        <View style={styles.content}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error ?? "This item is unavailable."}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.backText}>Return to saved items</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>{item.type.toUpperCase()}</Text>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.summary}>{item.summary}</Text>
          {item.labels.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Labels</Text>
              <Text style={styles.text}>{item.labels.join(" · ")}</Text>
            </View>
          ) : null}
          {item.candidateTasks.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Suggested next steps</Text>
              {item.candidateTasks.map((task, index) => (
                <View key={`${item.id}:task:${index}`} style={styles.task}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  {task.due_date ? (
                    <Text style={styles.text}>Date wording: {task.due_date}</Text>
                  ) : null}
                  <Text style={styles.source}>From your capture: {task.source_text}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Original capture</Text>
            <Text style={styles.original}>{item.capture.originalText}</Text>
            {item.capture.currentText !== item.capture.originalText ? (
              <View style={styles.currentCapture}>
                <Text style={styles.sectionTitle}>Current capture</Text>
                <Text style={styles.original}>{item.capture.currentText}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  header: {
    borderBottomColor: "#E5E3DA",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: { justifyContent: "center", minHeight: 36 },
  backText: { color: "#53685A", fontSize: 15, fontWeight: "700" },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { padding: 22, paddingBottom: 40 },
  eyebrow: { color: "#68746B", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: "#24342A", fontFamily: "Georgia", fontSize: 31, fontWeight: "700", lineHeight: 38, marginTop: 8 },
  summary: { color: "#435147", fontSize: 16, lineHeight: 25, marginTop: 12 },
  section: { borderTopColor: "#E2E0D7", borderTopWidth: StyleSheet.hairlineWidth, marginTop: 24, paddingTop: 16 },
  sectionTitle: { color: "#344238", fontSize: 14, fontWeight: "700", marginBottom: 9 },
  text: { color: "#59645C", fontSize: 14, lineHeight: 21 },
  task: { backgroundColor: "#FFFFFF", borderRadius: 12, marginTop: 8, padding: 13 },
  taskTitle: { color: "#24342A", fontSize: 15, fontWeight: "700" },
  source: { color: "#68746B", fontSize: 12, lineHeight: 18, marginTop: 8 },
  original: { backgroundColor: "#FFFFFF", borderRadius: 12, color: "#435147", fontSize: 14, lineHeight: 22, padding: 14 },
  currentCapture: { marginTop: 14 },
  errorText: { color: "#A33D32", fontSize: 15, lineHeight: 22, marginBottom: 14 },
});
