import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, type BrainDumpItem, listItems } from "../../lib/api";
import { SESSION_KEY } from "../../lib/session";
import { BrainDumpHeader } from "../../components/BrainDumpHeader";
import { tabTypography } from "../../theme/tabTypography";
import { MAX_SEARCH_QUERY_LENGTH } from "../../lib/limits";

export default function ItemsScreen() {
  const [items, setItems] = useState<BrainDumpItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const activeSearchRef = useRef("");

  const load = useCallback(async (
    sessionToken: string,
    before?: string,
    query = activeSearchRef.current,
  ) => {
    const result = await listItems(sessionToken, before, query);
    setItems((current) =>
      before ? [...current, ...result.items] : result.items,
    );
    setNextCursor(result.nextCursor);
  }, []);

  useFocusEffect(
    useCallback(() => {
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
            setError(null);
            const result = await listItems(storedToken, undefined, activeSearchRef.current);
            if (active) {
              setItems(result.items);
              setNextCursor(result.nextCursor);
            }
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
    }, []),
  );

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

  async function searchSavedItems() {
    if (!token) return;
    const query = searchText.trim();
    activeSearchRef.current = query;
    setActiveSearch(query);
    setLoading(true);
    setError(null);
    try {
      await load(token, undefined, query);
      Keyboard.dismiss();
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Saved items could not be searched.",
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
      <BrainDumpHeader />
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          items.length === 0 ? (loading ? (
            <ActivityIndicator accessibilityLabel="Loading saved items" color="#2F4636" />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {activeSearch ? "No saved items match" : "No saved items yet"}
              </Text>
              <Text style={styles.bodyText}>
                {activeSearch
                  ? "Try a different search."
                  : "Process a capture and accept its suggestion to save an item here."}
              </Text>
            </View>
          )) : undefined
        }
        ListHeaderComponent={
          <View style={styles.titleBlock}>
            <Text style={tabTypography.eyebrow}>YOUR KNOWLEDGE</Text>
            <Text accessibilityRole="header" style={tabTypography.title}>Saved items</Text>
            <Text style={tabTypography.subtitle}>
              Ideas and notes you chose to keep from processed captures.
            </Text>
            <View style={styles.searchSection}>
              <Text style={styles.fieldLabel}>Find a saved item</Text>
              <TextInput
                accessibilityLabel="Search saved items"
                maxLength={MAX_SEARCH_QUERY_LENGTH}
                onChangeText={setSearchText}
                onSubmitEditing={() => void searchSavedItems()}
                placeholder="Search saved items"
                placeholderTextColor="#7E867D"
                returnKeyType="search"
                style={styles.searchInput}
                value={searchText}
              />
              <View style={styles.searchActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={loading}
                  onPress={() => void searchSavedItems()}
                  style={styles.searchButton}
                >
                  <Text style={styles.searchButtonText}>Search</Text>
                </Pressable>
                {activeSearch ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => {
                      setSearchText("");
                      activeSearchRef.current = "";
                      setActiveSearch("");
                      void refresh();
                    }}
                    style={styles.clearSearchButton}
                  >
                    <Text style={styles.clearSearchText}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
              {activeSearch ? (
                <Text style={styles.searchCount}>
                  Search Results · {items.length} saved items
                </Text>
              ) : null}
            </View>
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
  bodyText: { color: "#59645C", fontSize: 14, lineHeight: 21, marginTop: 7 },
  fieldLabel: {
    color: "#344238",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 9,
  },
  searchSection: { marginTop: 20 },
  searchInput: { backgroundColor: "#FFFFFF", borderColor: "#E5E3DA", borderRadius: 12, borderWidth: 1, color: "#24342A", fontSize: 16, minHeight: 48, paddingHorizontal: 13 },
  searchActions: { alignItems: "center", flexDirection: "row", gap: 14, marginTop: 8 },
  searchButton: { alignItems: "center", backgroundColor: "#E8ECE6", borderRadius: 11, justifyContent: "center", minHeight: 44, paddingHorizontal: 16 },
  searchButtonText: { color: "#2F4636", fontSize: 14, fontWeight: "700" },
  clearSearchButton: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  clearSearchText: { color: "#53685A", fontSize: 14, fontWeight: "700" },
  searchCount: { color: "#59645C", fontSize: 13, marginTop: 8 },
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
