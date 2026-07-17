"use client";

import { useSyncExternalStore } from "react";

const subscribeToHydration = () => () => undefined;

export function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}
