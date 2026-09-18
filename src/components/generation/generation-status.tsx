"use client";

import { useEffect, useState } from "react";

export function useGenerationClock({
  running,
  paused,
  startedAt,
  value,
}: {
  running: boolean;
  paused: boolean;
  startedAt?: number;
  value?: number;
}) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || paused) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, paused]);
  return {
    now,
    seconds: Math.max(
      0,
      Math.floor(value ?? (now - (startedAt ?? mountedAt)) / 1000),
    ),
  };
}
