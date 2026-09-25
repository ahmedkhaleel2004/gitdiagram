"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import type {
  LiveFeedEvent,
  LiveJob,
  LiveVisitor,
  PresenceMessage,
} from "~/features/admin/types";

// The dashboard's side of the presence worker: one socket that is pushed every
// visitor arriving, moving and leaving, every running job and every event, as
// it happens. Nothing here polls.

const KEPT_EVENTS = 200;
const HISTORY_POINTS = 600; // ten minutes, one point a second
const PING_MS = 5_000;

interface LiveSite {
  visitors: Record<string, LiveVisitor>;
  events: LiveFeedEvent[];
  jobs: LiveJob[];
  peak: { day: string; count: number; at: number } | null;
}

const EMPTY: LiveSite = { visitors: {}, events: [], jobs: [], peak: null };

function reduce(site: LiveSite, message: PresenceMessage): LiveSite {
  switch (message.type) {
    case "snapshot":
      return {
        visitors: Object.fromEntries(message.visitors.map((v) => [v.id, v])),
        events: message.events.slice(0, KEPT_EVENTS),
        jobs: message.jobs,
        peak: message.peak,
      };
    case "join":
      return {
        ...site,
        visitors: { ...site.visitors, [message.visitor.id]: message.visitor },
      };
    case "update": {
      const visitor = site.visitors[message.id];
      if (!visitor) return site;
      return {
        ...site,
        visitors: {
          ...site.visitors,
          [message.id]: {
            ...visitor,
            ...(message.p !== undefined ? { p: message.p } : {}),
            ...(message.v !== undefined ? { v: message.v } : {}),
          },
        },
      };
    }
    case "leave": {
      if (!site.visitors[message.id]) return site;
      const visitors = { ...site.visitors };
      delete visitors[message.id];
      return { ...site, visitors };
    }
    case "event":
      if (site.events.some((event) => event.id === message.event.id))
        return site;
      return {
        ...site,
        events: [message.event, ...site.events].slice(0, KEPT_EVENTS),
      };
    case "jobs":
      return { ...site, jobs: message.jobs };
    case "peak":
      return { ...site, peak: message.peak };
  }
}

export type LinkStatus = "connecting" | "live" | "offline";

export function useLiveSite(
  presence: { url: string; token: string } | null,
  onEvent: (event: LiveFeedEvent) => void,
) {
  const [site, dispatch] = useReducer(reduce, EMPTY);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const token = useRef(presence);
  const handler = useRef(onEvent);
  const count = useRef(0);
  const url = presence?.url ?? null;

  useEffect(() => {
    token.current = presence;
    handler.current = onEvent;
  });

  useEffect(() => {
    count.current = Object.keys(site.visitors).length;
  }, [site.visitors]);

  useEffect(() => {
    if (!url) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pingSentAt = 0;

    const connect = () => {
      const current = token.current;
      if (stopped || !current) return;
      setStatus("connecting");
      const ws = new WebSocket(
        `${current.url}/admin?t=${encodeURIComponent(current.token)}`,
      );
      socket = ws;
      ws.onopen = () => setStatus("live");
      ws.onmessage = (message) => {
        if (message.data === "pong") {
          if (pingSentAt)
            setLatency(Math.round(performance.now() - pingSentAt));
          return;
        }
        try {
          const parsed = JSON.parse(String(message.data)) as PresenceMessage;
          dispatch(parsed);
          if (parsed.type === "event") handler.current(parsed.event);
        } catch {
          // Not ours.
        }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        setStatus("offline");
        setLatency(null);
        if (!stopped) retry = setTimeout(connect, 1_000);
      };
    };

    connect();
    const ping = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      pingSentAt = performance.now();
      socket.send("ping");
    }, PING_MS);
    const sample = setInterval(() => {
      setHistory((points) => [...points, count.current].slice(-HISTORY_POINTS));
    }, 1_000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      clearInterval(sample);
      socket?.close(1000);
    };
  }, [url]);

  return { ...site, status, latency, history };
}
