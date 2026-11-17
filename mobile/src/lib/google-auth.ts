import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export const googleSignInConfigured = Boolean(webClientId);

if (webClientId) {
  GoogleSignin.configure({
    webClientId,
    ...(iosClientId ? { iosClientId } : {}),
  });
}

export async function signInWithGoogle(): Promise<string | undefined> {
  if (!webClientId) {
    throw new Error(
      "Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in mobile/.env.local.",
    );
  }

  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    return undefined;
  }

  const { idToken } = await GoogleSignin.getTokens();
  if (!idToken) {
    throw new Error("Google did not return an ID token. Try signing in again.");
  }
  return idToken;
}

export async function clearGoogleSignIn(): Promise<void> {
  await GoogleSignin.signOut();
}
