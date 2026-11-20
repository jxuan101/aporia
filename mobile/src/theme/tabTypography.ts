import { Platform, StyleSheet } from "react-native";

export const tabTypography = StyleSheet.create({
  eyebrow: {
    color: "#68746B",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  title: {
    color: "#24342A",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "Georgia",
    }),
    fontSize: 36,
    fontWeight: "600",
    lineHeight: 43,
    marginTop: 10,
    maxWidth: 340,
  },
  subtitle: {
    color: "#59645C",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
    maxWidth: 420,
  },
});
