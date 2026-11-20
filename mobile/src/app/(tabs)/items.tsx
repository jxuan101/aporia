import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, type BrainDumpItem, listItems } from "../../lib/api";
import { SESSION_KEY } from "../../lib/session";

export default function ItemsScreen() {
  const [items, setItems] = useState<BrainDumpItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sessionToken: string, before?: string) => {
    const result = await listItems(sessionToken, before);
    setItems((current) =>
      before ? [...current, ...result.items] : result.items,
    );
    setNextCursor(result.nextCursor);
  }, []);

  useEffect(() => {
    let active = true;
    async function restoreItems() {
      try {
        const storedToken = await SecureStore.getItemAsync(SESSION_KEY);
        if (!storedToken) {
          router.replace("/");
          return;
        }
        if (active) {
          setToken(storedToken);
          await load(storedToken);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Your items could not be loaded.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void restoreItems();
    return () => {
      active = false;
    };
  }, [load]);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await load(token);
    } catch (loadError) {
      setError(
        loadError instanceof ApiError && loadError.status === 401
          ? "Your session expired. Return to the inbox and sign in again."
          : loadError instanceof Error
            ? loadError.message
            : "Your items could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!token || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      await load(token, nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "More items could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          items.length === 0 ? (loading ? (
            <ActivityIndicator accessibilityLabel="Loading saved items" color="#2F4636" />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No saved items yet</Text>
              <Text style={styles.bodyText}>
                Process a capture and accept its suggestion to save an item here.
              </Text>
            </View>
          )) : undefined
        }
        ListHeaderComponent={
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>YOUR KNOWLEDGE</Text>
            <Text accessibilityRole="header" style={styles.title}>Saved items</Text>
            <Text style={styles.bodyText}>
              Ideas and notes you chose to keep from processed captures.
            </Text>
            {error ? (
              <View>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {error}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Retry loading saved items" onPress={() => void refresh()} style={styles.retryButton}>
                  <Text style={styles.actionText}>Try again</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}, ${item.type}`}
            onPress={() =>
              router.push({ pathname: "/items/[itemId]", params: { itemId: item.id } })
            }
            style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}
          >
            <Text style={styles.itemType}>{item.type}</Text>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text numberOfLines={3} style={styles.bodyText}>
              {item.summary}
            </Text>
            {item.labels.length ? (
              <Text style={styles.labels}>{item.labels.join(" · ")}</Text>
            ) : null}
          </Pressable>
        )}
        ListFooterComponent={
          nextCursor ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => void loadMore()}
              style={styles.moreButton}
            >
              <Text style={styles.actionText}>
                {loadingMore ? "Loading..." : "Load older items"}
              </Text>
            </Pressable>
          ) : undefined
        }
        onRefresh={() => void refresh()}
        refreshing={loading && items.length > 0}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  titleBlock: { marginBottom: 18 },
  eyebrow: { color: "#68746B", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: "#24342A", fontFamily: "Georgia", fontSize: 32, fontWeight: "700", marginTop: 8 },
  bodyText: { color: "#59645C", fontSize: 14, lineHeight: 21, marginTop: 7 },
  emptyCard: { backgroundColor: "#FFFFFF", borderRadius: 15, padding: 18 },
  emptyTitle: { color: "#24342A", fontSize: 17, fontWeight: "700" },
  itemCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E3DA",
    borderRadius: 15,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  itemType: { color: "#647468", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  itemTitle: { color: "#24342A", fontSize: 17, fontWeight: "700", marginTop: 6 },
  labels: { color: "#53685A", fontSize: 12, marginTop: 10 },
  pressed: { opacity: 0.78 },
  moreButton: { alignItems: "center", minHeight: 44, justifyContent: "center" },
  retryButton: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44, paddingRight: 12 },
  actionText: { color: "#53685A", fontSize: 14, fontWeight: "700", marginTop: 8 },
  errorText: { color: "#A33D32", fontSize: 14, lineHeight: 20, marginTop: 12 },
});
