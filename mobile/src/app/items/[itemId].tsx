import { useCallback, useEffect, useState } from "react";
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

import {
  addRelatedItem,
  getItem,
  getRelatedItems,
  type BrainDumpItemDetail,
  type RelatedItems,
  removeRelatedItem,
} from "../../lib/api";
import { SESSION_KEY } from "../../lib/session";

export default function ItemDetailScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const [item, setItem] = useState<BrainDumpItemDetail | null>(null);
  const [related, setRelated] = useState<RelatedItems | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingLink, setUpdatingLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refreshRelated = useCallback(async (sessionToken: string) => {
    setRelated(await getRelatedItems(sessionToken, itemId));
  }, [itemId]);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionToken = await SecureStore.getItemAsync(SESSION_KEY);
      if (!sessionToken) {
        router.replace("/");
        return;
      }
      const [result, relatedResult] = await Promise.all([
        getItem(sessionToken, itemId),
        getRelatedItems(sessionToken, itemId),
      ]);
      setToken(sessionToken);
      setItem(result);
      setRelated(relatedResult);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "This item could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    let active = true;
    async function loadInitialDetail() {
      try {
        const sessionToken = await SecureStore.getItemAsync(SESSION_KEY);
        if (!sessionToken) {
          router.replace("/");
          return;
        }
        const [result, relatedResult] = await Promise.all([
          getItem(sessionToken, itemId),
          getRelatedItems(sessionToken, itemId),
        ]);
        if (active) {
          setToken(sessionToken);
          setItem(result);
          setRelated(relatedResult);
        }
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
    void loadInitialDetail();
    return () => {
      active = false;
    };
  }, [itemId]);

  async function updateRelationship(relatedItemId: string, linked: boolean) {
    if (!token) return;
    setUpdatingLink(true);
    setLinkError(null);
    try {
      if (linked) {
        await removeRelatedItem(token, itemId, relatedItemId);
      } else {
        await addRelatedItem(token, itemId, relatedItemId);
      }
      await refreshRelated(token);
    } catch (requestError) {
      setLinkError(
        requestError instanceof Error
          ? requestError.message
          : "The relationship could not be updated.",
      );
    } finally {
      setUpdatingLink(false);
    }
  }

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
          <ActivityIndicator accessibilityLabel="Loading saved item" color="#2F4636" />
        </View>
      ) : error || !item ? (
        <View style={styles.content}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error ?? "This item is unavailable."}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void loadDetail()} style={styles.retryButton}>
            <Text style={styles.backText}>Try loading again</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.retryButton}>
            <Text style={styles.backText}>Return to saved items</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>{item.type.toUpperCase()}</Text>
          <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>
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
            <Text style={styles.sectionTitle}>Related items</Text>
            {linkError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {linkError}
              </Text>
            ) : null}
            {related?.relatedItems.length ? (
              related.relatedItems.map((relatedItem) => (
                <View key={relatedItem.id} style={styles.relatedCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open related item ${relatedItem.title}`}
                    onPress={() =>
                      router.push({
                        pathname: "./[itemId]",
                        params: { itemId: relatedItem.id },
                      })
                    }
                  >
                    <Text style={styles.taskTitle}>{relatedItem.title}</Text>
                    <Text numberOfLines={2} style={styles.text}>
                      {relatedItem.summary}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove link to ${relatedItem.title}`}
                    disabled={updatingLink}
                    onPress={() => void updateRelationship(relatedItem.id, true)}
                    style={styles.linkAction}
                  >
                    <Text style={styles.linkActionText}>
                      {updatingLink ? "Updating..." : "Remove link"}
                    </Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={styles.text}>No linked items yet.</Text>
            )}
            {related?.suggestions.length ? (
              <View style={styles.suggestions}>
                <Text style={styles.sectionTitle}>Might be related</Text>
                {related.suggestions.map(({ item: candidate, matchTerms }) => (
                  <View key={candidate.id} style={styles.relatedCard}>
                    <Text style={styles.taskTitle}>{candidate.title}</Text>
                    <Text numberOfLines={2} style={styles.text}>
                      {candidate.summary}
                    </Text>
                    <Text style={styles.matchTerms}>
                      Shared terms: {matchTerms.join(", ")}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={updatingLink}
                      onPress={() => void updateRelationship(candidate.id, false)}
                      style={styles.linkAction}
                    >
                      <Text style={styles.linkActionText}>
                        {updatingLink ? "Updating..." : "Link items"}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
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
  backButton: { justifyContent: "center", minHeight: 44 },
  retryButton: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44, paddingRight: 12 },
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
  relatedCard: { backgroundColor: "#FFFFFF", borderRadius: 12, marginTop: 8, padding: 13 },
  suggestions: { marginTop: 18 },
  matchTerms: { color: "#68746B", fontSize: 12, marginTop: 8 },
  linkAction: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginTop: 5, paddingHorizontal: 8 },
  linkActionText: { color: "#53685A", fontSize: 13, fontWeight: "700" },
  errorText: { color: "#A33D32", fontSize: 15, lineHeight: 22, marginBottom: 14 },
});
