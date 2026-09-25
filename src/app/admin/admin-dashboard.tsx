"use client";

import { useCallback, useMemo, useState } from "react";

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
// Any event that moves a counter also triggers a re-read (at most one every
// couple of seconds), so the numbers change the moment something happens.
// Each panel owns the clock it needs, so a ticking duration re-renders that
// line, not the page.

export function AdminDashboard() {
  const { state, saving, saveError, refresh, refreshSoon, apply, change } =
    useAdminState();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<{
    message: string;
    everywhere: boolean;
  } | null>(null);

  const onEvent = useCallback(
    (event: LiveFeedEvent) => {
      if (movesCounters(event.kind)) refreshSoon();
    },
    [refreshSoon],
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

  /**
   * Signs out, then shows the sign-in form. If the server did not sign out
   * (Redis down for "everywhere", or no connection), this stays signed in
   * and says so, with a way to try again.
   */
  async function signOut(everywhere: boolean) {
    setSigningOut(true);
    setSignOutError(null);
    const response = await fetch(
      `/api/admin/session${everywhere ? "?everywhere=1" : ""}`,
      { method: "DELETE" },
    ).catch(() => null);
    // 401: this session had already ended, so it is signed out anyway.
    if (response?.ok || response?.status === 401) {
      setAdminTools(false);
      window.location.reload();
      return;
    }
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setSignOutError({
      message:
        body?.error ??
        (response
          ? "Could not sign out. Try again."
          : "Could not reach GitDiagram to sign out. Check the connection and try again."),
      everywhere,
    });
    setSigningOut(false);
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

      {signOutError ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border-2 border-black bg-red-100 p-3 text-sm text-black"
        >
          {signOutError.message}
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void signOut(signOutError.everywhere)}
            className={`neo-button-muted h-8 rounded-md px-3 text-xs font-semibold ${TOUCH}`}
          >
            Try again
          </button>
        </p>
      ) : null}

      {state?.controlsUnreadable ? (
        <p
          role="alert"
          className="rounded-md border-2 border-black bg-amber-100 p-3 text-sm text-black"
        >
          The live switches could not be read from Redis just now, so the ones
          below may be out of date, or the defaults. New videos cannot start
          while Redis stays unreachable.
        </p>
      ) : null}

      {live.protocolMismatch ? (
        <p
          role="alert"
          className="rounded-md border-2 border-black bg-amber-100 p-3 text-sm text-black"
        >
          The presence worker speaks a different protocol than this site. Deploy
          it from workers/presence (bunx wrangler deploy) so the live panels
          stay accurate.
        </p>
      ) : null}

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
          audience={state?.controls.videoAudience}
        />
        <BudgetTiles
          state={state}
          onChanged={() => void refresh()}
          onCredit={(claudeCredit) => apply({ claudeCredit })}
        />
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
