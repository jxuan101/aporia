import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AporiaHeader } from "../../components/AporiaHeader";
import { tabTypography } from "../../theme/tabTypography";

export default function HomeScreen() {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <AporiaHeader />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={tabTypography.eyebrow}>HOME</Text>
        <Text accessibilityRole="header" style={tabTypography.title}>Make room to think.</Text>
        <Text style={tabTypography.subtitle}>
          Capture what is on your mind, then return when you are ready to organize it.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/quick-capture")}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>Capture a thought</Text>
        </Pressable>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Daily review</Text>
          <Text style={styles.body}>Pick up unfinished processing and suggestions awaiting a decision.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/review")} style={styles.action}>
            <Text style={styles.actionText}>Review captures</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F6F4EE", flex: 1 },
  content: { padding: 20, paddingBottom: 30 },
  body: { color: "#59645C", fontSize: 15, lineHeight: 23, marginTop: 8 },
  primaryButton: { alignItems: "center", backgroundColor: "#2F4636", borderRadius: 14, justifyContent: "center", minHeight: 54, marginTop: 26 },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderColor: "#E5E3DA", borderRadius: 16, borderWidth: 1, marginTop: 18, padding: 17 },
  cardTitle: { color: "#24342A", fontSize: 18, fontWeight: "700" },
  action: { alignSelf: "flex-start", justifyContent: "center", minHeight: 42, marginTop: 8 },
  actionText: { color: "#53685A", fontSize: 14, fontWeight: "700" },
});
