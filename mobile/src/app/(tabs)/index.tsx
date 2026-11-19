import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
import { router, useFocusEffect } from "expo-router";

import {
  acceptProcessingSuggestion,
  ApiError,
  type AgentJob,
  type BrainDumpItem,
  type Capture,
  type CaptureCreation,
  type ProcessingProposal,
  type SuggestionDecision,
  createCapture,
  deleteCapture,
  exchangeGoogleIdToken,
  getProcessingJob,
  listCaptures,
  listItems,
  rejectProcessingSuggestion,
  requestCaptureProcessing,
  updateCapture,
} from "../../lib/api";
import {
  googleSignInConfigured,
  signInWithGoogle,
} from "../../lib/google-auth";
import { SESSION_KEY } from "../../lib/session";
import { SpeechInputToggle } from "../../components/SpeechInputToggle";

const JOB_STATUS_POLL_INITIAL_DELAY_MS = 2_000;
const JOB_STATUS_POLL_MAX_DELAY_MS = 10_000;
const JOB_STATUS_POLL_MAX_DURATION_MS = 2 * 60 * 1_000;

type CaptureCardProps = {
  capture: Capture;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRequestProcessing: (captureId: string) => Promise<AgentJob>;
  onRefreshProcessing: (jobId: string) => Promise<AgentJob>;
  onAcceptSuggestion: (
    suggestionId: string,
    proposal: ProcessingProposal,
  ) => Promise<SuggestionDecision>;
  onRejectSuggestion: (suggestionId: string) => Promise<SuggestionDecision>;
};

function processingFailureMessage(job: AgentJob): string {
  switch (job.errorCode) {
    case "invalid_output":
      return "The AI response could not be checked against your capture. Your original is safe; try processing again.";
    case "provider_unavailable":
      return `The AI service did not respond after ${job.attemptCount} of ${job.maxAttempts} attempts. Try again later.`;
    case "provider_rejected":
      return "The AI service rejected this request. Your capture is safe; try again later.";
    case "processing_error":
      return "Processing stopped unexpectedly. Your capture is safe; try again later.";
    case "lease_expired":
      return "The worker stopped responding before finishing. Your capture is safe; you can retry.";
    default:
      return "Processing could not finish. Your capture is safe; you can try again.";
  }
}

