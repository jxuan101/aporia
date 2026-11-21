import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import { getSessionToken } from "../lib/session";

// Android speech services can report `end` while they are still releasing the
// previous recognizer. Give the service time to disconnect before restarting.
const RESTART_DELAY_MS = 750;
const MAX_SESSION_RESTARTS = 10;

export function HoldToCaptureButton() {
  const [holding, setHolding] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const recognitionRequested = useRef(false);
  const touchHeld = useRef(false);
  const permissionPending = useRef(false);
  const permissionGrantedForHold = useRef(false);
  const releaseRequested = useRef(false);
  const finalTranscript = useRef("");
  const navigated = useRef(false);
  const restartCount = useRef(0);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openCaptureForm = useCallback(() => {
    if (navigated.current) return;
    navigated.current = true;
    const transcript = finalTranscript.current.trim();
    if (!transcript) {
      return;
    }
    router.push({ pathname: "/quick-capture", params: { transcript } });
  }, []);

  const startRecognitionSession = useCallback(() => {
    if (
      !touchHeld.current ||
      !permissionGrantedForHold.current ||
      releaseRequested.current
    ) {
      return;
    }

    recognitionRequested.current = true;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: true,
      });
    } catch {
      recognitionRequested.current = false;
      permissionGrantedForHold.current = false;
      touchHeld.current = false;
      setHolding(false);
      Alert.alert(
        "Speech recognition unavailable",
        "Check that your device has a speech recognition service enabled, then try again.",
      );
    }
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (!touchHeld.current || !permissionGrantedForHold.current) return;
    recognitionRequested.current = true;
    setRecognizing(true);
    if (releaseRequested.current) ExpoSpeechRecognitionModule.stop();
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!event.isFinal) return;
    const transcript = event.results[0]?.transcript.trim();
    if (transcript) {
      finalTranscript.current = `${finalTranscript.current} ${transcript}`.trim();
      restartCount.current = 0;
    }
  });

  useSpeechRecognitionEvent("end", () => {
    recognitionRequested.current = false;
    setRecognizing(false);
    if (releaseRequested.current && permissionGrantedForHold.current) {
      if (restartTimer.current) clearTimeout(restartTimer.current);
      restartTimer.current = null;
      openCaptureForm();
    } else if (touchHeld.current && permissionGrantedForHold.current) {
      restartCount.current += 1;
      if (restartCount.current > MAX_SESSION_RESTARTS) {
        touchHeld.current = false;
        permissionGrantedForHold.current = false;
        setHolding(false);
        Alert.alert(
          "Speech recognition stopped",
          "Hold the microphone and try again when your device's speech service is available.",
        );
        return;
      }
      restartTimer.current = setTimeout(() => {
        restartTimer.current = null;
        startRecognitionSession();
      }, RESTART_DELAY_MS);
    } else {
      setHolding(false);
    }
  });

  async function startRecognition(): Promise<void> {
    try {
      const token = await getSessionToken();
      if (!token) {
        setHolding(false);
        Alert.alert("Sign in required", "Sign in before using voice capture.");
        return;
      }

      let permission;
      try {
        permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
          permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        }
      } catch {
        setHolding(false);
        return;
      } finally {
        permissionPending.current = false;
      }

      if (!permission.granted) {
        setHolding(false);
        return;
      }
      permissionGrantedForHold.current = true;
      if (releaseRequested.current) {
        setHolding(false);
        return;
      }

      startRecognitionSession();
    } catch {
      recognitionRequested.current = false;
      setHolding(false);
      permissionGrantedForHold.current = false;
      Alert.alert("Voice capture unavailable", "Sign in before using voice capture.");
    } finally {
      permissionPending.current = false;
    }
  }

  function handlePressIn(): void {
    if (recognitionRequested.current || permissionPending.current) return;
    finalTranscript.current = "";
    navigated.current = false;
    restartCount.current = 0;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = null;
    touchHeld.current = true;
    permissionGrantedForHold.current = false;
    releaseRequested.current = false;
    permissionPending.current = true;
    setHolding(true);
    void startRecognition().catch(() => {
      setHolding(false);
      Alert.alert("Voice capture unavailable", "Microphone permission could not be checked.");
    });
  }

  function handlePressOut(): void {
    touchHeld.current = false;
    releaseRequested.current = true;
    setHolding(false);
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = null;
    if (recognitionRequested.current) {
      ExpoSpeechRecognitionModule.stop();
    } else if (!permissionPending.current && permissionGrantedForHold.current) {
      openCaptureForm();
    }
  }

  useEffect(
    () => () => {
      if (restartTimer.current) clearTimeout(restartTimer.current);
      if (recognitionRequested.current) ExpoSpeechRecognitionModule.abort();
    },
    [],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recognizing ? "Listening, release to finish" : "Hold to dictate a quick capture"}
      accessibilityHint="Hold to speak. Release to open the capture form with your words."
      accessibilityState={{ selected: recognizing }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      pressRetentionOffset={{ top: 48, right: 48, bottom: 48, left: 48 }}
      style={({ pressed }) => [
        styles.button,
        (holding || recognizing) && styles.recording,
        pressed && styles.pressed,
      ]}
    >
      <Feather color="#FFFFFF" name="mic" size={30} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#2F4636",
    borderColor: "#FFFFFF",
    borderRadius: 40,
    borderWidth: 4,
    height: 78,
    justifyContent: "center",
    marginHorizontal: 5,
    marginTop: -28,
    width: 78,
  },
  recording: { backgroundColor: "#A33D32", transform: [{ scale: 1.06 }] },
  pressed: { opacity: 0.8 },
});
