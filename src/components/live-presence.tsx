"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Each open tab holds one small WebSocket to the presence worker
// (workers/presence), so the operator's dashboard counts exactly who is on the
// site right now. It sends only the path, whether the tab is in view, desktop
// or mobile, the referring site, the browser's time zone setting, and a random
// id this browser keeps so several tabs count as one person.
//
// It opens once the page is idle and has been in view (a tab opened in the
// background never counts, so it waits until someone looks at it), retries
// gently with random spacing (so a worker deploy does not bring every tab
// back at once), skips automated browsers, and closes on pagehide so the
// back/forward cache still works.
//
// Paths are sent as they are, repository pages included. Whether a
// repository is private is not known here cheaply (the GitHub token is
// HttpOnly), so a private repository viewed with the visitor's own token
// shows by name on the operator's dashboard (and only there).

const PRESENCE_URL = process.env.NEXT_PUBLIC_PRESENCE_URL?.replace(/\/$/, "");
const PING_MS = 30_000;
const MAX_FAILURES = 6;
const STORAGE_KEY = "gd-presence-id";
const ID = /^[a-z0-9]{8,24}$/;

function isMobile(): boolean {
  const data = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  if (typeof data?.mobile === "boolean" && data.mobile) return true;
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  );
}

const skipped = (path: string) => path.startsWith("/admin");

let memoryId: string | null = null;

/**
 * A random id shared by this browser's tabs; nothing else is stored. Where
 * localStorage is blocked, the tab keeps one for itself (for its reloads, in
 * sessionStorage, or for its life), so it is at least one person, not one per
 * reconnect.
 */
function browserId(): string {
  const fresh = () =>
    crypto
      .getRandomValues(new Uint32Array(3))
      .reduce((id, part) => id + part.toString(36), "")
      .slice(0, 16);
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      const stored = storage.getItem(STORAGE_KEY);
      if (stored && ID.test(stored)) return stored;
      const id = memoryId ?? fresh();
      storage.setItem(STORAGE_KEY, id);
      memoryId = id;
      return id;
    } catch {
      // Blocked: try the next place.
    }
  }
  memoryId ??= fresh();
  return memoryId;
}

export function LivePresence() {
  const pathname = usePathname();
  const path = useRef(pathname);
  const socket = useRef<WebSocket | null>(null);
  // Set by the effect below: open now if we may, or report a new page.
  const control = useRef<{ open: () => void; revive: () => void } | null>(null);

  useEffect(() => {
    if (!PRESENCE_URL || navigator.webdriver) return;
    let stopped = false;
    let ready = false; // the page went idle once
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const visible = () => (document.visibilityState === "visible" ? "1" : "0");
    const send = (message: string) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(message);
    };

    const open = () => {
      clearTimeout(retry);
      if (stopped || !ready || socket.current || skipped(path.current)) return;
      if (visible() !== "1") return; // the visibility handler opens it later
      const sent = { p: path.current, v: visible() };
      const params = new URLSearchParams({
        ...sent,
        d: isMobile() ? "m" : "d",
        r: document.referrer,
        b: browserId(),
        z: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      });
      const ws = new WebSocket(`${PRESENCE_URL}/v?${params.toString()}`);
      socket.current = ws;
      ws.onopen = () => {
        failures = 0;
        // Pages and visibility that changed while connecting.
        if (path.current !== sent.p && !skipped(path.current))
          ws.send(`p:${path.current}`);
        if (visible() !== sent.v) ws.send(`v:${visible()}`);
      };
      ws.onclose = (event) => {
        if (socket.current === ws) socket.current = null;
        if (stopped) return;
        // The worker closes a tab that went quiet (a frozen background tab):
        // come back as soon as someone looks at it again.
        if (event.code === 1000 && visible() !== "1") return;
        failures += 1;
        if (failures > MAX_FAILURES) return;
        const wait = Math.min(60_000, 2_000 * 2 ** failures);
        retry = setTimeout(open, wait * (0.5 + Math.random()));
      };
    };

    control.current = {
      open,
      // Someone is using the tab again: start over if retries ran out.
      revive() {
        if (socket.current) return;
        failures = 0;
        open();
      },
    };

    const close = () => {
      clearTimeout(retry);
      socket.current?.close(1000);
      socket.current = null;
    };
    const onVisibility = () => {
      if (socket.current) send(`v:${visible()}`);
      else if (visible() === "1") control.current?.revive();
    };
    const onPageHide = () => {
      stopped = true;
      close();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      stopped = false;
      open();
    };
    const onIdle = () => {
      ready = true;
      open();
    };

    if ("requestIdleCallback" in window)
      window.requestIdleCallback(onIdle, { timeout: 5_000 });
    else setTimeout(onIdle, 1_500);
    const ping = setInterval(() => send("ping"), PING_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stopped = true;
      control.current = null;
      clearInterval(ping);
      close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    path.current = pathname;
    const ws = socket.current;
    if (!ws) {
      control.current?.revive();
      return;
    }
    if (skipped(pathname)) {
      ws.close(1000);
      socket.current = null;
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(`p:${pathname}`);
    }
    // Still connecting: the socket sends the new path once it opens.
  }, [pathname]);

  return null;
}