function CaptureCard({
  capture,
  onSave,
  onDelete,
  onRequestProcessing,
  onRefreshProcessing,
  onAcceptSuggestion,
  onRejectSuggestion,
}: CaptureCardProps) {
  const [draftState, setDraftState] = useState({
    sourceText: capture.currentText,
    text: capture.currentText,
  });
  const draft =
    draftState.sourceText === capture.currentText
      ? draftState.text
      : capture.currentText;
  const [isEditingCapture, setIsEditingCapture] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AgentJob | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [isEditingProposal, setIsEditingProposal] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSummary, setProposalSummary] = useState("");

  const suggestion = job?.suggestion ?? null;
  const isJobActive = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!job?.id || !isJobActive || pollingPaused) {
      return;
    }

    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let nextDelay = JOB_STATUS_POLL_INITIAL_DELAY_MS;
    function schedulePoll() {
      if (Date.now() - startedAt >= JOB_STATUS_POLL_MAX_DURATION_MS) {
        setPollingPaused(true);
        setError(
          "Processing is taking longer than expected. Automatic status checks are paused; check again later.",
        );
        return;
      }
      timeout = setTimeout(() => void poll(), nextDelay);
      nextDelay = Math.min(nextDelay * 2, JOB_STATUS_POLL_MAX_DELAY_MS);
    }
    const poll = async () => {
      try {
        const refreshed = await onRefreshProcessing(job.id);
        if (!active) {
          return;
        }
        setJob(refreshed);
        if (refreshed.status === "queued" || refreshed.status === "running") {
          schedulePoll();
        }
      } catch (pollError) {
        if (active) {
          setPollingPaused(true);
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Could not refresh processing status.",
          );
        }
      }
    };

    timeout = setTimeout(() => void poll(), JOB_STATUS_POLL_INITIAL_DELAY_MS);
    return () => {
      active = false;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [isJobActive, job?.id, onRefreshProcessing, pollingPaused]);

  async function requestProcessing() {
    setBusy(true);
    setError(null);
    setPollingPaused(false);
    try {
      setJob(await onRequestProcessing(capture.id));
    } catch (processingError) {
      setError(
        processingError instanceof Error
          ? processingError.message
          : "Could not start capture processing.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshProcessing() {
    if (!job) {
      return;
    }
    setBusy(true);
    setError(null);
    setPollingPaused(false);
    try {
      setJob(await onRefreshProcessing(job.id));
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not refresh processing status.",
      );
    } finally {
      setBusy(false);
    }
  }

  function applyDecision(decision: SuggestionDecision) {
    setJob((current) => {
      if (!current?.suggestion) {
        return current;
      }
      return {
        ...current,
        suggestion: {
          ...current.suggestion,
          status: decision.status,
          acceptedProposal: decision.acceptedProposal,
          itemId: decision.itemId,
        },
      };
    });
    setIsEditingProposal(false);
  }

  async function acceptProposal() {
    if (!suggestion) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const proposal: ProcessingProposal = {
        ...suggestion.proposal,
        title: isEditingProposal
          ? proposalTitle.trim()
          : suggestion.proposal.title,
        summary: isEditingProposal
          ? proposalSummary.trim()
          : suggestion.proposal.summary,
      };
      applyDecision(await onAcceptSuggestion(suggestion.id, proposal));
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not accept this suggestion.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rejectProposal() {
    if (!suggestion) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      applyDecision(await onRejectSuggestion(suggestion.id));
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not reject this suggestion.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(capture.id, draft);
      setIsEditingCapture(false);
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
      <View style={styles.captureCardHeader}>
        <Text style={styles.captureDate}>
          {new Date(capture.createdAt).toLocaleString()}
        </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete capture"
            disabled={busy}
            onPress={confirmDelete}
            style={styles.deleteCaptureButton}
          >
            <Text style={styles.deleteCaptureButtonText}>×</Text>
          </Pressable>
      </View>
      <Text accessibilityLabel="Capture text" style={styles.captureText}>
        {capture.currentText}
      </Text>
      <Modal
        animationType="slide"
        onRequestClose={() => setIsEditingCapture(false)}
        visible={isEditingCapture}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.captureEditModal}
        >
          <SafeAreaView edges={["top", "left", "right"]} style={styles.captureEditSafeArea}>
            <View style={styles.captureEditHeader}>
              <Text accessibilityRole="header" style={styles.captureEditTitle}>
                Edit capture
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  setDraftState({ sourceText: capture.currentText, text: capture.currentText });
                  setIsEditingCapture(false);
                  Keyboard.dismiss();
                }}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>Cancel</Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel="Edit capture text"
              autoFocus
              editable={!busy}
              maxLength={10_000}
              multiline
              onChangeText={(text) =>
                setDraftState({ sourceText: capture.currentText, text })
              }
              placeholder="Write your thought"
              style={styles.captureEditInput}
              textAlignVertical="top"
              value={draft}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || draft === capture.currentText}
              onPress={() => void save()}
              style={[styles.captureEditSave, (busy || draft === capture.currentText) && styles.disabledButton]}
            >
              <Text style={styles.primaryButtonText}>{busy ? "Saving..." : "Save changes"}</Text>
            </Pressable>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      {error && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      )}
      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setDraftState({ sourceText: capture.currentText, text: capture.currentText });
            setIsEditingCapture(true);
          }}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>Edit capture</Text>
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
          disabled={busy || Boolean(isJobActive)}
          onPress={() => {
                  if (suggestion?.status === "accepted" && suggestion.itemId) {
              router.push({ pathname: "/items/[itemId]", params: { itemId: suggestion.itemId } });
            } else if (!suggestion || suggestion.status !== "pending") {
              void requestProcessing();
            }
          }}
          style={[
            styles.smallButton,
            styles.secondaryButton,
            (busy || Boolean(isJobActive) || suggestion?.status === "pending") && styles.disabledButton,
          ]}
        >
          <Text style={styles.secondaryButtonText}>
            {suggestion?.status === "accepted" && suggestion.itemId
              ? "Open saved item"
              : suggestion?.status === "pending"
                ? "Suggestion ready below"
                : busy
                  ? "Starting..."
                  : isJobActive
                    ? "Processing..."
                    : job?.status === "failed" || job?.status === "cancelled"
                      ? "Try processing again"
                      : "Process with AI"}
          </Text>
        </Pressable>
      </View>
      {showOriginal && (
        <View style={styles.originalPanel}>
          <Text style={styles.originalLabel}>Original capture</Text>
          <Text style={styles.originalText}>{capture.originalText}</Text>
        </View>
      )}
      {job && (
        <View style={styles.processingPanel}>
          {isJobActive ? (
            <Text style={styles.processingStatus}>
              {job.status === "queued"
                ? job.errorCode === "provider_unavailable"
                  ? `The AI service is temporarily unavailable. Retrying (${Math.min(job.attemptCount + 1, job.maxAttempts)} of ${job.maxAttempts})...`
                  : "Queued for processing..."
                : "Processing this capture..."}
            </Text>
          ) : job.status === "failed" ? (
            <Text style={styles.errorText}>{processingFailureMessage(job)}</Text>
          ) : job.status === "cancelled" ? (
            <Text style={styles.processingStatus}>
              This capture changed during processing. Start again for the edited text.
            </Text>
          ) : null}

          {error && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          )}
          {error && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void refreshProcessing()}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Retry status update</Text>
            </Pressable>
          )}

          {suggestion && (
            <View style={styles.suggestionPanel}>
              <Text style={styles.suggestionLabel}>
                AI suggestion · {suggestion.status === "pending" ? "needs your review" : suggestion.status}
              </Text>
              {isEditingProposal ? (
                <>
                  <Text style={styles.fieldLabel}>Suggested title</Text>
                  <TextInput
                    accessibilityLabel="Edit suggested title"
                    editable={!busy}
                    maxLength={160}
                    onChangeText={setProposalTitle}
                    style={styles.proposalTitleInput}
                    value={proposalTitle}
                  />
                  <Text style={styles.fieldLabel}>Suggested summary</Text>
                  <TextInput
                    accessibilityLabel="Edit suggested summary"
                    editable={!busy}
                    maxLength={1_000}
                    multiline
                    onChangeText={setProposalSummary}
                    style={styles.proposalSummaryInput}
                    value={proposalSummary}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.suggestionTitle}>
                    {suggestion.acceptedProposal?.title ?? suggestion.proposal.title}
                  </Text>
                  <Text style={styles.suggestionSummary}>
                    {suggestion.acceptedProposal?.summary ?? suggestion.proposal.summary}
                  </Text>
                </>
              )}
              <Text style={styles.suggestionType}>
                {suggestion.proposal.item_type}
              </Text>
              {suggestion.proposal.labels.length > 0 && (
                <Text style={styles.suggestionDetail}>
                  Labels: {suggestion.proposal.labels.join(", ")}
                </Text>
              )}
              {suggestion.proposal.candidate_tasks.map((task, index) => (
                <View key={`${suggestion.id}:task:${index}`} style={styles.taskSuggestion}>
                  <Text style={styles.taskSuggestionTitle}>Next step: {task.title}</Text>
                  {task.due_date && (
                    <Text style={styles.suggestionDetail}>
                      Date wording: {task.due_date}
                    </Text>
                  )}
                  <Text style={styles.taskSourceText}>From your capture: {task.source_text}</Text>
                </View>
              ))}
              {suggestion.proposal.clarifying_question && (
                <Text style={styles.suggestionDetail}>
                  Question: {suggestion.proposal.clarifying_question}
                </Text>
              )}
              <Text style={styles.suggestionExplanation}>
                {suggestion.proposal.reasoning_summary}
              </Text>
              {suggestion.status === "pending" ? (
                <View style={styles.reviewActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void acceptProposal()}
                    style={[styles.smallButton, styles.acceptButton, busy && styles.disabledButton]}
                  >
                    <Text style={styles.acceptButtonText}>
                      {busy ? "Saving..." : isEditingProposal ? "Accept edits" : "Accept suggestion"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      if (isEditingProposal) {
                        setIsEditingProposal(false);
                      } else {
                        setProposalTitle(suggestion.proposal.title);
                        setProposalSummary(suggestion.proposal.summary);
                        setIsEditingProposal(true);
                      }
                    }}
                    style={styles.linkButton}
                  >
                    <Text style={styles.linkText}>
                      {isEditingProposal ? "Cancel edit" : "Edit title or summary"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void rejectProposal()}
                    style={styles.linkButton}
                  >
                    <Text style={styles.deleteText}>Reject</Text>
                  </Pressable>
                </View>
              ) : suggestion.status === "accepted" ? (
                <Text style={styles.processingStatus}>
                  Accepted and saved to your items.
                </Text>
              ) : suggestion.status === "rejected" ? (
                <Text style={styles.processingStatus}>
                  Rejected. Your original capture is unchanged.
                </Text>
              ) : (
                <Text style={styles.processingStatus}>
                  This proposal is out of date. Process the edited capture to get a new one.
                </Text>
              )}
            </View>
          )}
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
  const [possibleDuplicates, setPossibleDuplicates] = useState<
    CaptureCreation["possibleDuplicates"]
  >([]);
  const [searchItems, setSearchItems] = useState<BrainDumpItem[]>([]);
  const [searchItemsCursor, setSearchItemsCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [captureText, setCaptureText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401) {
      setSessionToken(null);
      setCaptures([]);
      setPossibleDuplicates([]);
      setSearchItems([]);
      setSearchItemsCursor(null);
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

  useFocusEffect(
    useCallback(() => {
      if (!ready || !sessionToken) return;
      void loadInbox(sessionToken, activeSearch).catch(handleError);
    }, [activeSearch, handleError, loadInbox, ready, sessionToken]),
  );

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

  async function handleCreateCapture() {
    if (!sessionToken) {
      return;
    }
    setBusy(true);
    setError(null);
    setPossibleDuplicates([]);
    try {
      const result = await createCapture(sessionToken, captureText);
      setPossibleDuplicates(result.possibleDuplicates);
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
      const [captureResults, itemResults] = await Promise.all([
        listCaptures(sessionToken, query),
        query
          ? listItems(sessionToken, undefined, query)
          : Promise.resolve({ items: [], nextCursor: null }),
      ]);
      setCaptures(captureResults.captures);
      setNextCursor(captureResults.nextCursor);
      setSearchItems(itemResults.items);
      setSearchItemsCursor(itemResults.nextCursor);
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

  async function handleLoadMoreSearchItems() {
    if (!sessionToken || !searchItemsCursor || !activeSearch) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await listItems(
        sessionToken,
        searchItemsCursor,
        activeSearch,
      );
      setSearchItems((current) => [...current, ...result.items]);
      setSearchItemsCursor(result.nextCursor);
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

  const handleRequestProcessing = useCallback(
    async (captureId: string) => {
      if (!sessionToken) {
        throw new ApiError("Authentication required.", 401);
      }
      return requestCaptureProcessing(sessionToken, captureId);
    },
    [sessionToken],
  );

  const handleRefreshProcessing = useCallback(
    async (jobId: string) => {
      if (!sessionToken) {
        throw new ApiError("Authentication required.", 401);
      }
      return getProcessingJob(sessionToken, jobId);
    },
    [sessionToken],
  );

  const handleAcceptSuggestion = useCallback(
    async (suggestionId: string, proposal: ProcessingProposal) => {
      if (!sessionToken) {
        throw new ApiError("Authentication required.", 401);
      }
      return acceptProcessingSuggestion(sessionToken, suggestionId, proposal);
    },
    [sessionToken],
  );

  const handleRejectSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!sessionToken) {
        throw new ApiError("Authentication required.", 401);
      }
      return rejectProcessingSuggestion(sessionToken, suggestionId);
    },
    [sessionToken],
  );

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

  if (!ready) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
        <View style={styles.loadingPanel}>
          <Text style={styles.eyebrow}>BRAINDUMP</Text>
          <Text style={styles.loadingText}>Opening your private inbox...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!sessionToken) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
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
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
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
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>YOUR PRIVATE INBOX</Text>
          <Text accessibilityRole="header" style={styles.title}>Get it out of your head.</Text>
          <Text style={styles.intro}>
            Capture first. Decide what to do with it later.
          </Text>
          <Pressable
            accessibilityRole="button"
                  onPress={() => router.push("/review")}
            style={styles.reviewNavButton}
          >
            <Text style={styles.reviewNavText}>Open daily review</Text>
          </Pressable>

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
            {possibleDuplicates.length > 0 && (
              <View style={styles.duplicateWarning}>
                <Text style={styles.duplicateWarningTitle}>
                  Similar thought already saved
                </Text>
                <Text style={styles.duplicateWarningText}>
                  Your new capture is saved. It looks similar to:
                </Text>
                {possibleDuplicates.map((duplicate) => (
                  <Text
                    key={duplicate.id}
                    numberOfLines={3}
                    style={styles.duplicateMatchText}
                  >
                    {duplicate.currentText}
                  </Text>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPossibleDuplicates([])}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>Dismiss warning</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.composerActions}>
              <SpeechInputToggle
                onTranscript={(transcript) =>
                  setCaptureText((current) =>
                    `${current.trimEnd()}${current.trim() ? " " : ""}${transcript}`,
                  )
                }
              />
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
          </View>

          <View style={styles.searchSection}>
            <Text style={styles.fieldLabel}>Find a thought</Text>
            <TextInput
              accessibilityLabel="Search your captures"
              editable={!busy}
              maxLength={200}
              onChangeText={setSearchText}
              onSubmitEditing={() => void handleSearch()}
              placeholder="Search captures and saved items"
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
                    setSearchItems([]);
                    setSearchItemsCursor(null);
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

          {activeSearch ? (
            <View style={styles.searchResultsHeader}>
              <Text style={styles.sectionTitle}>Search Results</Text>
              <Text style={styles.countText}>
                {captures.length} captures · {searchItems.length} saved items
              </Text>
            </View>
          ) : (
            <View style={styles.inboxHeader}>
              <Text style={styles.sectionTitle}>Inbox</Text>
              <Text style={styles.countText}>{captures.length}</Text>
            </View>
          )}

          {captures.length === 0 ? (
            <Text style={styles.emptyState}>
              {activeSearch
                ? searchItems.length
                  ? "No captures match. Saved item results are below."
                  : "No captures or saved items match that search."
                : "No captures yet. Add a thought above whenever you are ready."}
            </Text>
          ) : (
            captures.map((capture) => (
              <CaptureCard
                capture={capture}
                key={`${capture.id}:${capture.updatedAt}`}
                onDelete={handleDeleteCapture}
                onSave={handleSaveCapture}
                onRequestProcessing={handleRequestProcessing}
                onRefreshProcessing={handleRefreshProcessing}
                onAcceptSuggestion={handleAcceptSuggestion}
                onRejectSuggestion={handleRejectSuggestion}
              />
            ))
          )}

          {activeSearch && searchItems.length > 0 && (
            <>
              <View style={styles.inboxHeader}>
                <Text style={styles.sectionTitle}>Saved items</Text>
                <Text style={styles.countText}>{searchItems.length}</Text>
              </View>
              {searchItems.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.title}, ${item.type}`}
                  key={item.id}
                  onPress={() =>
                    router.push({
                      pathname: "/items/[itemId]",
                      params: { itemId: item.id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.searchItemCard,
                    pressed && styles.pressedButton,
                  ]}
                >
                  <Text style={styles.suggestionType}>{item.type}</Text>
                  <Text style={styles.suggestionTitle}>{item.title}</Text>
                  <Text style={styles.suggestionSummary}>{item.summary}</Text>
                  {item.labels.length > 0 && (
                    <Text style={styles.suggestionDetail}>
                      Labels: {item.labels.join(", ")}
                    </Text>
                  )}
                </Pressable>
              ))}
              {searchItemsCursor && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void handleLoadMoreSearchItems()}
                  style={styles.loadMoreButton}
                >
                  <Text style={styles.secondaryButtonText}>
                    {busy ? "Loading..." : "Load more saved items"}
                  </Text>
                </Pressable>
              )}
            </>
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
  reviewNavButton: {
    alignSelf: "flex-start",
    backgroundColor: "#E8ECE6",
    borderRadius: 11,
    justifyContent: "center",
    marginTop: 14,
            minHeight: 44,
    paddingHorizontal: 14,
  },
  reviewNavText: { color: "#2F4636", fontSize: 13, fontWeight: "700" },
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
  duplicateWarning: {
    backgroundColor: "#FBF3E4",
    borderColor: "#E7D6B5",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 13,
    padding: 12,
  },
  duplicateWarningTitle: {
    color: "#674A1F",
    fontSize: 14,
    fontWeight: "700",
  },
  duplicateWarningText: {
    color: "#675C49",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  duplicateMatchText: {
    color: "#4F4A41",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
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
    minHeight: 44,
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
    minHeight: 44,
    paddingHorizontal: 8,
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
  searchResultsHeader: {
    alignItems: "flex-start",
    flexDirection: "column",
    marginBottom: 12,
    marginTop: 30,
  },
  composerActions: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    marginTop: 8,
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
  captureCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  deleteCaptureButton: {
    alignItems: "center",
    backgroundColor: "#FFF1EE",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  deleteCaptureButtonText: {
    color: "#A33D32",
    fontSize: 25,
    fontWeight: "400",
    lineHeight: 29,
  },
  searchItemCard: {
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
  captureEditModal: { backgroundColor: "#F6F4EE", flex: 1 },
  captureEditSafeArea: { flex: 1, padding: 20 },
  captureEditHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  captureEditTitle: { color: "#24342A", fontSize: 23, fontWeight: "700" },
  captureEditInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E3DA",
    borderRadius: 14,
    borderWidth: 1,
    color: "#28372D",
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 16,
    padding: 14,
  },
  captureEditSave: {
    alignItems: "center",
    backgroundColor: "#2F4636",
    borderRadius: 11,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 52,
  },
  captureText: {
    color: "#28372D",
    fontSize: 15,
    lineHeight: 22,
    minHeight: 44,
    paddingVertical: 6,
  },
  originalPanel: {
    backgroundColor: "#F6F4EE",
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
  },
  processingPanel: {
    borderTopColor: "#E5E3DA",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 11,
  },
  processingStatus: {
    color: "#53685A",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  suggestionPanel: {
    backgroundColor: "#F1F4EF",
    borderColor: "#D9E1D8",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 13,
  },
  suggestionLabel: {
    color: "#53685A",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  suggestionTitle: {
    color: "#24342A",
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 23,
    marginTop: 9,
  },
  suggestionSummary: {
    color: "#435147",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 5,
  },
  suggestionType: {
    alignSelf: "flex-start",
    color: "#596C5E",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 9,
    textTransform: "capitalize",
  },
  suggestionDetail: {
    color: "#536056",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  taskSuggestion: {
    borderLeftColor: "#9BAE9C",
    borderLeftWidth: 2,
    marginTop: 9,
    paddingLeft: 9,
  },
  taskSuggestionTitle: {
    color: "#344238",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  taskSourceText: {
    color: "#717A72",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  suggestionExplanation: {
    color: "#68746B",
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 18,
    marginTop: 10,
  },
  proposalTitleInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E1D8",
    borderRadius: 8,
    borderWidth: 1,
    color: "#24342A",
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  proposalSummaryInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E1D8",
    borderRadius: 8,
    borderWidth: 1,
    color: "#24342A",
    fontSize: 14,
    lineHeight: 20,
    minHeight: 76,
    padding: 10,
    textAlignVertical: "top",
  },
  reviewActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  acceptButton: {
    alignItems: "center",
    backgroundColor: "#2F4636",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 13,
  },
  acceptButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
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
