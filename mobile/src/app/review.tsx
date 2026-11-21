import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  acceptProcessingSuggestion,
  ApiError,
  deferCaptureReview,
  deleteCapture,
  getDailyReviewQueue,
  rejectProcessingSuggestion,
  requestCaptureProcessing,
  type DailyReviewEntry,
  type ProcessingProposal,
} from "../lib/api";
import { getSessionToken } from "../lib/session";

type ReviewCardProps = {
  entry: DailyReviewEntry;
  busy: boolean;
  onProcess: () => Promise<void>;
  onDefer: () => Promise<void>;
  onAccept: (proposal: ProcessingProposal) => Promise<void>;
  onReject: () => Promise<void>;
  onDelete: () => Promise<void>;
};

function ReviewCard({
  entry,
  busy,
  onProcess,
  onDefer,
  onAccept,
  onReject,
  onDelete,
}: ReviewCardProps) {
  const proposal = entry.suggestion?.proposal;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(proposal?.title ?? "");
  const [summary, setSummary] = useState(proposal?.summary ?? "");
  const [selectedRelatedItemIds, setSelectedRelatedItemIds] = useState<string[]>([]);

  function confirmDelete() {
    Alert.alert(
      "Delete capture?",
      "This permanently deletes the capture, any saved item created from it, and its review history.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void onDelete() },
      ],
    );
  }

  async function accept() {
    if (!proposal) return;
    await onAccept({
      ...proposal,
      related_item_ids: selectedRelatedItemIds,
      title: editing ? title.trim() : proposal.title,
      summary: editing ? summary.trim() : proposal.summary,
    });
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.priorityRow}>
        <Text style={[styles.priority, styles[`priority_${entry.priority}`]]}>
          {entry.priority} priority
        </Text>
        <Text style={styles.captureDate}>
          {new Date(entry.capture.createdAt).toLocaleDateString()}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete capture"
          disabled={busy}
          onPress={confirmDelete}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.priorityExplanation}>{entry.priorityExplanation}</Text>
      <Text style={styles.captureText}>{entry.capture.currentText}</Text>
      {entry.capture.currentText !== entry.capture.originalText ? (
        <Text style={styles.originalText}>
          Original: {entry.capture.originalText}
        </Text>
      ) : null}

      {entry.reviewStatus === "suggestion_ready" && proposal ? (
        <>
        <View style={styles.proposalPanel}>
          <Text style={styles.proposalLabel}>AI suggestion · review required</Text>
          {editing ? (
            <>
              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                accessibilityLabel="Edit suggestion title"
                editable={!busy}
                maxLength={160}
                onChangeText={setTitle}
                style={styles.titleInput}
                value={title}
              />
              <Text style={styles.fieldLabel}>Summary</Text>
              <TextInput
                accessibilityLabel="Edit suggestion summary"
                editable={!busy}
                maxLength={1_000}
                multiline
                onChangeText={setSummary}
                style={styles.summaryInput}
                value={summary}
              />
            </>
          ) : (
            <>
              <Text style={styles.proposalTitle}>{proposal.title}</Text>
              <Text style={styles.proposalSummary}>{proposal.summary}</Text>
            </>
          )}
          <Text style={styles.proposalType}>{proposal.item_type}</Text>
          {proposal.candidate_tasks.map((task, index) => (
            <Text key={`${entry.suggestion?.id}:task:${index}`} style={styles.taskText}>
              Next step: {task.title} · From your capture: {task.source_text}
            </Text>
          ))}
          {entry.suggestion?.relatedItems.length ? (
            <View style={styles.relatedSuggestionPanel}>
              <Text style={styles.taskText}>
                Possible links · choose which to include when accepting
              </Text>
              {entry.suggestion.relatedItems.map((relatedItem) => {
                const selected = selectedRelatedItemIds.includes(relatedItem.id);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${selected ? "Remove" : "Add"} link to ${relatedItem.title}`}
                    disabled={busy}
                    key={relatedItem.id}
                    onPress={() =>
                      setSelectedRelatedItemIds((current) =>
                        selected
                          ? current.filter((id) => id !== relatedItem.id)
                          : [...current, relatedItem.id],
                      )
                    }
                    style={styles.relatedSuggestionRow}
                  >
                    <View style={styles.relatedSuggestionCopy}>
                      <Text style={styles.relatedSuggestionTitle}>{relatedItem.title}</Text>
                      <Text numberOfLines={2} style={styles.relatedSuggestionSummary}>
                        {relatedItem.summary}
                      </Text>
                    </View>
                    <Text style={styles.relatedSuggestionAction}>
                      {selected ? "Included" : "Add link"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Save this suggestion to your items."
              disabled={busy}
              onPress={() => void accept()}
              style={[styles.actionButton, styles.acceptButton, busy && styles.disabled]}
            >
              <Text style={styles.acceptText}>
                {busy ? "Saving..." : editing ? "Accept edits" : "Accept"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={editing ? "Discard your edits." : "Edit the suggested title and summary before accepting."}
              disabled={busy}
              onPress={() => {
                if (editing) {
                  setTitle(proposal.title);
                  setSummary(proposal.summary);
                  setEditing(false);
                } else {
                  setEditing(true);
                }
              }}
              style={styles.textAction}
            >
              <Text style={styles.textActionLabel}>{editing ? "Cancel edit" : "Edit"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Keep the original capture and dismiss this suggestion."
              disabled={busy}
              onPress={() => void onReject()}
              style={styles.textAction}
            >
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Hide this capture from review for 24 hours."
            disabled={busy}
            onPress={() => void onDefer()}
            style={[styles.actionButton, styles.deferButton, busy && styles.disabled]}
          >
            <Text style={styles.processText}>
              {busy ? "Updating..." : "Review tomorrow"}
            </Text>
          </Pressable>
        </View>
        </>
      ) : (
        <View style={styles.actions}>
          {entry.reviewStatus === "needs_processing" ||
          entry.reviewStatus === "processing_failed" ? (
            <>
              {entry.reviewStatus === "processing_failed" ? (
                <Text style={styles.failureText}>
                  {entry.job?.errorCode === "invalid_output"
                    ? "The AI response did not pass validation. Your capture is safe."
                    : entry.job?.errorCode === "provider_unavailable"
                      ? `The AI service failed after ${entry.job.attemptCount} of ${entry.job.maxAttempts} attempts.`
                      : "Processing did not finish. Your capture is safe."}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Send this capture for processing, or retry if processing failed."
                disabled={busy}
                onPress={() => void onProcess()}
                style={[styles.actionButton, styles.processButton, busy && styles.disabled]}
              >
                <Text style={styles.processText}>
                  {busy
                    ? "Starting..."
                    : entry.reviewStatus === "processing_failed"
                      ? "Retry processing"
                      : "Process capture"}
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.processingText}>
              This capture is already in the processing queue.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Hide this capture from review for 24 hours."
            disabled={busy}
            onPress={() => void onDefer()}
            style={[styles.actionButton, styles.deferButton, busy && styles.disabled]}
          >
            <Text style={styles.processText}>
              {busy ? "Updating..." : "Review tomorrow"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function DailyReviewScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [entries, setEntries] = useState<DailyReviewEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyCaptureId, setBusyCaptureId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async (sessionToken: string, before?: string) => {
    const result = await getDailyReviewQueue(sessionToken, before);
    setEntries((current) =>
      before ? [...current, ...result.entries] : result.entries,
    );
    setNextCursor(result.nextCursor);
  }, []);

  useEffect(() => {
    let active = true;
    async function restoreQueue() {
      try {
        const sessionToken = await getSessionToken();
        if (!sessionToken) {
          router.replace("/");
          return;
        }
        if (active) {
          setToken(sessionToken);
          await loadQueue(sessionToken);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The review queue could not be loaded.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void restoreQueue();
    return () => {
      active = false;
    };
  }, [loadQueue]);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await loadQueue(token);
    } catch (loadError) {
      setError(
        loadError instanceof ApiError && loadError.status === 401
          ? "Your session expired. Return to the inbox and sign in again."
          : loadError instanceof Error
            ? loadError.message
            : "The review queue could not be loaded.",
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
      await loadQueue(token, nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "More review entries could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function runAction(
    entry: DailyReviewEntry,
    action: "process" | "defer" | "accept" | "reject" | "delete",
    proposal?: ProcessingProposal,
  ) {
    if (!token) return;
    setBusyCaptureId(entry.capture.id);
    setError(null);
    try {
      if (action === "process") {
        await requestCaptureProcessing(token, entry.capture.id);
      } else if (action === "defer") {
        await deferCaptureReview(token, entry.capture.id);
      } else if (action === "reject" && entry.suggestion) {
        await rejectProcessingSuggestion(token, entry.suggestion.id);
      } else if (action === "accept" && proposal && entry.suggestion) {
        await acceptProcessingSuggestion(token, entry.suggestion.id, proposal);
      } else if (action === "delete") {
        await deleteCapture(token, entry.capture.id);
      }
      await loadQueue(token);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "That review action could not be completed.",
      );
    } finally {
      setBusyCaptureId(null);
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
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
      </View>
      <FlatList
        contentContainerStyle={styles.content}
        data={entries}
        keyExtractor={(entry) => entry.capture.id}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator accessibilityLabel="Loading daily review" color="#2F4636" />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>You are caught up</Text>
              <Text style={styles.bodyText}>
                Captures that need processing or a decision will appear here.
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>A MOMENT TO RESET</Text>
            <Text accessibilityRole="header" style={styles.title}>Daily review</Text>
            <Text style={styles.bodyText}>
              Review pending suggestions, retry unfinished processing, or leave
              a capture for tomorrow.
            </Text>
            {error ? (
              <View>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {error}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => void refresh()}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ReviewCard
            busy={busyCaptureId === item.capture.id}
            entry={item}
            key={`${item.capture.id}:${item.suggestion?.id ?? "none"}`}
            onAccept={(proposal) => runAction(item, "accept", proposal)}
            onDefer={() => runAction(item, "defer")}
            onProcess={() => runAction(item, "process")}
            onReject={() => runAction(item, "reject")}
            onDelete={() => runAction(item, "delete")}
          />
        )}
        ListFooterComponent={
          nextCursor ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => void loadMore()}
              style={styles.moreButton}
            >
              <Text style={styles.retryText}>
                {loadingMore ? "Loading..." : "Load older captures"}
              </Text>
            </Pressable>
          ) : undefined
        }
        onRefresh={() => void refresh()}
        refreshing={loading && entries.length > 0}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  header: {
    alignItems: "center",
    borderBottomColor: "#E5E3DA",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: { justifyContent: "center", minHeight: 44 },
  backText: { color: "#53685A", fontSize: 15, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  titleBlock: { marginBottom: 18 },
  eyebrow: { color: "#68746B", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: "#24342A", fontFamily: "Georgia", fontSize: 31, fontWeight: "700", marginTop: 8 },
  bodyText: { color: "#59645C", fontSize: 14, lineHeight: 21, marginTop: 7 },
  card: { backgroundColor: "#FFFFFF", borderColor: "#E5E3DA", borderRadius: 15, borderWidth: 1, marginBottom: 13, padding: 15 },
  priorityRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  deleteButton: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  deleteButtonText: { color: "#A33D32", fontSize: 28, fontWeight: "500", lineHeight: 32 },
  priority: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  priority_high: { color: "#A84D3A" },
  priority_normal: { color: "#53685A" },
  priority_low: { color: "#717A72" },
  captureDate: { color: "#768078", fontSize: 11 },
  priorityExplanation: { color: "#68746B", fontSize: 12, lineHeight: 18, marginTop: 6 },
  captureText: { color: "#28372D", fontSize: 15, lineHeight: 22, marginTop: 11 },
  originalText: { color: "#68746B", fontSize: 12, lineHeight: 18, marginTop: 8 },
  proposalPanel: { backgroundColor: "#F1F4EF", borderRadius: 12, marginTop: 12, padding: 13 },
  proposalLabel: { color: "#53685A", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  proposalTitle: { color: "#24342A", fontSize: 16, fontWeight: "700", marginTop: 8 },
  proposalSummary: { color: "#435147", fontSize: 14, lineHeight: 21, marginTop: 4 },
  relatedSuggestionPanel: { borderTopColor: "#D9E1D8", borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 4 },
  relatedSuggestionRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D9E1D8", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 8, padding: 10 },
  relatedSuggestionCopy: { flex: 1 },
  relatedSuggestionTitle: { color: "#344238", fontSize: 13, fontWeight: "700" },
  relatedSuggestionSummary: { color: "#68746B", fontSize: 12, lineHeight: 17, marginTop: 3 },
  relatedSuggestionAction: { color: "#2F4636", fontSize: 12, fontWeight: "700" },
  proposalType: { color: "#68746B", fontSize: 11, marginTop: 7, textTransform: "uppercase" },
  taskText: { color: "#53685A", fontSize: 12, lineHeight: 18, marginTop: 8 },
  fieldLabel: { color: "#344238", fontSize: 13, fontWeight: "700", marginTop: 11 },
  titleInput: { backgroundColor: "#FFFFFF", borderColor: "#D9E1D8", borderRadius: 9, borderWidth: 1, color: "#24342A", minHeight: 42, paddingHorizontal: 10 },
  summaryInput: { backgroundColor: "#FFFFFF", borderColor: "#D9E1D8", borderRadius: 9, borderWidth: 1, color: "#24342A", minHeight: 76, padding: 10, textAlignVertical: "top" },
  actions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 12 },
  actionButton: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 13 },
  acceptButton: { backgroundColor: "#2F4636" },
  acceptText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  processButton: { backgroundColor: "#E8ECE6" },
  processText: { color: "#2F4636", fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  textAction: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 9 },
  textActionLabel: { color: "#53685A", fontSize: 13, fontWeight: "700" },
  rejectText: { color: "#A84D3A", fontSize: 13, fontWeight: "700" },
  deferButton: { backgroundColor: "#E8ECE6" },
  processingText: { color: "#53685A", fontSize: 13, lineHeight: 19, marginTop: 10 },
  failureText: { color: "#A33D32", flexBasis: "100%", fontSize: 12, lineHeight: 18 },
  emptyCard: { backgroundColor: "#FFFFFF", borderRadius: 15, padding: 18 },
  emptyTitle: { color: "#24342A", fontSize: 17, fontWeight: "700" },
  retryText: { color: "#53685A", fontSize: 14, fontWeight: "700", marginTop: 8 },
  errorText: { color: "#A33D32", fontSize: 14, lineHeight: 20, marginTop: 12 },
  moreButton: { alignItems: "center", justifyContent: "center", minHeight: 46 },
});
