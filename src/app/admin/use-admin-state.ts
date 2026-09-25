"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminState, LiveControls } from "~/features/admin/types";

// The dashboard's polled state (switches, today's budgets, balances, the
// presence token) and the switches' changes. Reads can overlap: the 5 s
// poll, a re-read when an event moves a counter, and one after each change.
// Only the newest read may land, so a slow older response never puts back a
// switch that was just flipped, and the poll skips a beat while a read or a
// change is under way. Live events that move a counter ask for a re-read
// too (refreshSoon), at most one every couple of seconds however busy the
// site is.

const POLL_MS = 5_000;
// A read that hangs would otherwise hold up every poll after it.
const READ_TIMEOUT_MS = 10_000;
const EVENT_READ_DELAY_MS = 250;
const EVENT_READ_EVERY_MS = 2_000;

/** Signed out (or signed out everywhere): back to the sign-in form. */
const backToSignIn = () => window.location.reload();

export function useAdminState() {
  const [state, setState] = useState<AdminState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const issued = useRef(0);
  const reading = useRef(0);
  const changing = useRef(0);
  const latest = useRef(state);
  const soon = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSoon = useRef(0);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  const refresh = useCallback(async ({ poll = false } = {}) => {
    if (poll && (reading.current > 0 || changing.current > 0)) return;
    const id = ++issued.current;
    reading.current += 1;
    // Covers reading the body too, so it is cleared only once that is done.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), READ_TIMEOUT_MS);
    try {
      const response = await fetch("/api/admin/state", {
        cache: "no-store",
        signal: timeout.signal,
      }).catch(() => null);
      if (id !== issued.current) return;
      if (response?.status === 401) {
        backToSignIn();
        return;
      }
      if (!response?.ok) return;
      const next = (await response
        .json()
        .catch(() => null)) as AdminState | null;
      if (next && id === issued.current) setState(next);
    } finally {
      clearTimeout(timer);
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
      clearTimeout(soon.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /**
   * Re-read shortly, because something moved a counter. Calls that come while
   * one is waiting join it, and one runs at most every couple of seconds.
   */
  const refreshSoon = useCallback(() => {
    if (soon.current !== undefined) return;
    const wait = Math.max(
      EVENT_READ_DELAY_MS,
      lastSoon.current + EVENT_READ_EVERY_MS - Date.now(),
    );
    soon.current = setTimeout(() => {
      soon.current = undefined;
      lastSoon.current = Date.now();
      void refresh();
    }, wait);
  }, [refresh]);

  /** Show part of the state the server just sent back, ahead of the next read. */
  const apply = useCallback((patch: Partial<AdminState>) => {
    issued.current += 1; // Reads already on their way predate it.
    setState((current) => (current ? { ...current, ...patch } : current));
  }, []);

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
      if (response?.status === 401) {
        backToSignIn();
        return "Signed out. Sign in again.";
      }
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

  return { state, saving, saveError, refresh, refreshSoon, apply, change };
}
