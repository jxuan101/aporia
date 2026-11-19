import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

export function SpeechInputToggle({
  onTranscript,
}: {
  onTranscript: (transcript: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSpeechRecognitionEvent("start", () => {
    setListening(true);
    setError(null);
  });
  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript.trim();
    if (event.isFinal && transcript) onTranscript(transcript);
  });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    if (event.error !== "aborted") {
      setError(`Voice input unavailable (${event.error}).`);
    }
  });

  async function toggleListening() {
    setError(null);
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      setListening(false);
      return;
    }
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError("Allow microphone and speech recognition access to use voice input.");
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
      });
    } catch {
      setError("Voice input could not start on this device.");
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Voice input"
        accessibilityState={{ checked: listening }}
        onPress={() => void toggleListening()}
        style={[styles.button, listening && styles.active]}
      >
        <Text style={[styles.buttonText, listening && styles.activeText]}>
          {listening ? "Stop voice" : "Voice input"}
        </Text>
      </Pressable>
      {listening ? <Text style={styles.hint}>Listening · tap to stop</Text> : null}
      <Text style={styles.note}>
        Uses your device&apos;s speech service; audio is not saved.
      </Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "flex-start" },
  button: {
    alignItems: "center",
    backgroundColor: "#E8ECE6",
    borderRadius: 11,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 15,
  },
  active: { backgroundColor: "#A84D3A" },
  buttonText: { color: "#2F4636", fontSize: 14, fontWeight: "700" },
  activeText: { color: "#FFFFFF" },
  hint: { color: "#53685A", fontSize: 12, marginTop: 5 },
  note: { color: "#68746B", fontSize: 11, lineHeight: 15, marginTop: 5 },
  error: { color: "#A33D32", fontSize: 12, lineHeight: 17, marginTop: 5 },
});
