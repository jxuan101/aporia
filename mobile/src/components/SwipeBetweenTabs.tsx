import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, useWindowDimensions } from "react-native";
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
  const { width } = useWindowDimensions();
  const [slideX] = useState(() => new Animated.Value(0));
  const previousIndex = useRef(routeIndex(pathname));

  useLayoutEffect(() => {
    const nextIndex = routeIndex(pathname);
    const oldIndex = previousIndex.current;
    previousIndex.current = nextIndex;
    if (nextIndex < 0 || oldIndex < 0 || nextIndex === oldIndex) return;

    slideX.stopAnimation();
    slideX.setValue(nextIndex > oldIndex ? width : -width);
    Animated.timing(slideX, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pathname, slideX, width]);

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
    <Animated.View
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={{ flex: 1, transform: [{ translateX: slideX }] }}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}
