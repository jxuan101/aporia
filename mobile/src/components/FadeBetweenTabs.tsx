import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing } from "react-native";
import { usePathname } from "expo-router";

function routeIndex(pathname: string): number {
  if (pathname === "/home") return 0;
  if (pathname === "/") return 1;
  if (pathname === "/items" || pathname.startsWith("/items/")) return 2;
  if (pathname === "/profile") return 3;
  return -1;
}

export function FadeBetweenTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [opacity] = useState(() => new Animated.Value(1));
  const previousIndex = useRef(routeIndex(pathname));

  useEffect(() => {
    const nextIndex = routeIndex(pathname);
    if (nextIndex < 0 || previousIndex.current === nextIndex) return;
    previousIndex.current = nextIndex;
    opacity.stopAnimation();
    opacity.setValue(0.72);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity, pathname]);

  return (
    <Animated.View style={{ flex: 1, opacity }}>
      {children}
    </Animated.View>
  );
}
