"use client";

import { useEffect, useState } from "react";

import { since } from "~/features/admin/format";
import type { LinkStatus } from "./use-live-site";

// Building blocks the dashboard's panels share.

export const number = new Intl.NumberFormat("en-US");

/** Small buttons grow to a finger-sized target on touch screens. */
export const TOUCH = "pointer-coarse:h-11";

export function Panel({
  title,
  aside,
  className = "",
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`neo-panel min-w-0 rounded-lg p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold tracking-wide uppercase">{title}</h2>
        {aside ? (
          <div className="text-xs text-[hsl(var(--neo-soft-text))]">
            {aside}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Tile({
  label,
  value,
  sub,
  meter,
  action,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  meter?: number | null;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border-2 border-black bg-white/70 p-3 dark:bg-black/20">
      <div className="text-xs font-semibold text-[hsl(var(--neo-soft-text))]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {typeof meter === "number" ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className={`h-full rounded-full ${meter >= 0.9 ? "bg-red-500" : "bg-purple-500"}`}
            style={{ width: `${Math.min(100, Math.round(meter * 100))}%` }}
          />
        </div>
      ) : null}
      {sub ? (
        <div className="mt-1 text-xs text-[hsl(var(--neo-soft-text))]">
          {sub}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function BarList({ rows }: { rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  if (!rows.length)
    return (
      <p className="text-sm text-[hsl(var(--neo-soft-text))]">Nobody yet.</p>
    );
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([label, count]) => (
        <li key={label} className="relative flex items-center gap-2 text-sm">
          <div
            className="absolute inset-y-0 left-0 rounded-sm bg-purple-400/35 dark:bg-purple-400/20"
            style={{ width: `${(count / max) * 100}%` }}
          />
          <span className="relative min-w-0 flex-1 truncate px-1.5 py-0.5 font-mono text-[13px]">
            {label}
          </span>
          <span className="relative w-10 shrink-0 text-right font-semibold tabular-nums">
            {count}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatusPill({
  status,
  latency,
}: {
  status: LinkStatus;
  latency: number | null;
}) {
  const tone =
    status === "live"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-amber-400"
        : "bg-red-500";
  const label =
    status === "live"
      ? `Live${latency !== null ? ` · ${latency} ms` : ""}`
      : status === "connecting"
        ? "Connecting"
        : "Reconnecting";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-3 py-1 text-sm font-semibold dark:bg-black/30">
      <span className={`relative h-2.5 w-2.5 rounded-full ${tone}`}>
        {status === "live" ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:hidden" />
        ) : null}
      </span>
      {label}
    </span>
  );
}

/** The current time, ticking every `ms` for as long as it is shown. */
function useNow(ms = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(tick);
  }, [ms]);
  return now;
}

/** "5m 3s" since a moment, kept current on its own. */
export function Since({ ms }: { ms: number }) {
  return <>{since(ms, useNow())}</>;
}
