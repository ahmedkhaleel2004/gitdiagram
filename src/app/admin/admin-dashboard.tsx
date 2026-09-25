"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import type {
  AdminState,
  LiveControls,
  LiveFeedEvent,
  LiveVisitor,
  VideoAudience,
} from "~/features/admin/types";
import { isLikelyVpn, peopleHere } from "~/features/admin/presence";
import { useLiveSite, type LinkStatus } from "./use-live-site";

// Counters (budgets, balances) are polled; everything about people and jobs is
// pushed over the live socket. Any event that moves a counter also triggers an
// immediate re-read, so the numbers change the moment something happens.
const POLL_MS = 5_000;

const number = new Intl.NumberFormat("en-US");
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function flag(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return "🌐";
  return String.fromCodePoint(
    ...[...country].map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

function since(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}

/** The early-access places, as the presence worker's geolocation names them. */
function isPriorityPlace(visitor: LiveVisitor): boolean {
  if (visitor.c === "US") return ["CA", "WA", "NY"].includes(visitor.r);
  if (visitor.c === "CA") return ["ON", "BC"].includes(visitor.r);
  return visitor.c === "GB" && /london/i.test(visitor.ct);
}

function tally<T>(items: T[], key: (item: T) => string, top: number) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = key(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top).reduce((sum, [, count]) => sum + count, 0);
  return [...sorted.slice(0, top), ["Other", rest] as [string, number]];
}

function Panel({
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

function Tile({
  label,
  value,
  sub,
  meter,
  action,
}: {
  label: string;
  value: string;
  sub?: string;
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

/**
 * Records the Claude credit balance the Console shows, after a top-up. The
 * dashboard then counts down from it using the organization's spend since.
 */
function SetClaudeCredit({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usd = Number(value.replace(/[$,\s]/g, ""));
  const valid = value.trim() !== "" && Number.isFinite(usd) && usd >= 0;

  async function save() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/claude-credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usd }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setBusy(false);
    if (response?.ok) {
      setOpen(false);
      setValue("");
      onDone();
    } else {
      setError(body?.error ?? "The balance was not saved. Try again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        setError(null);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="neo-button-muted h-8 rounded-md px-3 text-xs font-semibold"
      >
        Update balance
      </button>
      <DialogContent className="neo-panel max-w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Update the Claude balance
          </DialogTitle>
          <DialogDescription className="text-[hsl(var(--neo-soft-text))]">
            Anthropic has no API for the balance, so copy it from the{" "}
            <a
              href="https://platform.claude.com/settings/billing"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Console billing page
            </a>{" "}
            after each top-up. From then on, spend is taken off it every minute.
            Keep auto-reload off, or the number drifts low.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy) void save();
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Balance in the Console (USD)
            <input
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="50.46"
              className="h-11 rounded-md border-2 border-black bg-white px-3 text-base font-normal text-black tabular-nums"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="text-sm font-medium text-red-700 dark:text-red-400"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="neo-button-muted h-11 rounded-md px-4 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !valid}
              className="neo-button h-11 rounded-md px-4 font-semibold disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save balance"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Starts today's count over for everyone, after the operator confirms in a
 * dialog. Nothing changes until "Yes, reset" is pressed.
 */
function ResetUsage({
  target,
  used,
  onDone,
}: {
  target: "videos" | "renders";
  used: number;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = target === "videos" ? "videos" : "MP4 downloads";
  const counted =
    used === 1 ? (target === "videos" ? "video" : "MP4 download") : noun;

  async function reset() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setBusy(false);
    if (response?.ok) {
      setOpen(false);
      onDone();
    } else {
      setError(body?.error ?? "The reset did not go through. Try again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        setError(null);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="neo-button-muted h-8 rounded-md px-3 text-xs font-semibold"
      >
        Reset today&apos;s count
      </button>
      <DialogContent className="neo-panel max-w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Reset today&apos;s {noun}?
          </DialogTitle>
          <DialogDescription className="text-[hsl(var(--neo-soft-text))]">
            This sets today&apos;s {used} {counted} back to 0 and clears every
            person&apos;s and connection&apos;s count for today, so everyone can
            make {noun} again right away. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p
            role="alert"
            className="text-sm font-medium text-red-700 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="neo-button-muted h-11 rounded-md px-4 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void reset()}
            className="neo-button h-11 rounded-md px-4 font-semibold disabled:opacity-60"
          >
            {busy ? "Resetting…" : "Yes, reset"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const height = 72;
  if (points.length < 2)
    return (
      <div className="flex h-[72px] items-center text-xs text-[hsl(var(--neo-soft-text))]">
        Drawing the last ten minutes as they happen…
      </div>
    );
  const max = Math.max(1, ...points);
  const x = (index: number) => (index / (points.length - 1)) * width;
  const y = (value: number) => height - 4 - (value / max) * (height - 8);
  const line = points
    .map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`)
    .join(" ");
  const shown = hover ?? points.length - 1;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[72px] w-full"
        role="img"
        aria-label={`People here over the last ${points.length} seconds, peak ${max}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          setHover(Math.round(ratio * (points.length - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path
          d={`${line} L${width},${height} L0,${height} Z`}
          className="fill-purple-500/15"
        />
        <path
          d={line}
          fill="none"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="stroke-purple-600 dark:stroke-purple-400"
        />
        <line
          x1={x(shown)}
          x2={x(shown)}
          y1={0}
          y2={height}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className={
            hover === null
              ? "stroke-transparent"
              : "stroke-black/40 dark:stroke-white/40"
          }
        />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-[hsl(var(--neo-soft-text))] tabular-nums">
        <span>{Math.round(points.length / 60) || "<1"} min ago</span>
        <span>
          {hover === null
            ? "now"
            : `${points.length - 1 - hover}s ago: ${points[hover]} here`}
        </span>
      </div>
    </div>
  );
}

function BarList({ rows }: { rows: Array<[string, number]> }) {
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

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "Unknown";
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country on the site now; open one to see its cities. */
function CountryList({
  visitors,
  now,
}: {
  visitors: LiveVisitor[];
  now: number;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const countries = useMemo(() => {
    const byCountry = new Map<string, LiveVisitor[]>();
    for (const visitor of visitors) {
      const list = byCountry.get(visitor.c) ?? [];
      list.push(visitor);
      byCountry.set(visitor.c, list);
    }
    return [...byCountry.entries()]
      .map(([code, people]) => ({
        code,
        count: people.length,
        vpn: people.filter((person) => isLikelyVpn(person, now)).length,
        cities: tally(
          people,
          (v) => [v.ct, v.r].filter(Boolean).join(", ") || "Unknown",
          Number.POSITIVE_INFINITY,
        ),
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [visitors, now]);
  if (!countries.length)
    return (
      <p className="text-sm text-[hsl(var(--neo-soft-text))]">Nobody yet.</p>
    );
  const max = Math.max(1, countries[0]!.count);
  const toggle = (code: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  return (
    <ul className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto">
      {countries.map(({ code, count, vpn, cities }) => {
        const expanded = open.has(code);
        return (
          <li key={code || "unknown"}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(code)}
              className="relative flex w-full cursor-pointer items-center gap-2 text-left text-sm"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-purple-400/35 dark:bg-purple-400/20"
                style={{ width: `${(count / max) * 100}%` }}
              />
              <span className="relative min-w-0 flex-1 truncate px-1.5 py-0.5">
                <span className="mr-1.5">{flag(code)}</span>
                <span className="font-medium">{countryName(code)}</span>
                {vpn ? (
                  <span
                    className="ml-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                    title="Browser clock set to a different time zone from this location"
                  >
                    {vpn} likely VPN
                  </span>
                ) : null}
                <span className="ml-1.5 text-xs text-[hsl(var(--neo-soft-text))]">
                  {expanded ? "▾" : "▸"}
                </span>
              </span>
              <span className="relative w-12 shrink-0 text-right text-xs text-[hsl(var(--neo-soft-text))] tabular-nums">
                {Math.round((count / visitors.length) * 100)}%
              </span>
              <span className="relative w-8 shrink-0 text-right font-semibold tabular-nums">
                {count}
              </span>
            </button>
            {expanded ? (
              <ul className="mt-1 mb-1 ml-7 flex flex-col gap-0.5 border-l-2 border-black/15 pl-2 dark:border-white/15">
                {cities.map(([city, people]) => (
                  <li
                    key={city}
                    className="flex items-center justify-between gap-2 text-[13px]"
                  >
                    <span className="min-w-0 truncate">{city}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {people}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function StatusPill({
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

const AUDIENCES: Array<{ value: VideoAudience; label: string; hint: string }> =
  [
    {
      value: "priority",
      label: "Priority places",
      hint: "Any device in CA, WA, NY, Ontario, BC and London",
    },
    {
      value: "desktop",
      label: "All desktops",
      hint: "Priority places, plus any desktop",
    },
    { value: "everyone", label: "Everyone", hint: "Every device, anywhere" },
  ];

function LimitField({
  label,
  override,
  effective,
  onSave,
}: {
  label: string;
  override: number | null;
  effective: number | undefined;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const parsed = Number.parseInt(draft, 10);
  const valid = draft !== "" && Number.isSafeInteger(parsed) && parsed >= 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-semibold">{label}</div>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={draft}
          placeholder={effective === undefined ? "" : String(effective)}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
          className="neo-input h-10 w-24 rounded-md bg-white px-3 font-mono tabular-nums"
          aria-label={label}
        />
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onSave(parsed);
            setDraft("");
          }}
          className="neo-button h-10 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
        >
          Set
        </button>
        {override !== null ? (
          <button
            type="button"
            onClick={() => onSave(null)}
            className="neo-button-muted h-10 rounded-md px-3 text-sm font-semibold"
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="text-xs text-[hsl(var(--neo-soft-text))]">
        {override !== null
          ? "Set here, overriding the default"
          : "Default from the deployment"}
      </div>
    </div>
  );
}

/** Why a visitor could not make a video, in plain words. */
const HELD_BACK: Record<string, string> = {
  mobile: "On a phone or tablet",
  place: "Outside the priority places",
  audience: "Not in early access",
  paused: "Videos are paused",
  daily: "Today's video limit is used up",
  person: "They already made today's video",
  network: "Their connection hit its daily backstop",
  credits: "Voice credits are low",
};

function describe(event: LiveFeedEvent): {
  title: string;
  tone: string;
  detail: string;
} {
  const where = [event.city, event.region, event.country]
    .filter((part) => typeof part === "string" && part)
    .join(", ");
  const place = where ? `${flag(String(event.country ?? ""))} ${where}` : "";
  const seconds =
    typeof event.ms === "number" ? `${(event.ms / 1000).toFixed(1)}s` : "";
  const cost =
    typeof event.costUsd === "number" ? `$${event.costUsd.toFixed(3)}` : "";
  const outcome = String(event.outcome ?? "");
  const failed = outcome === "error";
  switch (event.kind) {
    case "diagram.started":
      return {
        title: "Diagram started",
        tone: "text-sky-700 dark:text-sky-300",
        detail: [place, event.ownKey ? "own key" : ""]
          .filter(Boolean)
          .join(" · "),
      };
    case "diagram.finished":
      return {
        title:
          outcome === "complete"
            ? "Diagram made"
            : outcome === "cancelled"
              ? "Diagram cancelled"
              : "Diagram failed",
        tone: failed
          ? "text-red-700 dark:text-red-400"
          : "text-green-700 dark:text-green-400",
        detail: [seconds, cost, failed ? String(event.errorCode ?? "") : ""]
          .filter(Boolean)
          .join(" · "),
      };
    case "video.started":
      return {
        title: "Video started",
        tone: "text-purple-700 dark:text-purple-300",
        detail: [place, event.operator ? "you" : ""]
          .filter(Boolean)
          .join(" · "),
      };
    case "video.finished":
      return {
        title: failed ? "Video failed" : "Video made",
        tone: failed
          ? "text-red-700 dark:text-red-400"
          : "text-green-700 dark:text-green-400",
        detail: seconds,
      };
    case "video.gated":
      return {
        title: "Video held back",
        tone: "text-amber-700 dark:text-amber-300",
        detail: [
          HELD_BACK[String(event.reason)] ?? String(event.reason ?? ""),
          event.step === "start" ? "after pressing Make the video" : "",
          place,
          String(event.device ?? ""),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "render.started":
      return {
        title: "MP4 started",
        tone: "text-purple-700 dark:text-purple-300",
        detail: String(event.format ?? ""),
      };
    case "render.finished":
      return {
        title: failed ? "MP4 failed" : "MP4 made",
        tone: failed
          ? "text-red-700 dark:text-red-400"
          : "text-green-700 dark:text-green-400",
        detail: [String(event.format ?? ""), seconds]
          .filter(Boolean)
          .join(" · "),
      };
    case "limits.reset":
      return {
        title: "Count reset",
        tone: "text-[hsl(var(--foreground))]",
        detail: `Today's ${event.target === "renders" ? "MP4s" : "videos"} started over (${String(event.cleared ?? 0)} counters cleared)`,
      };
    case "control.changed":
      return {
        title: "Setting changed",
        tone: "text-[hsl(var(--foreground))]",
        detail: JSON.stringify(event.changes ?? {})
          .replace(/[{}"]/g, "")
          .replace(/,/g, ", "),
      };
    case "admin.signed_in":
      return { title: "You signed in", tone: "", detail: place };
    case "admin.sign_in_failed":
      return {
        title: "Failed sign-in",
        tone: "text-red-700 dark:text-red-400",
        detail: place,
      };
    default:
      return { title: event.kind, tone: "", detail: String(event.note ?? "") };
  }
}

const COUNTER_KINDS = /^(video|render|diagram\.finished|control|limits)/;

export function AdminDashboard() {
  const [state, setState] = useState<AdminState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/state", {
      cache: "no-store",
    }).catch(() => null);
    if (response?.status === 401) {
      window.location.reload();
      return;
    }
    if (response?.ok) setState((await response.json()) as AdminState);
  }, []);

  const onEvent = useCallback(
    (event: LiveFeedEvent) => {
      if (!COUNTER_KINDS.test(event.kind)) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 250);
    },
    [refresh],
  );

  const live = useLiveSite(state?.presence ?? null, onEvent);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Open tabs, including background tabs nobody is looking at.
  const tabs = useMemo(() => Object.values(live.visitors), [live.visitors]);
  // People here now: one per browser, with a tab in view or seen in the last
  // two minutes. Everything below counts these people, not tabs.
  const visitors = useMemo(() => peopleHere(tabs, now), [tabs, now]);
  const inView = visitors.filter((visitor) => visitor.v === 1).length;
  const withTabOpen = new Set(tabs.map((tab) => tab.b)).size;
  const mobile = visitors.filter((visitor) => visitor.d === "m").length;
  const priority = visitors.filter(isPriorityPlace).length;
  // Browser clock in a different time zone from the IP address's location.
  const vpnCount = visitors.filter((v) => isLikelyVpn(v, now)).length;
  const pages = useMemo(() => tally(visitors, (v) => v.p, 8), [visitors]);
  const countryCount = new Set(visitors.map((v) => v.c)).size;
  const sources = useMemo(
    () =>
      tally(
        visitors,
        (v) => (!v.ref || /gitdiagram\.com$/.test(v.ref) ? "Direct" : v.ref),
        6,
      ),
    [visitors],
  );

  async function change(patch: Partial<LiveControls>) {
    if (!state) return;
    setSaving(true);
    setSaveError(null);
    const previous = state.controls;
    setState({ ...state, controls: { ...state.controls, ...patch } });
    const response = await fetch("/api/admin/controls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      controls?: LiveControls;
      error?: string;
    } | null;
    if (response?.ok && body?.controls) {
      const controls = body.controls;
      setState((current) => (current ? { ...current, controls } : current));
      void refresh();
    } else {
      setState((current) =>
        current ? { ...current, controls: previous } : current,
      );
      setSaveError(body?.error ?? "The change did not save.");
    }
    setSaving(false);
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => null);
    window.location.reload();
  }

  const controls = state?.controls;
  const video = state?.video;
  const quota = state?.diagramQuota;
  const credit = state?.claudeCredit;
  const creditSet = credit?.setUsd != null && credit.setAt != null;
  const running = {
    diagram: live.jobs.filter((job) => job.kind === "diagram").length,
    video: live.jobs.filter((job) => job.kind === "video").length,
    render: live.jobs.filter((job) => job.kind === "render").length,
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Live</h1>
          <StatusPill
            status={state?.presence ? live.status : "offline"}
            latency={live.latency}
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-[hsl(var(--neo-soft-text))]">
          {state?.deployment.commit ? (
            <span className="font-mono">
              {state.deployment.commit}
              {state.deployment.region ? ` · ${state.deployment.region}` : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void signOut()}
            className="neo-button-muted h-9 rounded-md px-3 text-sm font-semibold"
          >
            Sign out
          </button>
        </div>
      </header>

      {state && !state.presence ? (
        <p className="rounded-md border-2 border-black bg-amber-100 p-3 text-sm text-black">
          Live presence is not set up here (NEXT_PUBLIC_PRESENCE_URL and
          PRESENCE_SECRET). Counters and switches still work.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          title="People here now"
          className="lg:col-span-3"
          aside={
            live.peak
              ? `Peak today ${number.format(live.peak.count)} at ${clock(live.peak.at || now)}`
              : null
          }
        >
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="text-6xl leading-none font-bold tabular-nums">
              {number.format(visitors.length)}
            </div>
            <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
              {[
                ["Looking now", inView],
                ["Mobile", mobile],
                ["Priority places", priority],
                ["Tabs open", tabs.length],
                ["Likely VPN", vpnCount],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[hsl(var(--neo-soft-text))]">{label}</dt>
                  <dd className="font-semibold tabular-nums">
                    {number.format(Number(value))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-3 text-xs text-[hsl(var(--neo-soft-text))]">
            One per browser, with a GitDiagram tab in view or seen in the last
            two minutes. Browsers with any tab open, background tabs included:{" "}
            {number.format(withTabOpen)}.
          </p>
          <div className="mt-4">
            <Sparkline points={live.history} />
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <Tile
            label="Running now"
            value={String(live.jobs.length)}
            sub={`${running.diagram} diagrams · ${running.video} videos · ${running.render} MP4s`}
          />
          <Tile
            label="Videos today"
            value={video ? `${video.videos.used} / ${video.videos.limit}` : "–"}
            meter={
              video ? video.videos.used / Math.max(1, video.videos.limit) : null
            }
            sub={
              video
                ? `${video.videos.personLimit} per person · ${video.videos.networkLimit} per connection`
                : undefined
            }
            action={
              video ? (
                <ResetUsage
                  target="videos"
                  used={video.videos.used}
                  onDone={() => void refresh()}
                />
              ) : null
            }
          />
          <Tile
            label="Voice credits"
            value={
              state?.voiceCredits == null
                ? "–"
                : compact.format(state.voiceCredits)
            }
            sub={
              state?.voiceCredits == null
                ? "Balance unreadable"
                : `≈ ${number.format(Math.floor(state.voiceCredits / 800))} videos left`
            }
          />
          <Tile
            label="MP4s today"
            value={
              video ? `${video.renders.used} / ${video.renders.limit}` : "–"
            }
            meter={
              video
                ? video.renders.used / Math.max(1, video.renders.limit)
                : null
            }
            action={
              video ? (
                <ResetUsage
                  target="renders"
                  used={video.renders.used}
                  onDone={() => void refresh()}
                />
              ) : null
            }
          />
          <div className="col-span-2">
            <Tile
              label={
                quota?.enabled
                  ? "Free diagram tokens today"
                  : "Free diagram tokens today (cap off)"
              }
              value={
                quota
                  ? `${compact.format(quota.usedTokens)} / ${compact.format(quota.limitTokens)}`
                  : "–"
              }
              meter={
                quota?.enabled
                  ? quota.usedTokens / Math.max(1, quota.limitTokens)
                  : null
              }
              sub={
                quota
                  ? `${compact.format(quota.reservedTokens)} held by runs in progress`
                  : undefined
              }
            />
          </div>
          <div className="col-span-2">
            <Tile
              label="Claude API credit"
              value={
                credit && creditSet
                  ? dollars.format(credit.setUsd! - credit.spentUsd)
                  : "–"
              }
              meter={
                credit && creditSet
                  ? credit.spentUsd / Math.max(0.01, credit.setUsd!)
                  : null
              }
              sub={
                !state
                  ? undefined
                  : !credit
                    ? "Unreadable. Needs ANTHROPIC_ADMIN_KEY."
                    : creditSet
                      ? `${dollars.format(credit.spentUsd)} spent since ${dollars.format(credit.setUsd!)} was entered ${since(credit.setAt!, now)} ago · updates each minute`
                      : "Enter the balance from the Console to start counting."
              }
              action={
                credit ? (
                  <SetClaudeCredit onDone={() => void refresh()} />
                ) : null
              }
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          title="Video making"
          className="lg:col-span-3"
          aside={
            saving ? (
              "Saving…"
            ) : saveError ? (
              <span className="text-red-700 dark:text-red-400">
                {saveError}
              </span>
            ) : (
              "Changes are live in about a second"
            )
          }
        >
          {controls ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <div className="text-sm font-semibold">
                  Who can make new videos
                </div>
                <div
                  role="radiogroup"
                  aria-label="Who can make new videos"
                  className="grid gap-2 sm:grid-cols-3"
                >
                  {AUDIENCES.map((option) => {
                    const selected = controls.videoAudience === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={saving}
                        onClick={() =>
                          void change({ videoAudience: option.value })
                        }
                        className={`rounded-md border-[3px] border-black p-3 text-left transition-transform active:scale-[0.98] ${
                          selected
                            ? "bg-purple-400 shadow-[4px_4px_0_0_#000] dark:bg-[hsl(var(--neo-button))] dark:text-black"
                            : "bg-white hover:bg-purple-100 dark:bg-black/20 dark:hover:bg-black/30"
                        }`}
                      >
                        <div className="font-bold">{option.label}</div>
                        <div className="text-xs opacity-80">{option.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-md border-2 border-black bg-white/70 p-3 dark:bg-black/20">
                <span>
                  <span className="block font-semibold">
                    Pause all new videos
                  </span>
                  <span className="block text-xs text-[hsl(var(--neo-soft-text))]">
                    Watching and downloading keep working. You can still make
                    videos.
                  </span>
                </span>
                <Switch
                  checked={controls.videosPaused}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    void change({ videosPaused: checked })
                  }
                  aria-label="Pause all new videos"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <LimitField
                  label="New videos per day"
                  override={controls.videoDailyLimit}
                  effective={video?.videos.limit}
                  onSave={(value) => void change({ videoDailyLimit: value })}
                />
                <LimitField
                  label="Per person per day"
                  override={controls.videoPersonDailyLimit}
                  effective={video?.videos.personLimit}
                  onSave={(value) =>
                    void change({ videoPersonDailyLimit: value })
                  }
                />
                <LimitField
                  label="Per connection per day (backstop)"
                  override={controls.videoNetworkDailyLimit}
                  effective={video?.videos.networkLimit}
                  onSave={(value) =>
                    void change({ videoNetworkDailyLimit: value })
                  }
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--neo-soft-text))]">Loading…</p>
          )}
        </Panel>

        <Panel
          title="Running now"
          className="lg:col-span-2"
          aside={`${live.jobs.length} jobs`}
        >
          {live.jobs.length ? (
            <ul className="flex flex-col gap-2">
              {live.jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between gap-3 rounded-md border-2 border-black bg-white/70 px-3 py-2 text-sm dark:bg-black/20"
                >
                  <span className="min-w-0 truncate">
                    <span className="mr-2 text-xs font-bold uppercase">
                      {job.kind}
                    </span>
                    <span className="font-mono">{job.label}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {since(job.started, now)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[hsl(var(--neo-soft-text))]">
              Nothing running.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Panel
          title="Pages"
          aside={`${visitors.length} ${visitors.length === 1 ? "person" : "people"}`}
        >
          <BarList rows={pages} />
        </Panel>
        <Panel
          title="Countries"
          aside={`${countryCount} ${countryCount === 1 ? "country" : "countries"}`}
        >
          <CountryList visitors={visitors} now={now} />
        </Panel>
        <Panel title="Came from">
          <BarList rows={sources} />
        </Panel>
      </div>

      <Panel title="Live feed" aside="Newest first">
        {live.events.length ? (
          <ol className="flex flex-col divide-y-2 divide-black/10 sm:max-h-[32rem] sm:overflow-y-auto dark:divide-white/10">
            {live.events.map((event) => {
              const { title, tone, detail } = describe(event);
              const repo = typeof event.repo === "string" ? event.repo : "";
              // Phones stack each event (what and when, then the details,
              // wrapped); wider screens keep one line per event.
              return (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 py-2.5 text-sm sm:grid sm:grid-cols-[4.5rem_10rem_1fr] sm:gap-x-3 sm:gap-y-0 sm:py-2"
                >
                  <div className="flex items-baseline justify-between gap-3 sm:contents">
                    <time className="order-2 shrink-0 font-mono text-xs leading-5 text-[hsl(var(--neo-soft-text))] tabular-nums sm:order-none">
                      {clock(event.at)}
                    </time>
                    <span className={`font-semibold ${tone}`}>{title}</span>
                  </div>
                  {repo || detail ? (
                    <span className="min-w-0 [overflow-wrap:anywhere] sm:col-start-3 sm:truncate">
                      {repo && repo.includes("/") ? (
                        <a
                          href={`/${repo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="neo-link font-mono"
                        >
                          {repo}
                        </a>
                      ) : (
                        <span className="font-mono">{repo}</span>
                      )}
                      {detail ? (
                        <span className="text-[hsl(var(--neo-soft-text))]">
                          {repo ? " · " : ""}
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-[hsl(var(--neo-soft-text))]">
            Waiting for something to happen.
          </p>
        )}
      </Panel>
    </main>
  );
}
