import { Platform, StyleSheet, Text, View } from "react-native";

export function AporiaHeader() {
  return (
    <View style={styles.header}>
      <View style={styles.mark}>
        <Text style={styles.markText}>A</Text>
      </View>
      <Text style={styles.name}>Aporia</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    borderBottomColor: "#E5E3DA",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  mark: {
    alignItems: "center",
    backgroundColor: "#D66B4D",
    borderRadius: 12,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  markText: { color: "#FFFFFF", fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }), fontSize: 24, fontWeight: "700", lineHeight: 28 },
  name: { color: "#24342A", fontFamily: "Georgia", fontSize: 20, fontWeight: "700" },
});
