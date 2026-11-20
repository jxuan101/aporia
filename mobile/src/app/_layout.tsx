import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";

function RootNavigator() {
  const { sessionToken, isLoading } = useAuthSession();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#2F4636" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, animation: "slide_from_right" }}
      >
        <Stack.Protected guard={!sessionToken}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(sessionToken)} redirectTo="/login">
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="review" />
          <Stack.Screen
            name="quick-capture"
            options={{ animation: "slide_from_bottom", presentation: "modal" }}
          />
          <Stack.Screen name="items/[itemId]" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthSessionProvider>
      <RootNavigator />
    </AuthSessionProvider>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", backgroundColor: "#F6F4EE", flex: 1, justifyContent: "center" },
});
