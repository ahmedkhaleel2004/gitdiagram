"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminState, LiveControls } from "~/features/admin/types";

// The dashboard's polled state (switches, today's budgets, balances, the
// presence token) and the switches' changes. Reads can overlap: the 5 s
// poll, a re-read when an event moves a counter, and one after each change.
// Only the newest read may land, so a slow older response never puts back a
// switch that was just flipped, and the poll skips a beat while a read or a
// change is under way.

const POLL_MS = 5_000;

export function useAdminState() {
  const [state, setState] = useState<AdminState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const issued = useRef(0);
  const reading = useRef(0);
  const changing = useRef(0);
  const latest = useRef(state);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  const refresh = useCallback(async ({ poll = false } = {}) => {
    if (poll && (reading.current > 0 || changing.current > 0)) return;
    const id = ++issued.current;
    reading.current += 1;
    try {
      const response = await fetch("/api/admin/state", {
        cache: "no-store",
      }).catch(() => null);
      if (id !== issued.current) return;
      if (response?.status === 401) {
        window.location.reload();
        return;
      }
      if (!response?.ok) return;
      const next = (await response
        .json()
        .catch(() => null)) as AdminState | null;
      if (next && id === issued.current) setState(next);
    } finally {
      reading.current -= 1;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh({ poll: true });
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /**
   * Flip switches now and save them. Returns the error to show, or null. On
   * failure only the switches this change touched go back (a change made
   * meanwhile is kept), then the state is re-read, since a failure after
   * the write (reading it back) still leaves the change saved.
   */
  const change = useCallback(
    async (patch: Partial<LiveControls>): Promise<string | null> => {
      changing.current += 1;
      issued.current += 1; // Reads already on their way predate this change.
      setSaving(true);
      setSaveError(null);
      const shown = latest.current?.controls;
      const before: Partial<LiveControls> = shown
        ? Object.fromEntries(
            Object.keys(patch).map((key) => [
              key,
              shown[key as keyof LiveControls],
            ]),
          )
        : {};
      setState((current) =>
        current
          ? { ...current, controls: { ...current.controls, ...patch } }
          : current,
      );
      const response = await fetch("/api/admin/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        controls?: LiveControls;
        error?: string;
      } | null;
      changing.current -= 1;
      issued.current += 1; // Nor may reads that started before it saved.
      let error: string | null = null;
      if (response?.ok && body?.controls) {
        const controls = body.controls;
        setState((current) => (current ? { ...current, controls } : current));
        void refresh();
      } else {
        setState((current) =>
          current
            ? { ...current, controls: { ...current.controls, ...before } }
            : current,
        );
        // Show the server's own words: a 503 can also mean the change was
        // saved but could not be read back. The re-read then shows which.
        error = body?.error ?? "The change did not save.";
        setSaveError(error);
        void refresh();
      }
      setSaving(changing.current > 0);
      return error;
    },
    [refresh],
  );

  return { state, saving, saveError, refresh, change };
}
