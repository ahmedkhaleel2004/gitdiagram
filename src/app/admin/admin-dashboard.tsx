"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { movesCounters } from "~/features/admin/events";
import { hasClockMismatch, peopleHere } from "~/features/admin/presence";
import { isPriorityPlace } from "~/features/admin/priority-places";
import { setAdminTools } from "~/features/admin/tools";
import type { LiveFeedEvent } from "~/features/admin/types";
import { LiveFeed, RunningPanel } from "./activity-panels";
import { AudiencePanels } from "./audience-panels";
import { BudgetTiles } from "./budget-tiles";
import { ControlsPanel } from "./controls-panel";
import { PeoplePanel, usePeopleClock } from "./people-panel";
import { StatusPill, TOUCH } from "./ui";
import { useAdminState } from "./use-admin-state";
import { useLiveSite } from "./use-live-site";

// Counters (budgets, balances) are polled (use-admin-state.ts); everything
// about people and jobs is pushed over the live socket (use-live-site.ts).
// Any event that moves a counter also triggers an immediate re-read, so the
// numbers change the moment something happens. Each panel owns the clock it
// needs, so a ticking duration re-renders that line, not the page.

export function AdminDashboard() {
  const { state, saving, saveError, refresh, change } = useAdminState();
  const [signingOut, setSigningOut] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const onEvent = useCallback(
    (event: LiveFeedEvent) => {
      if (!movesCounters(event.kind)) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 250);
    },
    [refresh],
  );
  const onTokenNeeded = useCallback(() => void refresh(), [refresh]);

  const live = useLiveSite(state?.presence ?? null, { onEvent, onTokenNeeded });

  // Open tabs, including background tabs nobody is looking at.
  const tabs = useMemo(() => Object.values(live.visitors), [live.visitors]);
  // People here now: one per browser, with a tab in view or seen in the last
  // two minutes. Everything below counts these people, not tabs.
  const now = usePeopleClock(tabs, live.at);
  const people = useMemo(() => peopleHere(tabs, now), [tabs, now]);
  // Counted by whichever priority places are switched on.
  const places = state?.controls.priorityPlaces ?? "cities";
  const { mismatched, priority } = useMemo(
    () => ({
      mismatched: new Set(
        people.filter((v) => hasClockMismatch(v, now)).map((v) => v.id),
      ) as ReadonlySet<string>,
      priority: people.filter((v) =>
        isPriorityPlace(
          {
            country: v.c,
            region: v.r,
            city: v.ct,
            lat: v.la,
            lon: v.lo,
          },
          places,
        ),
      ).length,
    }),
    [people, now, places],
  );

  async function signOut(everywhere: boolean) {
    setSigningOut(true);
    setAdminTools(false);
    await fetch(`/api/admin/session${everywhere ? "?everywhere=1" : ""}`, {
      method: "DELETE",
    }).catch(() => null);
    window.location.reload();
  }

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
        <div className="flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--neo-soft-text))]">
          {state?.deployment.commit ? (
            <span className="font-mono">
              {state.deployment.commit}
              {state.deployment.region ? ` · ${state.deployment.region}` : ""}
            </span>
          ) : null}
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void signOut(true)}
            title="Signs out every browser signed in to this dashboard"
            className={`neo-button-muted h-9 rounded-md px-3 text-sm font-semibold ${TOUCH}`}
          >
            Sign out everywhere
          </button>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void signOut(false)}
            className={`neo-button-muted h-9 rounded-md px-3 text-sm font-semibold ${TOUCH}`}
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
        <PeoplePanel
          people={people}
          tabs={tabs}
          peak={live.peak}
          stats={{ priority, mismatched: mismatched.size }}
        />
        <BudgetTiles state={state} onChanged={() => void refresh()} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <ControlsPanel
          state={state}
          saving={saving}
          saveError={saveError}
          change={change}
        />
        <RunningPanel jobs={live.jobs} />
      </div>

      <AudiencePanels people={people} mismatched={mismatched} />

      <LiveFeed events={live.events} />
    </main>
  );
}
