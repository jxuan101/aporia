import { usePathname, router } from "expo-router";
import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SwipeBetweenTabs } from "../../components/SwipeBetweenTabs";

type TabName = "home" | "inbox" | "saved" | "profile";

function TabButton({
  name,
  label,
  icon,
  selected,
}: {
  name: TabName;
  label: string;
  icon: string;
  selected: boolean;
}) {
  return (
    <TabTrigger name={name} style={styles.tabButton}>
      <Text style={[styles.tabIcon, selected && styles.selectedTabText]}>{icon}</Text>
      <Text style={[styles.tabLabel, selected && styles.selectedTabText]}>
        {label}
      </Text>
    </TabTrigger>
  );
}

function BottomBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const selected = (name: TabName) => {
    if (name === "home") return pathname === "/home";
    if (name === "inbox") return pathname === "/";
    if (name === "saved") return pathname === "/items" || pathname.startsWith("/items/");
    return pathname === "/profile";
  };

  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 4) }]}>
      <TabButton icon="⌂" label="Home" name="home" selected={selected("home")} />
      <TabButton icon="▤" label="Inbox" name="inbox" selected={selected("inbox")} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick capture with voice or text"
        onPress={() => router.push("/quick-capture")}
        style={({ pressed }) => [styles.captureTab, pressed && styles.pressed]}
      >
        <Text style={styles.captureTabIcon}>🎙️</Text>
      </Pressable>
      <TabButton icon="▣" label="Saved" name="saved" selected={selected("saved")} />
      <TabButton icon="○" label="Profile" name="profile" selected={selected("profile")} />
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs>
      <SwipeBetweenTabs>
        <TabSlot style={styles.slot} />
      </SwipeBetweenTabs>
      <BottomBar />
      <TabList style={styles.routeList}>
        <TabTrigger name="home" href="/home" />
        <TabTrigger name="inbox" href="/" />
        <TabTrigger name="saved" href="/items" />
        <TabTrigger name="profile" href="/profile" />
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  routeList: { display: "none" },
  bottomBar: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderTopColor: "#E5E3DA",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-around",
    minHeight: 66,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  tabButton: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 52,
  },
  tabIcon: { color: "#7A857C", fontSize: 20, lineHeight: 25 },
  tabLabel: { color: "#68746B", fontSize: 10, fontWeight: "600" },
  selectedTabText: { color: "#2F4636" },
  captureTab: {
    alignItems: "center",
    backgroundColor: "#2F4636",
    borderColor: "#FFFFFF",
    borderRadius: 29,
    borderWidth: 4,
    height: 58,
    justifyContent: "center",
    marginHorizontal: 5,
    marginTop: -23,
    width: 58,
  },
  captureTabIcon: {
    color: "#FFFFFF",
    fontSize: 25,
  },
  pressed: { opacity: 0.75 },
});
