const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export const googleSignInConfigured = Boolean(webClientId);

type GoogleSignInModule = typeof import("@react-native-google-signin/google-signin");

let nativeModulePromise: Promise<GoogleSignInModule> | undefined;
let configured = false;

async function getGoogleSignInModule(): Promise<GoogleSignInModule> {
  nativeModulePromise ??= import("@react-native-google-signin/google-signin").catch(
    (error: unknown) => {
      nativeModulePromise = undefined;
      if (error instanceof Error && error.message.includes("RNGoogleSignin")) {
        throw new Error(
          "Google sign-in is unavailable in this app build. Rebuild the BrainDump development client with `npm run android` or `npm run ios`, then restart Metro with `npm run start`.",
        );
      }
      throw error;
    },
  );

  const googleSignIn = await nativeModulePromise;
  if (webClientId && !configured) {
    googleSignIn.GoogleSignin.configure({
      webClientId,
      ...(iosClientId ? { iosClientId } : {}),
    });
    configured = true;
  }
  return googleSignIn;
}

export async function signInWithGoogle(): Promise<string | undefined> {
  if (!webClientId) {
    throw new Error(
      "Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in mobile/.env.local.",
    );
  }

  const { GoogleSignin, isSuccessResponse } = await getGoogleSignInModule();
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
  const { GoogleSignin } = await getGoogleSignInModule();
  await GoogleSignin.signOut();
}
