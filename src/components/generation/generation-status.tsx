"use client";

import { useEffect, useState } from "react";
import { GENERATION_STEPS } from "./progress";

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

export function GenerationSteps({ step }: { step: number }) {
  return (
    <ol aria-label="Generation progress">
      {GENERATION_STEPS.map((label, index) => (
        <li
          key={label}
          data-state={
            index < step ? "done" : index === step ? "active" : "pending"
          }
          aria-current={index === step ? "step" : undefined}
        >
          {label}
          <span className="sr-only">
            {index < step
              ? " — completed"
              : index === step
                ? " — in progress"
                : " — not started"}
          </span>
        </li>
      ))}
    </ol>
  );
}
