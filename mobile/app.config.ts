import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const iosUrlScheme = iosClientId
    ? `com.googleusercontent.apps.${iosClientId.split(".")[0]}`
    : undefined;
  const plugins: NonNullable<ExpoConfig["plugins"]> = [
    "expo-router",
    ["expo-secure-store", { configureAndroidBackup: true }],
    "expo-sharing",
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "BrainDump uses the microphone while you hold the capture button.",
        speechRecognitionPermission:
          "BrainDump uses speech recognition to fill in your capture.",
        androidSpeechServicePackages: [
          "com.google.android.googlequicksearchbox",
          "com.google.android.tts",
        ],
      },
    ],
  ];

  if (iosUrlScheme) {
    plugins.push([
      "@react-native-google-signin/google-signin",
      { iosUrlScheme },
    ]);
  }

  return {
    ...config,
    name: "BrainDump",
    slug: "braindump-mobile",
    version: "0.1.0",
    scheme: "braindump",
    orientation: "portrait",
    userInterfaceStyle: "light",
    ios: {
      ...config.ios,
      bundleIdentifier: "com.braindump.mobile",
      supportsTablet: false,
    },
    android: {
      ...config.android,
      package: "com.braindump.mobile",
    },
    plugins,
    experiments: {
      ...config.experiments,
      typedRoutes: true,
    },
  };
};
