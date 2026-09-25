"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Each open tab holds one small WebSocket to the presence worker
// (workers/presence), so the operator's dashboard counts exactly who is on the
// site right now. It sends only the path, whether the tab is in view, desktop
// or mobile, and the referring site. It opens once the page is idle, never
// retries hard, and closes on pagehide so the back/forward cache still works.

const PRESENCE_URL = process.env.NEXT_PUBLIC_PRESENCE_URL?.replace(/\/$/, "");
const PING_MS = 30_000;
const MAX_FAILURES = 6;

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

export function LivePresence() {
  const pathname = usePathname();
  const path = useRef(pathname);
  const socket = useRef<WebSocket | null>(null);
  const reopen = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!PRESENCE_URL) return;
    let stopped = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const visible = () => (document.visibilityState === "visible" ? "1" : "0");
    const send = (message: string) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(message);
    };

    const open = () => {
      if (stopped || socket.current || skipped(path.current)) return;
      const params = new URLSearchParams({
        p: path.current,
        v: visible(),
        d: isMobile() ? "m" : "d",
        r: document.referrer,
      });
      const ws = new WebSocket(`${PRESENCE_URL}/v?${params.toString()}`);
      socket.current = ws;
      ws.onopen = () => {
        failures = 0;
      };
      ws.onclose = (event) => {
        if (socket.current === ws) socket.current = null;
        if (stopped || event.code === 1000) return;
        failures += 1;
        if (failures > MAX_FAILURES) return;
        retry = setTimeout(open, Math.min(60_000, 2_000 * 2 ** failures));
      };
    };

    reopen.current = open;

    const close = () => {
      clearTimeout(retry);
      socket.current?.close(1000);
      socket.current = null;
    };
    const onVisibility = () => send(`v:${visible()}`);
    const onPageHide = () => {
      stopped = true;
      close();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      stopped = false;
      open();
    };

    if ("requestIdleCallback" in window)
      window.requestIdleCallback(open, { timeout: 5_000 });
    else setTimeout(open, 1_500);
    const ping = setInterval(() => send("ping"), PING_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stopped = true;
      clearInterval(ping);
      close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    const leftSkipped = skipped(path.current) && !skipped(pathname);
    path.current = pathname;
    if (!socket.current) {
      if (leftSkipped) reopen.current();
      return;
    }
    if (skipped(pathname)) {
      socket.current.close(1000);
      socket.current = null;
    } else if (socket.current.readyState === WebSocket.OPEN) {
      socket.current.send(`p:${pathname}`);
    }
  }, [pathname]);

  return null;
}
