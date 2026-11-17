import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";

import {
  ApiError,
  type Capture,
  createCapture,
  deleteCapture,
  exchangeGoogleIdToken,
  exportCaptures,
  listCaptures,
  revokeSession,
  updateCapture,
} from "../lib/api";
import {
  clearGoogleSignIn,
  googleSignInConfigured,
  signInWithGoogle,
} from "../lib/google-auth";
import { shareCaptureExport } from "../lib/export";

const SESSION_KEY = "braindump-mobile-session";

type CaptureCardProps = {
  capture: Capture;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

function CaptureCard({ capture, onSave, onDelete }: CaptureCardProps) {
  const [draft, setDraft] = useState(capture.currentText);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(capture.id, draft);
      Keyboard.dismiss();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The capture could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete this capture?",
      "This cannot be undone. Your original capture will be deleted too.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            setError(null);
            void onDelete(capture.id)
              .catch((deleteError: unknown) => {
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : "The capture could not be deleted.",
                );
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  return (
    <View style={styles.captureCard}>
      <Text style={styles.captureDate}>
        {new Date(capture.createdAt).toLocaleString()}
      </Text>
      <TextInput
        accessibilityLabel="Edit capture"
        editable={!busy}
        multiline
        onChangeText={setDraft}
        placeholder="Write your thought"
        style={styles.captureInput}
        value={draft}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      )}
      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || draft === capture.currentText}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.smallButton,
            styles.secondaryButton,
            (busy || draft === capture.currentText) && styles.disabledButton,
            pressed && styles.pressedButton,
          ]}
        >
          <Text style={styles.secondaryButtonText}>
            {busy ? "Saving..." : "Save edit"}
          </Text>
        </Pressable>
        {capture.originalText !== capture.currentText && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowOriginal((visible) => !visible)}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>
              {showOriginal ? "Hide original" : "Original"}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={confirmDelete}
          style={styles.linkButton}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>
      {showOriginal && (
        <View style={styles.originalPanel}>
          <Text style={styles.originalLabel}>Original capture</Text>
          <Text style={styles.originalText}>{capture.originalText}</Text>
        </View>
      )}
    </View>
  );
}

