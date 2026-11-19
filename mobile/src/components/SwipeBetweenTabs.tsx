import { useMemo, type ReactNode } from "react";
import { PanResponder, View } from "react-native";
import { router, usePathname } from "expo-router";

const TAB_ROUTES = ["/home", "/", "/items", "/profile"] as const;

function routeIndex(pathname: string): number {
  if (pathname === "/home") return 0;
  if (pathname === "/") return 1;
  if (pathname === "/items" || pathname.startsWith("/items/")) return 2;
  if (pathname === "/profile") return 3;
  return -1;
}

export function SwipeBetweenTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 36 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 75) return;
          const currentIndex = routeIndex(pathname);
          if (currentIndex < 0) return;
          const nextIndex = currentIndex + (gesture.dx < 0 ? 1 : -1);
          const nextRoute = TAB_ROUTES[nextIndex];
          if (nextRoute) router.replace(nextRoute);
        },
      }),
    [pathname],
  );

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}
