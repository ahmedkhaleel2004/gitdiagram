"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  EMPTY_SITE,
  isProtocolMismatch,
  isTokenFresh,
  reconnectDelay,
  reduceSite,
} from "~/features/admin/live-link";
import {
  ADMIN_PROTOCOL,
  tokenExpiry,
} from "~/features/admin/presence-protocol";
import type { LiveFeedEvent, PresenceMessage } from "~/features/admin/types";

// The dashboard's side of the presence worker: one socket that is pushed every
// visitor arriving, moving and leaving, every running job and every event, as
// it happens. Nothing here polls.
//
// The socket's token is short-lived and comes with the dashboard's polled
// state. A dropped socket reconnects with growing, jittered waits, never
// while the tab is hidden (it comes back when the tab is shown), and asks for
// a fresh token instead of retrying with one that has expired. The token
// travels as a WebSocket subprotocol, so it stays out of request logs; newer
// ones are sent over the open socket so it is not cut off when the first one
// expires. Tokens last under a minute (so signing out cuts the socket off
// quickly), and a hidden dashboard does not poll, so it asks for one itself
// when the one it holds is running out.

const PING_MS = 5_000;
// No pong this long after a ping: the connection died without closing (the
// laptop slept, the network changed). Timers in background tabs can be
// slowed to once a minute, so this is measured from the ping itself.
const PONG_TIMEOUT_MS = 2 * PING_MS + 2_000;
// Every poll brings a new token; the open socket is handed one only when the
// token it holds has less than this left (tokens last 45 s), so about every
// fifteen seconds.
const RENEW_BEFORE_MS = 30_000;

export type LinkStatus = "connecting" | "live" | "offline";

export function useLiveSite(
  presence: { url: string; token: string } | null,
  {
    onEvent,
    onTokenNeeded,
  }: {
    onEvent: (event: LiveFeedEvent) => void;
    /** Ask for a fresh token (the dashboard re-reads its state). */
    onTokenNeeded: () => void;
  },
) {
  const [site, dispatch] = useReducer(reduceSite, EMPTY_SITE);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const latest = useRef({ presence, onEvent, onTokenNeeded });
  // Hooks for the token effect below into the running connection.
  const link = useRef<{ tokenChanged: () => void } | null>(null);
  const url = presence?.url ?? null;
  const token = presence?.token ?? null;

  useEffect(() => {
    latest.current = { presence, onEvent, onTokenNeeded };
  });

  useEffect(() => {
    if (!url) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    // The expired token a fresh one was asked for in place of, if any.
    let waitingForToken: string | null = null;
    let sentToken: string | null = null;
    let pingSentAt = 0;
    let awaitingPong = false;

    const hidden = () => document.visibilityState === "hidden";

    const retryLater = () => {
      clearTimeout(retry);
      if (stopped || hidden()) return;
      retry = setTimeout(connect, reconnectDelay(failures));
      failures += 1;
    };

    const lost = (ws: WebSocket) => {
      if (socket !== ws) return;
      socket = null;
      awaitingPong = false;
      setStatus("offline");
      setLatency(null);
      retryLater();
    };

    function connect() {
      clearTimeout(retry);
      const current = latest.current.presence;
      if (stopped || socket || hidden() || !current) return;
      if (!isTokenFresh(current.token, Date.now())) {
        waitingForToken = current.token;
        latest.current.onTokenNeeded();
        return;
      }
      waitingForToken = null;
      setStatus("connecting");
      const ws = new WebSocket(`${current.url}/admin`, [
        ADMIN_PROTOCOL,
        current.token,
      ]);
      socket = ws;
      sentToken = current.token;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        failures = 0;
        setStatus("live");
      };
      ws.onmessage = (message) => {
        if (message.data === "pong") {
          awaitingPong = false;
          setLatency(Math.round(performance.now() - pingSentAt));
          return;
        }
        let parsed: PresenceMessage;
        try {
          parsed = JSON.parse(String(message.data)) as PresenceMessage;
        } catch {
          return; // Not ours.
        }
        dispatch({ message: parsed, at: Date.now() });
        if (parsed.type === "event") latest.current.onEvent(parsed.event);
      };
      ws.onclose = (event) => {
        // Refused before opening, or closed because the token ran out
        // (4001): the token may be the problem, so fetch a new one for the
        // next try.
        if (!opened || event.code === 4001) latest.current.onTokenNeeded();
        lost(ws);
      };
    }

    const ping = setInterval(() => {
      const ws = socket;
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (awaitingPong && performance.now() - pingSentAt > PONG_TIMEOUT_MS) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
        lost(ws);
        return;
      }
      // Nothing newer to hand over and the held token is running out (the
      // dashboard stops polling while hidden): ask for one.
      const left = (tokenExpiry(sentToken ?? "") ?? Infinity) - Date.now();
      if (
        left < RENEW_BEFORE_MS &&
        latest.current.presence?.token === sentToken
      )
        latest.current.onTokenNeeded();
      if (awaitingPong) return;
      awaitingPong = true;
      pingSentAt = performance.now();
      ws.send("ping");
    }, PING_MS);

    const onVisibility = () => {
      if (hidden()) return;
      failures = 0;
      connect();
    };

    link.current = {
      tokenChanged() {
        const current = latest.current.presence;
        if (!current) return;
        if (socket?.readyState === WebSocket.OPEN) {
          const left = (tokenExpiry(sentToken ?? "") ?? 0) - Date.now();
          if (current.token !== sentToken && left < RENEW_BEFORE_MS) {
            socket.send(`t:${current.token}`);
            sentToken = current.token;
          }
        } else if (waitingForToken && waitingForToken !== current.token) {
          connect();
        }
      },
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      link.current = null;
      clearTimeout(retry);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisibility);
      socket?.close(1000);
    };
  }, [url]);

  useEffect(() => {
    if (token) link.current?.tokenChanged();
  }, [token]);

  return {
    ...site,
    status,
    latency,
    /** The worker and this site speak different protocol versions. */
    protocolMismatch: isProtocolMismatch(site),
  };
}