export default function InboxScreen() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [captureText, setCaptureText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401) {
      setSessionToken(null);
      setCaptures([]);
      setError("Your session expired. Sign in again to continue.");
      void SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {
        setError(
          "Your session expired, but the local session could not be cleared. Try signing in again.",
        );
      });
      return;
    }
    setError(
      requestError instanceof Error
        ? requestError.message
        : "Something went wrong. Try again.",
    );
  }, []);

  const loadInbox = useCallback(
    async (token: string, query = "", before?: string) => {
      const result = await listCaptures(token, query, before);
      setCaptures((current) =>
        before ? [...current, ...result.captures] : result.captures,
      );
      setNextCursor(result.nextCursor);
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const storedToken = await SecureStore.getItemAsync(SESSION_KEY);
        if (!active) {
          return;
        }
        if (storedToken) {
          setSessionToken(storedToken);
          await loadInbox(storedToken);
        }
      } catch (restoreError) {
        if (active) {
          handleError(restoreError);
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, [handleError, loadInbox]);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithGoogle();
      if (!idToken) {
        return;
      }
      const session = await exchangeGoogleIdToken(idToken);
      await SecureStore.setItemAsync(SESSION_KEY, session.token);
      setSessionToken(session.token);
      await loadInbox(session.token);
    } catch (signInError) {
      const isGoogleDeveloperError =
        typeof signInError === "object" &&
        signInError !== null &&
        "code" in signInError &&
        signInError.code === "DEVELOPER_ERROR";
      if (isGoogleDeveloperError) {
        setError(
          "Google rejected this app’s OAuth setup. Confirm the configured ID is a Web client from the same Google Cloud project as the Android client for com.braindump.mobile.",
        );
      } else {
        handleError(signInError);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (!sessionToken) {
      return;
    }

    setBusy(true);
    setError(null);
    let revokeError: unknown;
    try {
      await revokeSession(sessionToken);
    } catch (requestError) {
      revokeError = requestError;
    }

    try {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      setSessionToken(null);
      setCaptures([]);
      setNextCursor(null);
      await clearGoogleSignIn();
      if (revokeError) {
        setError(
          "Signed out on this device, but server sign-out could not be confirmed.",
        );
      }
    } catch (signOutError) {
      handleError(signOutError);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCapture() {
    if (!sessionToken) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCapture(sessionToken, captureText);
      setCaptureText("");
      Keyboard.dismiss();
      await loadInbox(sessionToken, activeSearch);
    } catch (createError) {
      handleError(createError);
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch() {
    if (!sessionToken) {
      return;
    }
    const query = searchText.trim();
    setBusy(true);
    setError(null);
    try {
      await loadInbox(sessionToken, query);
      setActiveSearch(query);
      Keyboard.dismiss();
    } catch (searchError) {
      handleError(searchError);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadMore() {
    if (!sessionToken || !nextCursor) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await loadInbox(sessionToken, activeSearch, nextCursor);
    } catch (loadError) {
      handleError(loadError);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCapture(id: string, text: string) {
    if (!sessionToken) {
      return;
    }
    setError(null);
    try {
      const updatedCapture = await updateCapture(sessionToken, id, text);
      setCaptures((current) =>
        current.map((capture) =>
          capture.id === id ? updatedCapture : capture,
        ),
      );
    } catch (saveError) {
      handleError(saveError);
      throw saveError;
    }
  }

  async function handleDeleteCapture(id: string) {
    if (!sessionToken) {
      return;
    }
    setError(null);
    try {
      await deleteCapture(sessionToken, id);
      setCaptures((current) =>
        current.filter((capture) => capture.id !== id),
      );
    } catch (deleteError) {
      handleError(deleteError);
      throw deleteError;
    }
  }

  async function handleExport() {
    if (!sessionToken) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const exportedData = await exportCaptures(sessionToken);
      await shareCaptureExport(exportedData);
    } catch (exportError) {
      handleError(exportError);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingPanel}>
          <Text style={styles.eyebrow}>BRAINDUMP</Text>
          <Text style={styles.loadingText}>Opening your private inbox...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!sessionToken) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.signInPanel}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>b</Text>
            </View>
            <Text style={styles.eyebrow}>CAPTURE · CLARIFY · ACT</Text>
            <Text style={styles.title}>Make room to think.</Text>
            <Text style={styles.intro}>
              A private place for the ideas, reminders, and loose ends on your
              mind. Capture now; decide what to do later.
            </Text>
            {error && (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
            )}
            {error && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void handleSignIn()}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>Try signing in again</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={busy || !googleSignInConfigured}
              onPress={() => void handleSignIn()}
              style={({ pressed }) => [
                styles.primaryButton,
                (busy || !googleSignInConfigured) && styles.disabledButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {busy
                  ? "Connecting..."
                  : googleSignInConfigured
                    ? "Continue with Google"
                    : "Configure Google sign-in"}
              </Text>
            </Pressable>
            {!googleSignInConfigured && (
              <Text style={styles.errorText}>
                Set the Google client IDs in mobile/.env.local to sign in.
              </Text>
            )}
            <Text style={styles.privacyNote}>
              Sign-in only shares your basic Google profile and email. BrainDump
              does not request access to Drive.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <View style={[styles.brandMark, styles.smallBrandMark]}>
              <Text style={[styles.brandMarkText, styles.smallBrandMarkText]}>
                b
              </Text>
            </View>
            <Text style={styles.brandName}>BrainDump</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void handleExport()}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Export</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void handleSignOut()}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Sign out</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>YOUR PRIVATE INBOX</Text>
          <Text style={styles.title}>Get it out of your head.</Text>
          <Text style={styles.intro}>
            Capture first. Decide what to do with it later.
          </Text>

          <View style={styles.composer}>
            <Text style={styles.fieldLabel}>What is on your mind?</Text>
            <TextInput
              accessibilityLabel="What is on your mind?"
              editable={!busy}
              maxLength={10_000}
              multiline
              onChangeText={setCaptureText}
              placeholder="Write it down. You can organize it later."
              placeholderTextColor="#7E867D"
              style={styles.composerInput}
              textAlignVertical="top"
              value={captureText}
            />
            <Text style={styles.helperText}>
              Your original wording is kept when you edit a capture.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy || captureText.trim().length === 0}
              onPress={() => void handleCreateCapture()}
              style={({ pressed }) => [
                styles.primaryButton,
                (busy || captureText.trim().length === 0) &&
                  styles.disabledButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {busy ? "Working..." : "Save to inbox"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.searchSection}>
            <Text style={styles.fieldLabel}>Find a thought</Text>
            <TextInput
              accessibilityLabel="Search your captures"
              editable={!busy}
              maxLength={200}
              onChangeText={setSearchText}
              onSubmitEditing={() => void handleSearch()}
              placeholder="Search your captures"
              placeholderTextColor="#7E867D"
              returnKeyType="search"
              style={styles.searchInput}
              value={searchText}
            />
            <View style={styles.searchActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void handleSearch()}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Search</Text>
              </Pressable>
              {activeSearch ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    setSearchText("");
                    setActiveSearch("");
                    setBusy(true);
                    setError(null);
                    void loadInbox(sessionToken)
                      .catch(handleError)
                      .finally(() => setBusy(false));
                  }}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {error && (
            <View>
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  setError(null);
                  void loadInbox(sessionToken, activeSearch)
                    .catch(handleError)
                    .finally(() => setBusy(false));
                }}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>Retry loading inbox</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.inboxHeader}>
            <Text style={styles.sectionTitle}>
              {activeSearch ? "Search results" : "Inbox"}
            </Text>
            <Text style={styles.countText}>{captures.length}</Text>
          </View>

          {captures.length === 0 ? (
            <Text style={styles.emptyState}>
              {activeSearch
                ? "No captures match that search."
                : "No captures yet. Add a thought above whenever you are ready."}
            </Text>
          ) : (
            captures.map((capture) => (
              <CaptureCard
                capture={capture}
                key={`${capture.id}:${capture.updatedAt}`}
                onDelete={handleDeleteCapture}
                onSave={handleSaveCapture}
              />
            ))
          )}

          {nextCursor && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void handleLoadMore()}
              style={styles.loadMoreButton}
            >
              <Text style={styles.secondaryButtonText}>
                {busy ? "Loading..." : "Load older captures"}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: "#F6F4EE",
  },
  loadingPanel: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  loadingText: {
    color: "#354139",
    fontSize: 17,
    marginTop: 16,
  },
  signInPanel: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 36,
  },
  brandMark: {
    alignItems: "center",
    backgroundColor: "#D66B4D",
    borderRadius: 18,
    height: 56,
    justifyContent: "center",
    marginBottom: 30,
    width: 56,
  },
  brandMarkText: {
    color: "#FFFFFF",
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontSize: 36,
    fontWeight: "700",
    lineHeight: 40,
  },
  eyebrow: {
    color: "#68746B",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  title: {
    color: "#24342A",
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontSize: 36,
    fontWeight: "600",
    lineHeight: 43,
    marginTop: 10,
    maxWidth: 340,
  },
  intro: {
    color: "#59645C",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
    maxWidth: 420,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#243B2D",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 20,
    marginTop: 20,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.48,
  },
  pressedButton: {
    opacity: 0.78,
  },
  privacyNote: {
    color: "#6A746B",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 20,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#E5E3DA",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  headerBrand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  smallBrandMark: {
    borderRadius: 12,
    height: 34,
    marginBottom: 0,
    width: 34,
  },
  smallBrandMarkText: {
    fontSize: 24,
    lineHeight: 28,
  },
  brandName: {
    color: "#24342A",
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontSize: 20,
    fontWeight: "700",
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 48,
  },
  composer: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E3DA",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 24,
    padding: 16,
  },
  fieldLabel: {
    color: "#344238",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 9,
  },
  composerInput: {
    color: "#24342A",
    fontSize: 16,
    lineHeight: 23,
    minHeight: 110,
    paddingHorizontal: 0,
    paddingVertical: 5,
  },
  helperText: {
    color: "#717A72",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  searchSection: {
    marginTop: 25,
  },
  searchInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E3DA",
    borderRadius: 12,
    borderWidth: 1,
    color: "#24342A",
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  searchActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    marginTop: 10,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#E8ECE6",
    borderRadius: 11,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#2F4636",
    fontSize: 14,
    fontWeight: "700",
  },
  smallButton: {
    minHeight: 36,
  },
  cardActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  linkButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 6,
  },
  linkText: {
    color: "#53685A",
    fontSize: 13,
    fontWeight: "700",
  },
  deleteText: {
    color: "#A84D3A",
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    color: "#A33D32",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  inboxHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 30,
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#24342A",
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontSize: 25,
    fontWeight: "700",
  },
  countText: {
    color: "#68746B",
    fontSize: 14,
  },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E3DA",
    borderRadius: 14,
    borderWidth: 1,
    color: "#667068",
    fontSize: 15,
    lineHeight: 22,
    padding: 18,
  },
  captureCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E3DA",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 15,
  },
  captureDate: {
    color: "#768078",
    fontSize: 11,
    marginBottom: 7,
  },
  captureInput: {
    color: "#28372D",
    fontSize: 15,
    lineHeight: 22,
    minHeight: 50,
    padding: 0,
  },
  originalPanel: {
    backgroundColor: "#F6F4EE",
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  originalLabel: {
    color: "#617065",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  originalText: {
    color: "#515D54",
    fontSize: 14,
    lineHeight: 21,
  },
  loadMoreButton: {
    alignItems: "center",
    backgroundColor: "#E8ECE6",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    marginTop: 6,
  },
});
